import { escapeHtml, unescapeUnicodeChars } from '../utils/helpers.js';

/**
 * ChatManager - 聊天管理器
 * 负责所有聊天相关的功能
 */
class ChatManager {
    constructor(app) {
        this.app = app;

        // ChatManager自有属性
        this.isStreaming = false;
        this.uploadedImageFile = null;
        this.uploadedImageBase64 = null;
        this._throttleTimeout = null;

        // 初始化事件委托
        this.initEventDelegation();
    }

    /**
     * 初始化事件委托 - 在父容器上监听所有代码块按钮的点击
     */
    initEventDelegation() {
        const messagesContainer = document.getElementById('messages');
        if (!messagesContainer) return;

        // 使用事件委托处理所有代码块按钮
        messagesContainer.addEventListener('click', (e) => {
            const target = e.target.closest('.copy-code-btn, .render-html-btn, .fullscreen-html-btn');
            if (!target) return;

            const codeId = target.getAttribute('data-code-id');
            const code = window.codeStorage ? window.codeStorage.get(codeId) : '';

            if (!code) {
                this.app.uiManager.showNotification('代码不存在', 'error');
                return;
            }

            // 根据按钮类型执行不同操作
            if (target.classList.contains('copy-code-btn')) {
                navigator.clipboard.writeText(code).then(() => {
                    this.app.uiManager.showNotification('代码已复制', 'success');
                });
            } else if (target.classList.contains('render-html-btn')) {
                this.showHtmlPreview(code);
            } else if (target.classList.contains('fullscreen-html-btn')) {
                this.showFullscreenHtmlPreview(code);
            }
        });
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        // 检查是否有消息或图片
        if (!message && !this.uploadedImageBase64) return;
        if (this.isStreaming) return;

        // 检查是否在编辑模式（知识库Copilot模式）
        if (this.app.viewMode === 'editor') {
            input.value = '';
            this.hideInputShortcuts();

            // 在聊天窗口显示用户消息
            this.addMessage(message, 'user');

            // 获取编辑器上下文
            const editorContext = {
                noteId: this.app.noteManager.activeNoteId,
                fullText: this.app.noteManager.editorInstance?.value || '',
                selectedText: '' // 暂不支持选中文本
            };

            // 调用知识库Agent
            await this.app.knowledgeAgentHandler.startReActLoop(message, editorContext);

            return;
        }

        // 检查是否为Agent模式
        if (this.app.isAgentMode || message.startsWith('Agent:')) {
            input.value = '';
            this.hideInputShortcuts();

            // 去除"Agent:"前缀
            const actualMessage = message.startsWith('Agent:') ? message.substring(6).trim() : message;

            // 在聊天窗口显示用户消息
            this.addMessage(actualMessage, 'user');

            // 启动Agent模式
            await this.app.agentHandler.startReActLoop(actualMessage);

            return;
        }

        if (!this.app.settings.apiKey) {
            this.app.uiManager.showNotification('请先在设置中配置API密钥', 'error');
            this.app.settingsManager.showSettings();
            return;
        }

        input.value = '';
        this.hideInputShortcuts();

        // 构建消息内容
        let imageUrl = null;
        let contentParts = [];

        // 如果有图片，先上传到服务器
        if (this.uploadedImageFile) {
            try {
                imageUrl = await this.uploadImageToServer(this.uploadedImageFile);
            } catch (error) {
                this.app.uiManager.showNotification('图片上传失败', 'error');
                return;
            }
        }

        // 构建多模态消息内容
        if (message) {
            contentParts.push({
                type: 'text',
                text: message
            });
        }

        if (this.uploadedImageBase64) {
            contentParts.push({
                type: 'image_url',
                image_url: {
                    url: this.uploadedImageBase64
                }
            });
        }

        // 显示用户消息（包括图片）
        this.addMessage(message, 'user', false, imageUrl);

        // 将消息添加到当前活动会话
        const activeSession = this.app.getActiveSession();
        if (activeSession) {
            const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            // 保存消息，包含图片URL
            const userMessage = {
                role: 'user',
                content: contentParts.length === 1 ? contentParts[0].text || contentParts[0] : contentParts,
                messageId: messageId,
                followups: []
            };

            if (imageUrl) {
                userMessage.imageUrl = imageUrl;
            }

            activeSession.messages.push(userMessage);

            // 如果这是会话的第一条用户消息，自动生成标题
            if (activeSession.messages.length === 1) {
                const newTitle = this.app.generateSessionTitle(message || '图片消息');
                this.app.updateSessionTitle(activeSession.id, newTitle);
            }

            activeSession.updatedAt = new Date().toISOString();
            this.app.saveSessions();
        }

        // 清理图片状态
        this.removeImage();

        // 更新Token用量
        this.app.updateTokenUsage();

        await this.getAIResponse(contentParts);
    }

