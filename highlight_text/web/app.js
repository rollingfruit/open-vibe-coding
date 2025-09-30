class AIAssistant {
    constructor() {
        this.config = null;
        this.settings = this.loadSettings();
        this.currentConversation = [];
        this.isStreaming = false;

        this.init();
    }

    async init() {
        await this.loadConfig();
        this.bindEvents();
        this.checkUrlParams();
        this.loadStoredConversation();
    }

    async loadConfig() {
        try {
            const response = await fetch('./config.json');
            this.config = await response.json();
        } catch (error) {
            console.error('Failed to load config:', error);
            this.config = { commands: [], apiSettings: {} };
        }
    }

    loadSettings() {
        const stored = localStorage.getItem('aiAssistantSettings');
        return stored ? JSON.parse(stored) : {
            apiKey: '',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-3.5-turbo'
        };
    }

    saveSettings() {
        localStorage.setItem('aiAssistantSettings', JSON.stringify(this.settings));
    }

    loadStoredConversation() {
        const stored = localStorage.getItem('aiAssistantConversation');
        if (stored) {
            this.currentConversation = JSON.parse(stored);
            this.renderStoredMessages();
        }
    }

    saveConversation() {
        localStorage.setItem('aiAssistantConversation', JSON.stringify(this.currentConversation));
    }

    renderStoredMessages() {
        const messagesContainer = document.getElementById('messages');

        this.currentConversation.forEach(msg => {
            if (msg.role === 'user') {
                this.addMessage(msg.content, 'user', false);
            } else if (msg.role === 'assistant') {
                this.addMessage(msg.content, 'ai', false);
            }
        });
    }

    bindEvents() {
        // 聊天表单提交
        document.getElementById('chatForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        // 设置相关事件
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.showSettings();
        });

        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            this.saveSettingsFromModal();
        });

        document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
            this.hideSettings();
        });

        // 清空聊天
        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearChat();
        });

        // 输入框事件
        const messageInput = document.getElementById('messageInput');
        messageInput.addEventListener('input', (e) => {
            this.handleInputChange(e.target.value);
        });

        messageInput.addEventListener('focus', () => {
            if (messageInput.value.trim()) {
                this.showInputShortcuts();
            }
        });

        messageInput.addEventListener('blur', () => {
            // 延迟隐藏，以允许点击快捷按钮
            setTimeout(() => {
                this.hideInputShortcuts();
            }, 200);
        });

        // 全局划词事件 - 使用延迟以确保选择完成
        document.addEventListener('mouseup', (e) => {
            setTimeout(() => {
                this.handleTextSelection(e);
            }, 10);
        });

        // 点击其他地方隐藏tooltip
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.tooltip') && !e.target.closest('.ai-message')) {
                this.hideTooltip();
            }
        });

        // 滚动时隐藏tooltip
        document.getElementById('chatContainer').addEventListener('scroll', () => {
            this.hideTooltip();
        });
    }

    checkUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q');
        if (query) {
            document.getElementById('messageInput').value = decodeURIComponent(query);
            // 延迟自动发送，让页面完全加载
            setTimeout(() => {
                this.sendMessage();
            }, 500);
        }
    }

    showSettings() {
        const modal = document.getElementById('settingsModal');
        document.getElementById('apiKeyInput').value = this.settings.apiKey;
        document.getElementById('apiEndpointInput').value = this.settings.endpoint;
        document.getElementById('modelSelect').value = this.settings.model;
        modal.classList.remove('hidden');
    }

    hideSettings() {
        document.getElementById('settingsModal').classList.add('hidden');
    }

    saveSettingsFromModal() {
        this.settings.apiKey = document.getElementById('apiKeyInput').value;
        this.settings.endpoint = document.getElementById('apiEndpointInput').value;
        this.settings.model = document.getElementById('modelSelect').value;
        this.saveSettings();
        this.hideSettings();
        this.showNotification('设置已保存', 'success');
    }

    clearChat() {
        if (confirm('确定要清空聊天记录吗？')) {
            document.getElementById('messages').innerHTML = '';
            this.currentConversation = [];
            this.saveConversation();

            // 重新添加欢迎消息
            this.addWelcomeMessage();
        }
    }

    addWelcomeMessage() {
        const welcomeHTML = `
            <div class="message-bubble ai-message">
                <div class="mb-2">
                    <span class="text-green-400 font-semibold">🤖 AI助手</span>
                    <span class="text-gray-400 text-sm ml-2">刚刚</span>
                </div>
                <div class="message-content">
                    <p>你好！我是你的AI助手。你可以：</p>
                    <ul class="list-disc list-inside mt-2 space-y-1">
                        <li>向我提出任何问题</li>
                        <li>选中我的回答中的任意文字，会弹出快捷操作菜单</li>
                        <li>点击代码块右上角的按钮复制代码</li>
                    </ul>
                    <p class="mt-2">现在就开始对话吧！</p>
                </div>
            </div>
        `;
        document.getElementById('messages').innerHTML = welcomeHTML;
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        if (!message || this.isStreaming) return;

        if (!this.settings.apiKey) {
            this.showNotification('请先在设置中配置API密钥', 'error');
            this.showSettings();
            return;
        }

        input.value = '';
        this.hideInputShortcuts();
        this.addMessage(message, 'user');
        this.currentConversation.push({ role: 'user', content: message });

        await this.getAIResponse(message);
    }

    async getAIResponse(userMessage) {
        this.isStreaming = true;
        this.toggleSendButton(false);

        const aiMessageElement = this.addMessage('', 'ai', true);
        const contentElement = aiMessageElement.querySelector('.message-content');

        try {
            const response = await fetch(this.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: this.currentConversation,
                    stream: true,
                    temperature: 0.7,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

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
                                // 直接调用完整的更新函数，不再需要 shouldRerenderContent 和 simpleUpdateContent
                                this.updateMessageContent(contentElement, fullResponse);
                                this.scrollToBottom();
                            }
                        } catch (e) {
                            // Ignore parsing errors for incomplete JSON
                        }
                    }
                }
            }

            this.currentConversation.push({ role: 'assistant', content: fullResponse });
            this.saveConversation();
            this.logInteraction(userMessage, fullResponse, 'main');

        } catch (error) {
            console.error('API Error:', error);
            contentElement.innerHTML = `<p class="text-red-400">❌ 请求失败: ${error.message}</p>`;
        } finally {
            this.isStreaming = false;
            this.toggleSendButton(true);
            aiMessageElement.querySelector('.typewriter')?.classList.remove('typewriter');
        }
    }

    addMessage(content, type, isStreaming = false) {
        const messagesContainer = document.getElementById('messages');
        const timestamp = new Date().toLocaleTimeString();

        const messageElement = document.createElement('div');
        messageElement.className = `message-bubble ${type}-message`;

        if (type === 'user') {
            messageElement.innerHTML = `
                <div class="mb-2">
                    <span class="text-blue-400 font-semibold">👤 你</span>
                    <span class="text-gray-400 text-sm ml-2">${timestamp}</span>
                </div>
                <div class="message-content">
                    <p>${this.escapeHtml(content)}</p>
                </div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="mb-2">
                    <span class="text-green-400 font-semibold">🤖 AI助手</span>
                    <span class="text-gray-400 text-sm ml-2">${timestamp}</span>
                </div>
                <div class="message-content ${isStreaming ? 'typewriter' : ''}">
                    ${content ? this.formatMessage(content) : '<span class="text-gray-400">正在思考...</span>'}
                </div>
            `;
        }

        messagesContainer.appendChild(messageElement);
        this.scrollToBottom();

        return messageElement;
    }

    

    

    updateMessageContent(element, content) {
        // 处理Unicode转义字符
        content = this.unescapeUnicodeChars(content);
        element.innerHTML = this.formatMessage(content);
        this.addCopyButtons();
    }

    formatMessage(content) {
        // 1. 先处理可能存在的Unicode转义字符
        let processedContent = this.unescapeUnicodeChars(content);

        // 2. 初始化代码存储
        if (!window.codeStorage) {
            window.codeStorage = new Map();
        }

        // 3. 分割内容为普通文本和代码块
        const parts = this.splitContentIntoParts(processedContent);

        // 4. 处理每个部分
        let formattedContent = '';
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            if (part.type === 'text') {
                // 处理普通文本
                formattedContent += this.formatTextContent(part.content);
            } else if (part.type === 'code') {
                // 处理完整代码块
                formattedContent += this.formatCompleteCodeBlock(part.language, part.content);
            } else if (part.type === 'incomplete_code') {
                // 处理不完整的代码块（流式传输中）
                formattedContent += this.formatIncompleteCodeBlock(part.language, part.content);
            }
        }

        return formattedContent;
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
        let safeText = this.escapeHtml(text);

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
        const escapedCode = this.escapeHtml(cleanCode);

        // 生成唯一ID来存储代码
        const codeId = 'code_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        window.codeStorage.set(codeId, cleanCode);

        return `
            <div class="code-block relative bg-gray-800 rounded-lg mt-2 mb-2">
                <div class="flex justify-between items-center px-4 py-2 bg-gray-700 rounded-t-lg">
                    <span class="text-sm text-gray-300">${language}</span>
                    <div class="flex space-x-2">
                        ${language.toLowerCase() === 'html' ? `<button class="render-html-btn text-gray-400 hover:text-white text-sm" data-code-id="${codeId}">🎨 渲染</button>` : ''}
                        <button class="copy-code-btn text-gray-400 hover:text-white text-sm" data-code-id="${codeId}">📋 复制</button>
                    </div>
                </div>
                <pre class="p-4 overflow-x-auto"><code class="language-${language}">${escapedCode}</code></pre>
            </div>
        `;
    }

    formatIncompleteCodeBlock(language, code) {
        const escapedCode = this.escapeHtml(code);

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
        // 复制按钮事件
        document.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });

        document.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const codeId = btn.getAttribute('data-code-id');
                const code = window.codeStorage ? window.codeStorage.get(codeId) : '';
                if (code) {
                    navigator.clipboard.writeText(code).then(() => {
                        this.showNotification('代码已复制', 'success');
                    });
                } else {
                    this.showNotification('代码不存在', 'error');
                }
            });
        });

        // HTML渲染按钮事件
        document.querySelectorAll('.render-html-btn').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });

        document.querySelectorAll('.render-html-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const codeId = btn.getAttribute('data-code-id');
                const htmlCode = window.codeStorage ? window.codeStorage.get(codeId) : '';
                if (htmlCode) {
                    this.showHtmlPreview(htmlCode);
                } else {
                    this.showNotification('HTML代码不存在', 'error');
                }
            });
        });
    }

    showHtmlPreview(htmlCode) {
        // 确保HTML代码经过正确的反转义处理
        const cleanHtmlCode = this.unescapeUnicodeChars(htmlCode);

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
                            <pre class="bg-gray-900 p-4 rounded h-96 overflow-auto"><code class="language-html">${this.escapeHtml(cleanHtmlCode)}</code></pre>
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
            hljs.highlightElement(modal.querySelector('code'));
        }
    }

    handleTextSelection(e) {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText && selectedText.length > 3) {
            // 检查选择是否在AI消息中
            let aiMessage = e.target.closest('.ai-message');

            // 如果没有找到，尝试通过选择范围查找
            if (!aiMessage && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                let container = range.commonAncestorContainer;

                // 如果是文本节点，获取其父元素
                if (container.nodeType === Node.TEXT_NODE) {
                    container = container.parentElement;
                }

                aiMessage = container.closest('.ai-message');
            }

            if (aiMessage) {
                // 获取选择的边界矩形
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // 使用选择区域的中心位置
                const x = rect.left + rect.width / 2;
                const y = rect.top - 10;

                this.showTooltip(x, y, selectedText, aiMessage);
            }
        } else {
            this.hideTooltip();
        }
    }

    showTooltip(x, y, selectedText, messageElement) {
        this.hideTooltip();

        if (!this.config || !this.config.commands) {
            console.log('Config not loaded yet');
            return;
        }

        const template = document.getElementById('tooltipTemplate');
        if (!template) {
            console.log('Tooltip template not found');
            return;
        }

        const tooltip = template.content.cloneNode(true).querySelector('.tooltip');
        const buttonsContainer = tooltip.querySelector('div.flex.flex-wrap');
        const customInput = tooltip.querySelector('.custom-prompt-input');
        const customButton = tooltip.querySelector('.custom-prompt-btn');

        // 根据配置生成快捷按钮
        this.config.commands.forEach(command => {
            const button = document.createElement('button');
            button.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm whitespace-nowrap';
            button.textContent = command.label;
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleFollowup(selectedText, command, messageElement);
                this.hideTooltip();
            });
            buttonsContainer.appendChild(button);
        });

        // 处理自定义输入框
        const handleCustomPrompt = () => {
            const customPrompt = customInput.value.trim();
            if (customPrompt) {
                const customCommand = {
                    label: '自定义',
                    prompt: customPrompt + '\n'
                };
                this.handleFollowup(selectedText, customCommand, messageElement);
                this.hideTooltip();
            }
        };

        customButton.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCustomPrompt();
        });

        customInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                handleCustomPrompt();
            }
        });

        // 阻止输入框点击事件冒泡
        customInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 计算tooltip位置，确保在视窗内
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const tooltipWidth = 300; // 预估宽度
        const tooltipHeight = 50; // 预估高度

        let finalX = Math.min(x, viewportWidth - tooltipWidth);
        let finalY = Math.max(y - tooltipHeight - 10, 10);

        // 如果在顶部空间不够，显示在下方
        if (finalY < 10) {
            finalY = y + 20;
        }

        // 定位tooltip
        tooltip.style.position = 'fixed';
        tooltip.style.left = finalX + 'px';
        tooltip.style.top = finalY + 'px';
        tooltip.style.zIndex = '1000';
        tooltip.id = 'activeTooltip';

        document.body.appendChild(tooltip);

        // 自动聚焦到输入框
        setTimeout(() => {
            const activeInput = document.querySelector('#activeTooltip .custom-prompt-input');
            if (activeInput) {
                activeInput.focus();
            }
        }, 50);

        console.log('Tooltip shown at:', finalX, finalY, 'for text:', selectedText.substring(0, 50));
    }

    hideTooltip() {
        const tooltip = document.getElementById('activeTooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }

    async handleFollowup(selectedText, command, originalMessage) {
        const originalContent = originalMessage.querySelector('.message-content').textContent;
        const followupPrompt = command.prompt + selectedText + '\n\n原始对话内容:\n' + originalContent;

        // 创建追问模态框
        const modal = this.createFollowupModal();
        document.body.appendChild(modal);

        const contentElement = modal.querySelector('.followup-content');
        contentElement.innerHTML = '<div class="text-gray-400">正在生成回答...</div>';

        try {
            const response = await fetch(this.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.model,
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
                                contentElement.innerHTML = this.formatMessage(fullResponse);
                                this.addCopyButtons();
                            }
                        } catch (e) {
                            // Ignore parsing errors
                        }
                    }
                }
            }

            this.logInteraction(followupPrompt, fullResponse, 'followup');

        } catch (error) {
            contentElement.innerHTML = `<p class="text-red-400">❌ 请求失败: ${error.message}</p>`;
        }
    }

    createFollowupModal() {
        const template = document.getElementById('followupModalTemplate');
        const modal = template.content.cloneNode(true).querySelector('.followup-modal');

        modal.querySelector('.close-followup').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        return modal;
    }

    async logInteraction(userInput, aiResponse, type) {
        try {
            await fetch('/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_input: userInput,
                    ai_response: aiResponse,
                    type: type
                })
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

    scrollToBottom() {
        const container = document.getElementById('chatContainer');
        container.scrollTop = container.scrollHeight;
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 px-4 py-2 rounded shadow-lg text-white z-50 ${
            type === 'success' ? 'bg-green-600' :
            type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
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
        if (!this.config || !this.config.commands) return;

        const shortcutsContainer = document.getElementById('inputShortcuts');
        const buttonsContainer = document.getElementById('shortcutButtons');

        // 清空现有按钮
        buttonsContainer.innerHTML = '';

        // 生成快捷按钮
        this.config.commands.forEach(command => {
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
        this.currentConversation.push({ role: 'user', content: fullPrompt });

        // 发送到AI
        this.getAIResponse(fullPrompt);
    }

    unescapeUnicodeChars(text) {
        // 处理常见的Unicode转义字符
        return text
            .replace(/\\u003c/g, '<')  // \u003c -> <
            .replace(/\\u003e/g, '>')  // \u003e -> >
            .replace(/\\u0026/g, '&')  // \u0026 -> &
            .replace(/\\u0022/g, '"')  // \u0022 -> "
            .replace(/\\u0027/g, "'")  // \u0027 -> '
            .replace(/\\u002f/g, '/')  // \u002f -> /
            .replace(/\\u003d/g, '=')  // \u003d -> =
            .replace(/\\u0020/g, ' ')  // \u0020 -> space
            .replace(/\\u000a/g, '\n') // \u000a -> newline
            .replace(/\\u000d/g, '\r') // \u000d -> carriage return
            .replace(/\\u0009/g, '\t') // \u0009 -> tab
            // 处理通用的Unicode转义模式 \uXXXX
            .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new AIAssistant();

    // 初始化代码高亮
    if (typeof hljs !== 'undefined') {
        hljs.highlightAll();
    }
});

// 处理页面可见性变化，暂停/恢复流
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Page is hidden');
    } else {
        console.log('Page is visible');
    }
});