    async getAIResponse(userMessage) {
        this.isStreaming = true;
        this.toggleSendButton(false);

        const aiMessageElement = this.addMessage('', 'ai', true);
        const contentElement = aiMessageElement.querySelector('.message-content');

        try {
            const activeSession = this.app.getActiveSession();
            let messagesToSend = [];

            // 如果会话已压缩，构造新的消息数组
            if (activeSession && activeSession.summary && activeSession.summarySplitIndex !== undefined) {
                // 添加摘要作为系统消息
                messagesToSend.push({
                    role: 'system',
                    content: '以下是之前对话的摘要：\n' + activeSession.summary
                });

                // 添加压缩点之后的新消息
                const newMessages = activeSession.messages.slice(activeSession.summarySplitIndex);
                messagesToSend = messagesToSend.concat(newMessages);
            } else {
                // 未压缩，使用完整的消息历史
                messagesToSend = activeSession?.messages || [];
            }

            // 处理最后一条消息的内容（可能是多模态的）
            if (messagesToSend.length > 0) {
                const lastMessage = messagesToSend[messagesToSend.length - 1];
                if (Array.isArray(lastMessage.content)) {
                    // 如果content是数组（多模态），保持不变
                    // API应该已经支持这种格式
                } else if (typeof lastMessage.content === 'object' && lastMessage.content.type) {
                    // 如果是单个对象，转换为数组
                    lastMessage.content = [lastMessage.content];
                }
            }

            const requestBody = {
                model: this.app.settings.model,
                messages: messagesToSend,
                stream: true,
                temperature: this.app.config?.apiSettings?.temperature || 0.7,
                max_tokens: this.app.config?.apiSettings?.maxTokens || 10000
            };

            console.log('Sending API request:', {
                endpoint: this.app.settings.endpoint,
                model: requestBody.model,
                messageCount: messagesToSend.length
            });

            const response = await fetch(this.app.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.app.settings.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            console.log('API response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API error response:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log('Stream complete. Total chunks:', chunkCount);
                    break;
                }

                const chunk = decoder.decode(value);
                chunkCount++;

                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            console.log('Received [DONE] signal');
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            if (delta) {
                                fullResponse += delta;
                                // 流式更新(未完成)
                                this.updateMessageContent(contentElement, fullResponse, false);
                                this.app.uiManager.scrollToBottom();
                            }
                        } catch (e) {
                            // Ignore parsing errors for incomplete JSON
                            console.debug('JSON parse error (may be incomplete):', e.message);
                        }
                    }
                }
            }

            console.log('Full response received, length:', fullResponse.length);

            // 流式完成，执行最终渲染
            this.updateMessageContent(contentElement, fullResponse, true);

            // 将AI响应添加到当前活动会话
            if (activeSession) {
                const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                activeSession.messages.push({
                    role: 'assistant',
                    content: fullResponse,
                    messageId: messageId,
                    followups: []
                });
                activeSession.updatedAt = new Date().toISOString();
                this.app.saveSessions();
                this.app.renderSessionList(); // 更新会话列表中的消息计数
            }

            // 刷新节点轴
            this.app.renderNodeAxis();

            // 记录交互，包含完整的发送给LLM的消息
            this.logInteraction(userMessage, fullResponse, 'main', messagesToSend);

        } catch (error) {
            console.error('API Error:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });

            let errorMessage = error.message;
            if (error.message.includes('Failed to fetch')) {
                errorMessage = '网络连接失败，请检查API端点配置和网络连接';
            } else if (error.message.includes('401')) {
                errorMessage = 'API密钥无效或已过期，请检查设置';
            } else if (error.message.includes('429')) {
                errorMessage = 'API请求频率超限，请稍后再试';
            }

            contentElement.innerHTML = `<p class="text-red-400">❌ 请求失败: ${errorMessage}</p>`;
            this.app.uiManager.showNotification(errorMessage, 'error');
        } finally {
            this.isStreaming = false;
            this.toggleSendButton(true);
            aiMessageElement.querySelector('.typewriter')?.classList.remove('typewriter');
            this.app.updateTokenUsage();
        }
    }

    addMessage(content, type, isStreaming = false, imageUrl = null) {
        return this.app.uiManager.addMessage(
            content,
            type,
            isStreaming,
            imageUrl,
            (c) => this.formatMessage(c)
        );
    }

    updateMessageContent(element, content, isStreamComplete = false) {
        // 性能优化：使用节流，避免过于频繁的DOM更新
        if (!isStreamComplete && this._throttleTimeout) {
            return;
        }

        // 处理Unicode转义字符
        content = unescapeUnicodeChars(content);

        // 如果是流式更新且内容较短，使用节流
        if (!isStreamComplete && content.length < 5000) {
            this._throttleTimeout = setTimeout(() => {
                this._throttleTimeout = null;
            }, 16); // 60fps
        }

        // 使用requestAnimationFrame优化DOM更新时机
        requestAnimationFrame(() => {
            element.innerHTML = this.formatMessage(content);

            // 只在流式完成后才执行昂贵的操作
            if (isStreamComplete) {
                this.addCopyButtons();

                // Reinitialize Lucide icons for new content
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }

                // 重新应用代码高亮
                if (typeof hljs !== 'undefined') {
                    element.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                }
            }
        });
    }

    formatMessage(content) {
        // 1. 先处理可能存在的Unicode转义字符
        let processedContent = unescapeUnicodeChars(content);

        // 2. 使用 marked.js 解析 Markdown
        if (typeof marked !== 'undefined') {
            try {
                let html = marked.parse(processedContent);
                // 3. 后处理：渲染Wiki链接和标签
                html = this.renderWikiLinksAndTags(html);
                return html;
            } catch (error) {
                console.error('Markdown parsing error:', error);
                // 如果解析失败，降级使用基础格式化
                return escapeHtml(processedContent).replace(/\n/g, '<br>');
            }
        }

        // 降级方案：如果 marked.js 未加载，使用基础格式化
        return escapeHtml(processedContent).replace(/\n/g, '<br>');
    }

    /**
     * 渲染Wiki链接和标签
     */
    renderWikiLinksAndTags(html) {
        // 处理Wiki链接 [[笔记ID]] 或 [[笔记ID|显示文本]]
        html = html.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (match, noteId, pipe, displayText) => {
            const text = displayText || noteId;
            return `<a href="#" data-note-id="${escapeHtml(noteId.trim())}" class="internal-link text-purple-400 hover:text-purple-300 underline">${escapeHtml(text.trim())}</a>`;
        });

        // 处理内联标签 #标签名
        // 注意：避免匹配代码块内的标签
        html = html.replace(/(?<!<code[^>]*>.*?)#([a-zA-Z0-9_\u4e00-\u9fa5]+)(?![^<]*<\/code>)/g, (match, tag) => {
            return `<a href="#" data-tag="${escapeHtml(tag)}" class="tag-link text-blue-400 hover:text-blue-300">#${escapeHtml(tag)}</a>`;
        });

        return html;
    }

    splitContentIntoParts(content) {
        const parts = [];
        let currentIndex = 0;

        // 查找所有完整的代码块
        const completeCodeRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;

        while ((match = completeCodeRegex.exec(content)) !== null) {
            // 添加代码块前的文本
            if (match.index > currentIndex) {
                const textContent = content.slice(currentIndex, match.index);
                if (textContent.trim()) {
                    parts.push({ type: 'text', content: textContent });
                }
            }

            // 添加完整的代码块
            parts.push({
                type: 'code',
                language: match[1] || 'text',
                content: match[2]
            });

            currentIndex = match.index + match[0].length;
        }

        // 处理剩余内容
        const remainingContent = content.slice(currentIndex);
        if (remainingContent) {
            // 检查剩余内容是否是不完整的代码块
            const incompleteCodeMatch = remainingContent.match(/```(\w+)?\n?([\s\S]*)$/);
            if (incompleteCodeMatch) {
                // 添加不完整代码块之前的文本（如果有）
                const beforeCodeText = remainingContent.slice(0, incompleteCodeMatch.index);
                if (beforeCodeText.trim()) {
                    parts.push({ type: 'text', content: beforeCodeText });
                }

                // 添加不完整的代码块
                parts.push({
                    type: 'incomplete_code',
                    language: incompleteCodeMatch[1] || 'text',
                    content: incompleteCodeMatch[2] || ''
                });
            } else {
                // 普通文本
                parts.push({ type: 'text', content: remainingContent });
            }
        }

        return parts;
    }

    formatTextContent(text) {
        // 转义HTML
        let safeText = escapeHtml(text);

        // 应用Markdown格式
        safeText = safeText
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // 粗体
            .replace(/\*(.*?)\*/g, '<em>$1</em>')           // 斜体
            .replace(/`([^`]+)`/g, '<code class="bg-gray-700 px-1 rounded text-sm">$1</code>') // 行内代码
            .replace(/^\* (.+)$/gm, '<li>$1</li>')          // 列表项
            .replace(/\n/g, '<br>');                        // 换行

        // 修复列表包裹
        safeText = safeText.replace(/(<li>.*<\/li>)/s, '<ul class="list-disc list-inside mt-2 mb-2">$1</ul>');

        return safeText;
    }

    formatCompleteCodeBlock(language, code) {
        const cleanCode = code.trim();
        const escapedCode = escapeHtml(cleanCode);

        // 生成唯一ID来存储代码
        const codeId = 'code_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        window.codeStorage.set(codeId, cleanCode);

        return `
            <div class="code-block relative bg-gray-800 rounded-lg mt-2 mb-2">
                <div class="flex justify-between items-center px-4 py-2 bg-gray-700 rounded-t-lg">
                    <span class="text-sm text-gray-300 font-medium">${language}</span>
                    <div class="flex space-x-2">
                        ${language.toLowerCase() === 'html' ? `
                            <button class="render-html-btn text-gray-400 hover:text-white text-sm flex items-center gap-1" data-code-id="${codeId}">
                                <i data-lucide="palette" class="w-4 h-4"></i>
                                <span>渲染</span>
                            </button>
                            <button class="fullscreen-html-btn text-gray-400 hover:text-white text-sm flex items-center gap-1" data-code-id="${codeId}">
                                <i data-lucide="maximize" class="w-4 h-4"></i>
                                <span>全屏</span>
                            </button>
                        ` : ''}
                        <button class="copy-code-btn text-gray-400 hover:text-white text-sm flex items-center gap-1" data-code-id="${codeId}">
                            <i data-lucide="copy" class="w-4 h-4"></i>
                            <span>复制</span>
                        </button>
                    </div>
                </div>
                <pre class="p-4 overflow-x-auto"><code class="language-${language}">${escapedCode}</code></pre>
            </div>
        `;
    }

    formatIncompleteCodeBlock(language, code) {
        const escapedCode = escapeHtml(code);

        return `
            <div class="code-block relative bg-gray-800 rounded-lg mt-2 mb-2">
                <div class="flex justify-between items-center px-4 py-2 bg-gray-700 rounded-t-lg">
                    <span class="text-sm text-gray-300">${language} <span class="text-xs text-gray-500">(正在输入...)</span></span>
                </div>
                <pre class="p-4 overflow-x-auto"><code class="language-${language}">${escapedCode}<span class="typewriter">|</span></code></pre>
            </div>
        `;
    }


    addCopyButtons() {
        // Reinitialize Lucide icons for code block buttons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        // 应用代码高亮到所有代码块
        if (typeof hljs !== 'undefined') {
            document.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        // 注意：按钮事件已通过事件委托处理，不需要重复绑定
    }

    showHtmlPreview(htmlCode) {
        // 确保HTML代码经过正确的反转义处理
        const cleanHtmlCode = unescapeUnicodeChars(htmlCode);

        // 创建HTML预览模态框
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 modal z-50';
        modal.innerHTML = `
            <div class="flex items-center justify-center h-full p-4">
                <div class="bg-gray-800 rounded-lg p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-lg font-bold">🎨 HTML预览</h2>
                        <button class="close-preview text-gray-400 hover:text-white">✕</button>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div>
                            <h3 class="text-md font-semibold mb-2">渲染效果:</h3>
                            <div class="bg-white p-4 rounded h-96 overflow-auto html-preview-container" style="color: black;">
                                <!-- HTML内容将通过安全方式插入 -->
                            </div>
                        </div>
                        <div>
                            <h3 class="text-md font-semibold mb-2">源代码:</h3>
                            <pre class="bg-gray-900 p-4 rounded h-96 overflow-auto"><code class="language-html">${escapeHtml(cleanHtmlCode)}</code></pre>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 安全地插入HTML内容
        const previewContainer = modal.querySelector('.html-preview-container');

        // 使用srcdoc属性来安全地渲染HTML内容
        const iframe = document.createElement('iframe');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.background = 'white';
        iframe.setAttribute('srcdoc', cleanHtmlCode);
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

        previewContainer.appendChild(iframe);

        modal.querySelector('.close-preview').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        document.body.appendChild(modal);

        // 高亮代码
        if (typeof hljs !== 'undefined') {
            modal.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    }

    showFullscreenHtmlPreview(htmlCode) {
        // 确保HTML代码经过正确的反转义处理
        const cleanHtmlCode = unescapeUnicodeChars(htmlCode);

        try {
            // 方法1: 使用POST请求到后端预览端点
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/preview';
            form.target = '_blank';
            form.style.display = 'none';

            const htmlInput = document.createElement('input');
            htmlInput.type = 'hidden';
            htmlInput.name = 'html';
            htmlInput.value = cleanHtmlCode;

            form.appendChild(htmlInput);
            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);

            this.app.uiManager.showNotification('已在新窗口打开全屏预览', 'success');

        } catch (error) {
            console.error('全屏预览错误:', error);

            // 备用方法: 使用fetch API和新窗口
            this.fallbackFullscreenPreview(cleanHtmlCode);
        }
    }

    async fallbackFullscreenPreview(htmlCode) {
        try {
            // 使用fetch发送HTML内容到后端
            const response = await fetch('/preview', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    html: htmlCode
                })
            });

            if (response.ok) {
                const htmlContent = await response.text();

                // 创建新窗口并写入HTML内容
                const newWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
                if (newWindow) {
                    newWindow.document.open();
                    newWindow.document.write(htmlContent);
                    newWindow.document.close();
                    this.app.uiManager.showNotification('已在新窗口打开全屏预览', 'success');
                } else {
                    this.app.uiManager.showNotification('无法打开新窗口，请检查浏览器弹窗设置', 'error');
                }
            } else {
                throw new Error('后端预览服务响应错误');
            }
        } catch (error) {
            console.error('备用全屏预览错误:', error);
            this.app.uiManager.showNotification('全屏预览失败，请稍后重试', 'error');
        }
    }

    async handleFollowup(selectedText, command, originalMessage) {
        // 判断上下文来源：textarea、notePreview或普通消息
        let originalContent;
        let useTooltipMode = false;

        if (originalMessage.tagName === 'TEXTAREA') {
            // 来自编辑器
            originalContent = originalMessage.value;
        } else if (originalMessage.id === 'notePreview') {
            // 来自笔记预览 - 使用tooltip模式
            originalContent = this.app.noteManager.editorInstance ? this.app.noteManager.editorInstance.value : '';
            useTooltipMode = true;
        } else {
            // 来自聊天消息
            originalContent = originalMessage.querySelector('.message-content').textContent;
        }

        const followupPrompt = command.prompt + selectedText + '\n\n原始对话内容:\n' + originalContent;

        // 根据场景选择显示方式
        let contentElement;

        if (useTooltipMode) {
            // Tooltip模式：在tooltip内显示追问结果
            // 使用setTimeout确保tooltip已经存在
            await new Promise(resolve => setTimeout(resolve, 50));
            this.app.uiManager.showTooltipFollowupLoading();
            contentElement = {
                innerHTML: '',
                // 模拟DOM元素的innerHTML setter
                set innerHTML(value) {
                    this._content = value;
                    // 更新tooltip内容
                    if (this.app && this.app.uiManager) {
                        this.app.uiManager.showTooltipFollowup(value, false);
                    }
                },
                get innerHTML() {
                    return this._content || '';
                },
                app: this.app,
                _content: ''
            };
        } else {
            // Modal模式：弹出模态框（原有逻辑）
            const modal = this.createFollowupModal();
            document.body.appendChild(modal);
            contentElement = modal.querySelector('.followup-content');
            contentElement.innerHTML = '<div class="text-gray-400">正在生成回答...</div>';
        }

        try {
            const response = await fetch(this.app.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.app.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.app.settings.model,
                    messages: [{ role: 'user', content: followupPrompt }],
                    stream: true,
                    temperature: 0.7,
                    max_tokens: 1500
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            contentElement.innerHTML = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            if (delta) {
                                fullResponse += delta;
                                if (useTooltipMode) {
                                    // Tooltip模式：使用UIManager方法更新
                                    this.app.uiManager.showTooltipFollowup(fullResponse, false);
                                } else {
                                    // Modal模式：直接更新DOM
                                    contentElement.innerHTML = this.formatMessage(fullResponse);
                                    this.addCopyButtons();
                                }
                            }
                        } catch (e) {
                            // Ignore parsing errors
                        }
                    }
                }
            }

            // 流式传输完成
            if (useTooltipMode) {
                // Tooltip模式：标记为完成
                this.app.uiManager.showTooltipFollowup(fullResponse, true);
            }

            // 保存追问记录到消息数据（仅在非tooltip模式下）
            const activeSession = this.app.getActiveSession();
            if (activeSession && !useTooltipMode) {
                // 找到原始消息的索引
                const messageIndex = parseInt(originalMessage.getAttribute('data-message-index'));
                if (!isNaN(messageIndex) && activeSession.messages[messageIndex]) {
                    const message = activeSession.messages[messageIndex];

                    // 初始化followups数组（如果不存在）
                    if (!message.followups) {
                        message.followups = [];
                    }

                    // 添加追问记录（只保存用户友好的问题和答案，不包含原始对话内容）
                    const userFriendlyQuestion = `${command.label}: ${selectedText}`;
                    message.followups.push({
                        question: userFriendlyQuestion,
                        answer: fullResponse,
                        timestamp: new Date().toISOString()
                    });

                    // 保存到localStorage
                    this.app.saveSessions();

                    // 刷新节点轴
                    this.app.renderNodeAxis();
                }
            }

            this.logInteraction(followupPrompt, fullResponse, 'followup');

        } catch (error) {
            if (useTooltipMode) {
                // Tooltip模式：显示错误
                this.app.uiManager.showTooltipFollowup(`<p class="text-red-400">❌ 请求失败: ${error.message}</p>`, true);
            } else {
                // Modal模式：直接更新DOM
                contentElement.innerHTML = `<p class="text-red-400">❌ 请求失败: ${error.message}</p>`;
            }
        }
    }

    createFollowupModal() {
        return this.app.uiManager.createFollowupModal();
    }

    async logInteraction(userInput, aiResponse, type, messagesToSend = null) {
        try {
            // 处理userInput，可能是字符串或数组（多模态）
            let userInputText = userInput;
            if (Array.isArray(userInput)) {
                // 提取文本内容
                const textParts = userInput
                    .filter(part => part.type === 'text')
                    .map(part => part.text);
                userInputText = textParts.join('\n');

                // 如果包含图片，添加标记
                const hasImage = userInput.some(part => part.type === 'image_url');
                if (hasImage) {
                    userInputText += '\n[包含图片]';
                }
            }

            const logData = {
                user_input: userInputText || '[空消息]',
                ai_response: aiResponse,
                type: type
            };

            // 如果提供了messagesToSend，添加到日志中
            if (messagesToSend) {
                logData.messages_to_send = messagesToSend;
            }

            await fetch('/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(logData)
            });
        } catch (error) {
            console.error('Failed to log interaction:', error);
        }
    }

    toggleSendButton(enabled) {
        const sendBtn = document.getElementById('sendBtn');
        sendBtn.disabled = !enabled;
        sendBtn.textContent = enabled ? '发送' : '生成中...';
    }

    handleInputChange(value) {
        const trimmedValue = value.trim();
        if (trimmedValue.length > 0) {
            this.showInputShortcuts();
        } else {
            this.hideInputShortcuts();
        }
    }

    showInputShortcuts() {
        if (!this.app.config || !this.app.config.commands) return;

        const shortcutsContainer = document.getElementById('inputShortcuts');
        const buttonsContainer = document.getElementById('shortcutButtons');

        // 清空现有按钮
        buttonsContainer.innerHTML = '';

        // 生成快捷按钮
        this.app.config.commands.forEach(command => {
            const button = document.createElement('button');
            button.className = 'px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded text-sm whitespace-nowrap transition-colors';
            button.textContent = command.label;
            button.type = 'button';

            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.useInputShortcut(command);
            });

            buttonsContainer.appendChild(button);
        });

        shortcutsContainer.classList.remove('hidden');
    }

    hideInputShortcuts() {
        const shortcutsContainer = document.getElementById('inputShortcuts');
        shortcutsContainer.classList.add('hidden');
    }

    useInputShortcut(command) {
        const messageInput = document.getElementById('messageInput');
        const userInput = messageInput.value.trim();

        if (!userInput) return;

        // 构造完整的prompt
        const fullPrompt = command.prompt + userInput;

        // 清空输入框
        messageInput.value = '';
        this.hideInputShortcuts();

        // 添加用户消息到界面
        this.addMessage(userInput, 'user');

        // 将消息添加到当前活动会话
        const activeSession = this.app.getActiveSession();
        if (activeSession) {
            const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            activeSession.messages.push({
                role: 'user',
                content: fullPrompt,
                messageId: messageId,
                followups: []
            });

            // 如果这是会话的第一条用户消息，自动生成标题
            if (activeSession.messages.length === 1) {
                const newTitle = this.app.generateSessionTitle(userInput);
                this.app.updateSessionTitle(activeSession.id, newTitle);
            }

            activeSession.updatedAt = new Date().toISOString();
            this.app.saveSessions();
        }

        // 发送到AI
        this.getAIResponse(fullPrompt);
    }

    /**
     * 渲染Agent消息
     */
    renderAgentMessage(msg, container, index) {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'agent-trace-step border rounded-lg p-3 mb-2';
        stepDiv.setAttribute('data-message-index', index);

        let iconName = 'circle';
        let titleColor = 'text-gray-400';
        let title = msg.type;

        switch (msg.type) {
            case 'agent_iteration':
                // 迭代标记，显示为分隔线
                stepDiv.className = 'text-xs text-gray-500 my-2 text-center';
                stepDiv.innerHTML = `<div class="border-t border-gray-600 pt-2">${escapeHtml(msg.content)}</div>`;
                container.appendChild(stepDiv);
                return;

            case 'agent_thought':
                iconName = 'brain';
                titleColor = 'text-blue-400';
                title = '思考';
                stepDiv.classList.add('bg-blue-900', 'bg-opacity-20', 'border-blue-500');
                break;

            case 'agent_action':
                iconName = 'zap';
                titleColor = 'text-yellow-400';
                title = '执行工具';
                stepDiv.classList.add('bg-yellow-900', 'bg-opacity-20', 'border-yellow-500');
                break;

            case 'agent_observation':
                iconName = 'eye';
                titleColor = 'text-green-400';
                title = '观察结果';
                stepDiv.classList.add('bg-green-900', 'bg-opacity-20', 'border-green-500');
                break;

            case 'agent_error':
                iconName = 'alert-circle';
                titleColor = 'text-red-400';
                title = '错误';
                stepDiv.classList.add('bg-red-900', 'bg-opacity-20', 'border-red-500');
                break;

            case 'agent_final_answer':
                iconName = 'check-circle';
                titleColor = 'text-purple-400';
                title = '最终答案';
                stepDiv.classList.add('bg-purple-900', 'bg-opacity-20', 'border-purple-500');
                break;
        }

        // 构建内容
        let contentHtml = `<div class="text-sm text-gray-200 whitespace-pre-wrap">${escapeHtml(msg.content)}</div>`;

        // 如果有额外数据（如工具参数），显示
        if (msg.args) {
            contentHtml += `<div class="mt-2 text-xs text-gray-400">${escapeHtml(JSON.stringify(msg.args, null, 2))}</div>`;
        }

        stepDiv.innerHTML = `
            <div class="flex items-center gap-2 mb-2">
                <i data-lucide="${iconName}" class="w-4 h-4 ${titleColor}"></i>
                <span class="font-bold ${titleColor}">${title}</span>
            </div>
            ${contentHtml}
        `;

        container.appendChild(stepDiv);
    }

    // 图片处理方法
    async handleImageSelection(file) {
        if (!file || !file.type.startsWith('image/')) {
            this.app.uiManager.showNotification('请选择图片文件', 'error');
            return;
        }

        try {
            await this.compressAndPreviewImage(file);
        } catch (error) {
            console.error('图片处理失败:', error);
            this.app.uiManager.showNotification('图片处理失败: ' + error.message, 'error');
        }
    }

    async compressAndPreviewImage(file) {
        try {
            const preview = document.getElementById('imagePreview');
            const container = document.getElementById('imagePreviewContainer');

            // 1. 先显示原图预览
            const tempReader = new FileReader();
            tempReader.onload = (e) => {
                preview.src = e.target.result;
                container.classList.remove('hidden');

                // 添加压缩状态
                preview.classList.add('compressing');

                // 添加加载动画
                const spinner = document.createElement('div');
                spinner.className = 'image-loading-spinner';
                spinner.id = 'imageLoadingSpinner';
                container.appendChild(spinner);
            };
            tempReader.readAsDataURL(file);

            // 2. 开始压缩（有延迟效果）
            await new Promise(resolve => setTimeout(resolve, 100)); // 让UI先更新

            const options = {
                maxSizeMB: 0.1, // 压缩到100KB以下
                maxWidthOrHeight: 1920,
                useWebWorker: true
            };

            const compressedFile = await imageCompression(file, options);

            // 3. 压缩完成，转换为Base64
            const reader = new FileReader();
            reader.onload = (e) => {
                this.uploadedImageBase64 = e.target.result;
                this.uploadedImageFile = compressedFile;

                // 更新为压缩后的预览
                preview.src = e.target.result;

                // 移除加载状态
                preview.classList.remove('compressing');
                const spinner = document.getElementById('imageLoadingSpinner');
                if (spinner) {
                    spinner.remove();
                }

                this.app.uiManager.showNotification(`图片已压缩 (${(compressedFile.size / 1024).toFixed(1)}KB)`, 'success');
            };
            reader.readAsDataURL(compressedFile);

        } catch (error) {
            // 清理加载状态
            const preview = document.getElementById('imagePreview');
            preview.classList.remove('compressing');
            const spinner = document.getElementById('imageLoadingSpinner');
            if (spinner) {
                spinner.remove();
            }
            throw new Error('压缩失败: ' + error.message);
        }
    }

    removeImage() {
        this.uploadedImageFile = null;
        this.uploadedImageBase64 = null;

        const preview = document.getElementById('imagePreview');
        const container = document.getElementById('imagePreviewContainer');
        const input = document.getElementById('imageUploadInput');

        preview.src = '';
        container.classList.add('hidden');
        input.value = '';
    }

    async uploadImageToServer(file) {
        try {
            const formData = new FormData();
            formData.append('image', file);

            const response = await fetch('/upload-image', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('上传失败');
            }

            const data = await response.json();
            return data.filePath;
        } catch (error) {
            console.error('图片上传失败:', error);
            throw error;
        }
    }
}

export { ChatManager };
