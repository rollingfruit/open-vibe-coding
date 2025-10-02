class AIAssistant {
    constructor() {
        this.config = null;
        this.settings = this.loadSettings();
        this.sessions = []; // 所有会话的数组
        this.activeSessionId = null; // 当前活动会话ID
        this.isStreaming = false;
        this.isSearchActive = false; // 是否正在搜索模式
        this.searchIndex = null; // 搜索索引（可选）
        this.isDrawerCollapsed = false; // 抽屉是否折叠
        this.isNodeAxisCollapsed = false; // 节点轴是否折叠
        this.uploadedImageFile = null; // 待上传的图片文件
        this.uploadedImageBase64 = null; // 压缩后的Base64字符串
        this.themeToggleBtn = null; // 主题切换按钮
        this.currentTheme = 'light'; // 当前主题，默认为白天模式
        this.isAgentMode = false; // 是否处于Agent模式
        this.agentHandler = null; // Agent处理器

        // 知识库相关
        this.viewMode = 'chat'; // 'chat' or 'editor'
        this.notes = []; // 笔记列表
        this.activeNoteId = null; // 当前编辑的笔记ID
        this.editorInstance = null; // 编辑器实例
        this.knowledgeAgentHandler = null; // 知识库Copilot处理器
        this.isEditorPreview = false; // 编辑器预览模式
        this.autoSaveTimeout = null; // 自动保存定时器
        this.notesWebSocket = null; // WebSocket连接

        // 初始化代码存储
        if (!window.codeStorage) {
            window.codeStorage = new Map();
        }

        // 配置 marked.js
        this.configureMarked();

        this.init();
    }

    async init() {
        await this.loadConfig();
        this.agentHandler = new AgentHandler(this); // 初始化Agent处理器
        this.knowledgeAgentHandler = new KnowledgeAgentHandler(this); // 初始化知识库Agent
        this.bindEvents();
        this.loadThemePreference();
        this.checkUrlParams();
        this.loadSessions();
        this.loadNotes(); // 加载笔记列表
        this.initNotesWebSocket(); // 初始化WebSocket连接
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
            model: 'gpt-5-nano-2025-08-07'
        };
    }

    saveSettings() {
        localStorage.setItem('aiAssistantSettings', JSON.stringify(this.settings));
    }

    loadSessions() {
        const stored = localStorage.getItem('aiAssistantSessions');
        if (stored) {
            this.sessions = JSON.parse(stored);
        }

        // 如果没有会话，创建一个默认会话
        if (this.sessions.length === 0) {
            this.createNewSession('新对话', true);
        } else {
            // 设置最后一个会话为活动会话
            this.activeSessionId = this.sessions[this.sessions.length - 1].id;
        }

        this.renderSessionList();
        this.renderActiveSessionMessages();
        this.updateCurrentSessionTitle();

        // 检查并显示摘要
        const activeSession = this.getActiveSession();
        if (activeSession && activeSession.summary) {
            this.showSummary(activeSession.summary);
        }

        // 更新Token用量
        this.updateTokenUsage();

        // 渲染节点轴
        this.renderNodeAxis();
    }

    saveSessions() {
        localStorage.setItem('aiAssistantSessions', JSON.stringify(this.sessions));
    }

    // 会话管理方法
    createNewSession(title = null, isDefault = false) {
        const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newSession = {
            id: sessionId,
            title: title || '新对话',
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            totalTokens: 0  // 用于Agent模式的精确token统计
        };

        this.sessions.push(newSession);
        this.activeSessionId = sessionId;

        if (!isDefault) {
            this.saveSessions();
            this.renderSessionList();
            this.updateCurrentSessionTitle();

            // 清空聊天区域并显示欢迎消息
            document.getElementById('messages').innerHTML = '';
            this.addWelcomeMessage();

            // 隐藏摘要并更新Token用量
            this.hideSummary();
            this.updateTokenUsage();

            // 刷新节点轴
            this.renderNodeAxis();

            this.showNotification('已创建新会话', 'success');
        }

        return newSession;
    }

    switchSession(sessionId) {
        this.activeSessionId = sessionId;
        this.renderActiveSessionMessages();
        this.renderSessionList(); // 更新选中状态
        this.updateCurrentSessionTitle();

        // 退出搜索模式
        this.exitSearchMode();

        // 检查并显示摘要
        const activeSession = this.getActiveSession();
        if (activeSession && activeSession.summary) {
            this.showSummary(activeSession.summary);
        } else {
            this.hideSummary();
        }

        // 更新Token用量
        this.updateTokenUsage();

        // 刷新节点轴
        this.renderNodeAxis();
    }

    getActiveSession() {
        return this.sessions.find(session => session.id === this.activeSessionId);
    }

    updateSessionTitle(sessionId, newTitle) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.title = newTitle;
            session.updatedAt = new Date().toISOString();
            this.saveSessions();
            this.renderSessionList();
            this.updateCurrentSessionTitle();
        }
    }

    updateCurrentSessionTitle() {
        const activeSession = this.getActiveSession();
        const titleElement = document.getElementById('currentSessionTitle');
        if (titleElement && activeSession) {
            titleElement.textContent = `- ${activeSession.title}`;
        }
    }

    /**
     * 添加token到当前会话
     */
    addTokensToCurrentSession(tokenCount) {
        const activeSession = this.getActiveSession();
        if (activeSession) {
            // 初始化totalTokens字段（兼容旧数据）
            if (typeof activeSession.totalTokens !== 'number') {
                activeSession.totalTokens = 0;
            }
            activeSession.totalTokens += tokenCount;
            activeSession.updatedAt = new Date().toISOString();
            // 不在这里调用saveSessions，由调用方决定何时保存
        }
    }

    updateTokenUsage() {
        const activeSession = this.getActiveSession();
        if (!activeSession || !this.config || !this.config.apiSettings) {
            return;
        }

        // 使用maxContextTokens作为会话支持的最大token数
        const maxTokens = this.config.apiSettings.maxContextTokens || 20000;
        let currentTokens = 0;

        // 检查是否是Agent模式（会话中有agent_开头的消息类型）
        const hasAgentMessages = activeSession.messages.some(msg => msg.type && msg.type.startsWith('agent_'));

        if (hasAgentMessages && typeof activeSession.totalTokens === 'number') {
            // Agent模式：使用精确的token统计
            currentTokens = activeSession.totalTokens;
        } else if (activeSession.summary) {
            // 如果已压缩，只计算摘要的长度
            currentTokens = activeSession.summary.length;
            // 加上压缩点之后的新消息
            if (activeSession.summarySplitIndex !== undefined) {
                const newMessages = activeSession.messages.slice(activeSession.summarySplitIndex);
                currentTokens += newMessages.reduce((sum, msg) => sum + msg.content.length, 0);
            }
        } else {
            // 未压缩，计算所有消息的长度
            currentTokens = activeSession.messages.reduce((sum, msg) => sum + msg.content.length, 0);
        }

        // 计算百分比
        const percentage = Math.min(100, Math.round((currentTokens / maxTokens) * 100));

        // 更新UI
        const tokenPercentage = document.getElementById('tokenPercentage');
        const tokenProgressCircle = document.getElementById('tokenProgressCircle');
        const tokenIndicator = document.getElementById('tokenIndicator');
        const compressBtn = document.getElementById('compressContextBtn');

        if (tokenPercentage && tokenProgressCircle && tokenIndicator && compressBtn) {
            tokenPercentage.textContent = `${percentage}%`;

            // 计算圆形进度条的stroke-dashoffset
            const circumference = 2 * Math.PI * 16; // 半径为16
            const offset = circumference - (percentage / 100) * circumference;
            tokenProgressCircle.style.strokeDashoffset = offset;

            // 根据百分比改变颜色
            tokenIndicator.classList.remove('warning', 'danger');
            if (percentage >= 80) {
                tokenIndicator.classList.add('danger');
                // 显示压缩按钮（仅当未压缩过）
                if (!activeSession.summary) {
                    compressBtn.classList.remove('hidden');
                } else {
                    compressBtn.classList.add('hidden');
                }
            } else if (percentage >= 60) {
                tokenIndicator.classList.add('warning');
                compressBtn.classList.add('hidden');
            } else {
                compressBtn.classList.add('hidden');
            }
        }
    }

    async compressContext() {
        const activeSession = this.getActiveSession();
        if (!activeSession || activeSession.messages.length === 0) {
            this.showNotification('当前会话没有可压缩的内容', 'error');
            return;
        }

        if (activeSession.summary) {
            this.showNotification('当前会话已经压缩过了', 'error');
            return;
        }

        // 显示加载提示
        this.showNotification('正在压缩上下文...', 'info');

        try {
            // 构造摘要请求
            let conversationText = '请将以下对话内容进行简洁的总结，保留核心上下文信息、关键要点和重要细节：\n\n';
            activeSession.messages.forEach((msg, index) => {
                const role = msg.role === 'user' ? '用户' : 'AI助手';
                conversationText += `${role}: ${msg.content}\n\n`;
            });

            // 调用AI生成摘要
            const response = await fetch(this.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: [{ role: 'user', content: conversationText }],
                    stream: false,
                    temperature: 0.5,
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const summary = data.choices?.[0]?.message?.content || '';

            if (!summary) {
                throw new Error('未能生成摘要');
            }

            // 保存摘要和压缩点
            activeSession.summary = summary;
            activeSession.summarySplitIndex = activeSession.messages.length;
            activeSession.updatedAt = new Date().toISOString();

            // 保存到localStorage
            this.saveSessions();

            // 更新UI
            this.showSummary(summary);
            this.updateTokenUsage();

            this.showNotification('上下文压缩完成！', 'success');

        } catch (error) {
            console.error('压缩上下文失败:', error);
            this.showNotification(`压缩失败: ${error.message}`, 'error');
        }
    }

    showSummary(summary) {
        const summaryContainer = document.getElementById('summaryContainer');
        const summaryContent = document.getElementById('summaryContent');

        if (summaryContainer && summaryContent) {
            summaryContent.innerHTML = this.escapeHtml(summary).replace(/\n/g, '<br>');
            summaryContainer.classList.remove('hidden');
        }
    }

    hideSummary() {
        const summaryContainer = document.getElementById('summaryContainer');
        if (summaryContainer) {
            summaryContainer.classList.add('hidden');
        }
    }

    generateSessionTitle(firstMessage) {
        // 从第一条消息生成会话标题
        if (!firstMessage) return '新对话';

        const truncated = firstMessage.length > 20 ?
            firstMessage.substring(0, 20) + '...' :
            firstMessage;

        return truncated;
    }


    deleteSession(sessionId) {
        // 防止删除最后一个会话
        if (this.sessions.length <= 1) {
            this.showNotification('至少需要保留一个会话', 'error');
            return;
        }

        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            return;
        }

        // 确认删除
        if (!confirm(`确定要删除会话"${session.title}"吗？此操作不可撤销。`)) {
            return;
        }

        // 从数组中移除会话
        this.sessions = this.sessions.filter(s => s.id !== sessionId);

        // 如果删除的是当前活动会话，切换到最新的会话
        if (this.activeSessionId === sessionId) {
            if (this.sessions.length > 0) {
                this.activeSessionId = this.sessions[this.sessions.length - 1].id;
                this.renderActiveSessionMessages();
                this.updateCurrentSessionTitle();
            }
        }

        // 保存更新并重新渲染列表
        this.saveSessions();
        this.renderSessionList();

        this.showNotification('会话已删除', 'success');
    }

    // 搜索功能方法
    performSearch(query) {
        if (!query.trim()) {
            this.exitSearchMode();
            return;
        }

        this.isSearchActive = true;
        const results = this.searchInAllSessions(query);
        this.renderSearchResults(results);
    }

    searchInAllSessions(query) {
        const results = [];
        const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);

        this.sessions.forEach(session => {
            session.messages.forEach((message, messageIndex) => {
                // 提取消息文本内容
                let textContent = '';
                if (typeof message.content === 'string') {
                    textContent = message.content;
                } else if (message.content && typeof message.content === 'object') {
                    // 处理多模态内容（content可能是对象，包含text字段）
                    textContent = message.content.text || '';
                }

                if (!textContent) return; // 跳过空消息

                const content = textContent.toLowerCase();
                let matchCount = 0;
                let highlights = [];

                // 检查每个搜索词是否在消息中
                searchTerms.forEach(term => {
                    if (content.includes(term)) {
                        matchCount++;
                        // 找到匹配位置用于高亮
                        let index = content.indexOf(term);
                        while (index !== -1) {
                            highlights.push({ start: index, end: index + term.length });
                            index = content.indexOf(term, index + 1);
                        }
                    }
                });

                // 如果所有搜索词都匹配，则添加到结果中
                if (matchCount === searchTerms.length) {
                    results.push({
                        sessionId: session.id,
                        sessionTitle: session.title,
                        messageIndex: messageIndex,
                        messageContent: textContent, // 使用提取的文本内容
                        messageRole: message.role,
                        highlights: highlights,
                        score: matchCount / searchTerms.length // 简单的相关性评分
                    });
                }
            });
        });

        // 按相关性排序
        results.sort((a, b) => b.score - a.score);
        return results;
    }

    renderSearchResults(results) {
        const sessionList = document.getElementById('sessionList');
        const searchResultsContainer = document.getElementById('searchResultsContainer');
        const searchResults = document.getElementById('searchResults');

        // 隐藏会话列表，显示搜索结果
        sessionList.style.display = 'none';
        searchResultsContainer.classList.remove('hidden');

        searchResults.innerHTML = '';

        if (results.length === 0) {
            searchResults.innerHTML = '<div class="p-3 text-gray-400 text-sm">没有找到匹配的结果</div>';
            return;
        }

        results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item cursor-pointer p-3 rounded hover:bg-gray-700 transition-colors border-l-2 border-blue-500';

            // 截取消息内容片段
            const snippet = this.createSearchSnippet(result.messageContent, result.highlights);

            const roleIcon = result.messageRole === 'user' ?
                `<i data-lucide="user" class="w-4 h-4 text-blue-400"></i>` :
                `<i data-lucide="bot" class="w-4 h-4 text-green-400"></i>`;

            resultItem.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <span class="text-sm font-medium text-blue-400">${this.escapeHtml(result.sessionTitle)}</span>
                    <span class="text-xs text-gray-500">${roleIcon}</span>
                </div>
                <div class="text-sm text-gray-300 leading-relaxed">${snippet}</div>
            `;

            resultItem.addEventListener('click', () => {
                this.goToSearchResult(result.sessionId, result.messageIndex);
            });

            searchResults.appendChild(resultItem);
        });

        // Reinitialize icons for search results
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    createSearchSnippet(content, highlights) {
        // 创建带高亮的内容片段
        let snippet = content;
        if (snippet.length > 200) {
            // 找到第一个高亮位置附近的内容
            if (highlights.length > 0) {
                const firstHighlight = highlights[0];
                const start = Math.max(0, firstHighlight.start - 50);
                const end = Math.min(content.length, firstHighlight.end + 150);
                snippet = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
            } else {
                snippet = content.substring(0, 200) + '...';
            }
        }

        return this.escapeHtml(snippet);
    }

    exitSearchMode() {
        this.isSearchActive = false;
        const sessionList = document.getElementById('sessionList');
        const searchResultsContainer = document.getElementById('searchResultsContainer');
        const searchInput = document.getElementById('searchInput');

        sessionList.style.display = 'block';
        searchResultsContainer.classList.add('hidden');
        searchInput.value = '';
    }

    goToSearchResult(sessionId, messageIndex) {
        // 切换到指定会话
        this.switchSession(sessionId);

        // 等待消息渲染完成后滚动到指定消息
        setTimeout(() => {
            const messageElement = document.querySelector(`[data-message-index="${messageIndex}"]`);
            if (messageElement) {
                messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // 添加临时高亮效果
                messageElement.classList.add('highlight-search-result');
                setTimeout(() => {
                    messageElement.classList.remove('highlight-search-result');
                }, 3000);
            }
        }, 100);

        this.showNotification('已跳转到搜索结果', 'success');
    }

    // 移动端抽屉切换
    toggleDrawer() {
        const drawer = document.getElementById('sessionDrawer');
        if (drawer.classList.contains('hidden')) {
            drawer.classList.remove('hidden');
        } else {
            drawer.classList.add('hidden');
        }
    }

    // 抽屉折叠/展开切换
    toggleDrawerCollapse() {
        this.isDrawerCollapsed = !this.isDrawerCollapsed;
        const drawer = document.getElementById('sessionDrawer');

        if (this.isDrawerCollapsed) {
            drawer.classList.add('collapsed');
            this.renderCollapsedSessionList();
        } else {
            drawer.classList.remove('collapsed');
            // 退出搜索模式并重新渲染正常列表
            this.exitSearchMode();
            this.renderSessionList();
        }
    }

    // 渲染折叠状态下的会话图标列表
    renderCollapsedSessionList() {
        const collapsedList = document.getElementById('collapsedSessionList');
        collapsedList.innerHTML = '';

        this.sessions.slice().reverse().forEach((session, index) => {
            const iconItem = document.createElement('div');
            iconItem.className = `collapsed-session-item ${
                session.id === this.activeSessionId ? 'active' : ''
            }`;

            // 生成会话图标（取标题首字符或默认图标）
            const iconText = session.title === '新对话' ? '💬' :
                            (session.title.charAt(0) || '💬');

            iconItem.innerHTML = `
                <span class="session-icon">${iconText}</span>
                <div class="delete-btn-collapsed" data-session-id="${session.id}">
                    <i data-lucide="x" class="w-3 h-3"></i>
                </div>
                <div class="tooltip-collapsed">${this.escapeHtml(session.title)}</div>
            `;

            // 点击切换会话
            iconItem.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-btn-collapsed')) {
                    return;
                }
                this.switchSession(session.id);
            });

            // 删除按钮事件
            const deleteBtn = iconItem.querySelector('.delete-btn-collapsed');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSession(session.id);
            });

            collapsedList.appendChild(iconItem);
        });

        // Reinitialize icons for collapsed list
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    // 重写renderSessionList方法，考虑折叠状态
    renderSessionList() {
        if (this.isDrawerCollapsed) {
            this.renderCollapsedSessionList();
            return;
        }

        const sessionList = document.getElementById('sessionList');
        sessionList.innerHTML = '';

        this.sessions.slice().reverse().forEach(session => {
            const listItem = document.createElement('li');
            listItem.className = `session-item cursor-pointer p-3 rounded hover:bg-gray-700 transition-colors ${
                session.id === this.activeSessionId ? 'bg-blue-600' : ''
            }`;

            listItem.innerHTML = `
                <div class="flex justify-between items-start">
                    <div class="flex-1 min-w-0">
                        <div class="session-title font-medium text-sm truncate">${this.escapeHtml(session.title)}</div>
                        <div class="session-info text-xs text-gray-400 mt-1 flex items-center gap-2">
                            <span class="flex items-center gap-1">
                                <i data-lucide="message-circle" class="w-3 h-3"></i>
                                <span>${session.messages.length}</span>
                            </span>
                            <span class="flex items-center gap-1">
                                <i data-lucide="clock" class="w-3 h-3"></i>
                                <span>${new Date(session.updatedAt).toLocaleDateString()}</span>
                            </span>
                        </div>
                    </div>
                    <button class="delete-session-btn opacity-0 transition-opacity duration-200 text-gray-400 hover:text-red-400 p-1"
                            data-session-id="${session.id}"
                            title="删除会话">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            `;

            // 点击会话项切换会话
            listItem.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，不执行切换
                if (e.target.classList.contains('delete-session-btn')) {
                    return;
                }
                this.switchSession(session.id);
            });

            // 悬浮显示删除按钮
            listItem.addEventListener('mouseenter', () => {
                const deleteBtn = listItem.querySelector('.delete-session-btn');
                deleteBtn.classList.remove('opacity-0');
                deleteBtn.classList.add('opacity-100');
            });

            listItem.addEventListener('mouseleave', () => {
                const deleteBtn = listItem.querySelector('.delete-session-btn');
                deleteBtn.classList.remove('opacity-100');
                deleteBtn.classList.add('opacity-0');
            });

            // 删除按钮事件
            const deleteBtn = listItem.querySelector('.delete-session-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSession(session.id);
            });

            sessionList.appendChild(listItem);
        });

        // Reinitialize icons for session list
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    renderActiveSessionMessages() {
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = '';

        const activeSession = this.getActiveSession();
        if (!activeSession) {
            this.addWelcomeMessage();
            return;
        }

        if (activeSession.messages.length === 0) {
            this.addWelcomeMessage();
            return;
        }

        // 用于追踪Agent消息气泡
        let currentAgentBubble = null;
        let currentAgentContainer = null;

        activeSession.messages.forEach((msg, index) => {
            // 检查是否是Agent相关消息
            if (msg.type && msg.type.startsWith('agent_')) {
                // 如果还没有Agent气泡，创建一个
                if (!currentAgentBubble) {
                    currentAgentBubble = document.createElement('div');
                    currentAgentBubble.className = 'message-bubble ai-message animate__animated animate__fadeInUp agent-message-bubble';
                    currentAgentBubble.setAttribute('data-message-index', index);
                    currentAgentBubble.innerHTML = `
                        <div class="mb-2 flex items-center gap-2">
                            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 8V4H8'/%3E%3Crect width='16' height='12' x='4' y='8' rx='2'/%3E%3Cpath d='M2 14h2'/%3E%3Cpath d='M20 14h2'/%3E%3Cpath d='M15 13v2'/%3E%3Cpath d='M9 13v2'/%3E%3C/svg%3E" class="w-6 h-6" alt="AI">
                            <span class="text-green-400 font-semibold">Agent执行过程</span>
                            <span class="text-gray-400 text-sm ml-2">历史记录</span>
                        </div>
                        <div class="message-content agent-trace-content"></div>
                    `;
                    messagesContainer.appendChild(currentAgentBubble);
                    currentAgentContainer = currentAgentBubble.querySelector('.agent-trace-content');
                }

                // 根据不同的Agent消息类型渲染
                this.renderAgentMessage(msg, currentAgentContainer, index);

                // 如果是最终答案，结束当前Agent气泡
                if (msg.type === 'agent_final_answer') {
                    currentAgentBubble = null;
                    currentAgentContainer = null;
                }
            } else if (msg.role === 'user') {
                // 结束当前Agent气泡（如果有）
                currentAgentBubble = null;
                currentAgentContainer = null;

                // 处理消息内容，可能是字符串或多模态数组
                let textContent = '';
                if (typeof msg.content === 'string') {
                    textContent = msg.content;
                } else if (Array.isArray(msg.content)) {
                    // 从数组中提取文本内容
                    const textPart = msg.content.find(part => part.type === 'text');
                    textContent = textPart?.text || '';
                } else if (msg.content?.text) {
                    textContent = msg.content.text;
                }

                const messageEl = this.addMessage(textContent, 'user', false, msg.imageUrl);
                messageEl.setAttribute('data-message-index', index);
            } else if (msg.role === 'assistant') {
                // 结束当前Agent气泡（如果有）
                currentAgentBubble = null;
                currentAgentContainer = null;

                const messageEl = this.addMessage(msg.content, 'ai', false);
                messageEl.setAttribute('data-message-index', index);
            }
        });

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
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

        // 新建会话按钮（顶部的➕新建按钮）
        document.getElementById('clearBtn').addEventListener('click', () => {
            this.createNewSession();
        });

        // 左侧抽屉的新建按钮
        document.getElementById('newSessionBtn').addEventListener('click', () => {
            this.createNewSession();
        });

        // 折叠状态的新建按钮
        document.getElementById('newSessionCollapsedBtn').addEventListener('click', () => {
            this.createNewSession();
        });

        // 折叠抽屉按钮
        document.getElementById('toggleDrawerCollapseBtn').addEventListener('click', () => {
            this.toggleDrawerCollapse();
        });

        // 展开抽屉按钮
        document.getElementById('expandDrawerBtn').addEventListener('click', () => {
            this.toggleDrawerCollapse();
        });

        // 压缩上下文按钮
        document.getElementById('compressContextBtn').addEventListener('click', () => {
            this.compressContext();
        });

        // 抽屉切换按钮（移动端）
        const toggleDrawerBtn = document.getElementById('toggleDrawerBtn');
        if (toggleDrawerBtn) {
            toggleDrawerBtn.addEventListener('click', () => {
                this.toggleDrawer();
            });
        }

        // 搜索输入框
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value.trim();
            // 防抖搜索
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.performSearch(query);
            }, 300);
        });

        // 节点轴折叠/展开按钮
        const nodeAxisHeader = document.getElementById('nodeAxisHeader');
        if (nodeAxisHeader) {
            nodeAxisHeader.addEventListener('click', () => {
                this.toggleNodeAxis();
            });
        }

        // 节点轴点击事件
        const nodeAxisSvg = document.getElementById('nodeAxisSvg');
        if (nodeAxisSvg) {
            nodeAxisSvg.addEventListener('click', (e) => {
                this.handleNodeClick(e);
            });
        }

        // 主题切换按钮事件
        this.themeToggleBtn = document.getElementById('themeToggleBtn');
        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', () => {
                this.toggleTheme();
            });
        }

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

        // 图片上传相关事件
        document.getElementById('uploadImageBtn').addEventListener('click', () => {
            document.getElementById('imageUploadInput').click();
        });

        document.getElementById('imageUploadInput').addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.handleImageSelection(e.target.files[0]);
            }
        });

        document.getElementById('removeImageBtn').addEventListener('click', () => {
            this.removeImage();
        });

        // Agent模式按钮事件
        document.getElementById('agentModeBtn').addEventListener('click', () => {
            this.toggleAgentMode();
        });

        // 粘贴图片事件
        messageInput.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (items) {
                for (let item of items) {
                    if (item.type.indexOf('image') !== -1) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (file) {
                            this.handleImageSelection(file);
                        }
                        break;
                    }
                }
            }
        });

        // 拖拽上传事件
        const inputContainer = document.getElementById('inputContainer');
        const chatForm = document.getElementById('chatForm');

        ['dragenter', 'dragover'].forEach(eventName => {
            chatForm.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                inputContainer.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            chatForm.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                inputContainer.classList.remove('drag-over');
            });
        });

        chatForm.addEventListener('drop', (e) => {
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/')) {
                    this.handleImageSelection(file);
                }
            }
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

        // ====== 知识库相关事件 ======

        // 返回聊天按钮
        const backToChatBtn = document.getElementById('backToChatBtn');
        if (backToChatBtn) {
            backToChatBtn.addEventListener('click', () => {
                this.switchToChatMode();
            });
        }

        // 保存笔记按钮
        const saveNoteBtn = document.getElementById('saveNoteBtn');
        if (saveNoteBtn) {
            saveNoteBtn.addEventListener('click', () => {
                this.saveActiveNote();
            });
        }

        // 新建笔记按钮
        const newNoteBtn = document.getElementById('newNoteBtn');
        if (newNoteBtn) {
            newNoteBtn.addEventListener('click', () => {
                this.createNewNote();
            });
        }

        // 新建文件夹按钮
        const newFolderBtn = document.getElementById('newFolderBtn');
        if (newFolderBtn) {
            newFolderBtn.addEventListener('click', () => {
                this.createNewFolder();
            });
        }

        // 知识库抽屉折叠/展开按钮
        const toggleKnowledgeDrawerBtn = document.getElementById('toggleKnowledgeDrawerBtn');
        if (toggleKnowledgeDrawerBtn) {
            toggleKnowledgeDrawerBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.toggleKnowledgeDrawer();
            });
        }

        const expandKnowledgeDrawerBtn = document.getElementById('expandKnowledgeDrawerBtn');
        if (expandKnowledgeDrawerBtn) {
            expandKnowledgeDrawerBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.toggleKnowledgeDrawer();
            });
        }

        // Copilot输入框事件
        const copilotInput = document.getElementById('copilotInput');
        const copilotSendBtn = document.getElementById('copilotSendBtn');

        if (copilotSendBtn) {
            copilotSendBtn.addEventListener('click', () => {
                this.sendCopilotMessage();
            });
        }

        if (copilotInput) {
            copilotInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendCopilotMessage();
                }
            });
        }

        // 笔记搜索
        const noteSearch = document.getElementById('noteSearch');
        if (noteSearch) {
            noteSearch.addEventListener('input', (e) => {
                // TODO: 实现笔记搜索
                console.log('搜索笔记:', e.target.value);
            });
        }

        // 切换预览按钮
        const togglePreviewBtn = document.getElementById('togglePreviewBtn');
        if (togglePreviewBtn) {
            togglePreviewBtn.addEventListener('click', () => {
                this.toggleEditorPreview();
            });
        }

        // 笔记列表右键菜单事件
        const notesList = document.getElementById('notesList');
        if (notesList) {
            notesList.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e);
            });
        }

        // 编辑器输入事件 - 实时更新预览 + 自动保存
        const noteEditor = document.getElementById('noteEditor');
        if (noteEditor) {
            noteEditor.addEventListener('input', () => {
                // 实时更新预览
                if (this.isEditorPreview) {
                    this.updateEditorPreview();
                }

                // 自动保存（防抖5秒）
                clearTimeout(this.autoSaveTimeout);
                this.autoSaveTimeout = setTimeout(() => {
                    this.saveActiveNote();
                }, 5000);
            });

            // 编辑器拖拽上传图片事件
            noteEditor.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                noteEditor.classList.add('drag-over');
            });

            noteEditor.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                noteEditor.classList.remove('drag-over');
            });

            noteEditor.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                noteEditor.classList.remove('drag-over');
                this.handleEditorImageDrop(e);
            });
        }

        // Wiki链接和标签点击事件委托
        document.addEventListener('click', (e) => {
            // Wiki链接点击
            const wikiLink = e.target.closest('.internal-link');
            if (wikiLink) {
                e.preventDefault();
                const noteId = wikiLink.getAttribute('data-note-id');
                if (noteId) {
                    this.handleWikiLinkClick(noteId);
                }
                return;
            }

            // 标签点击
            const tagLink = e.target.closest('.tag-link');
            if (tagLink) {
                e.preventDefault();
                const tag = tagLink.getAttribute('data-tag');
                if (tag) {
                    this.handleTagClick(tag);
                }
                return;
            }
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

        // 加载LLM配置
        document.getElementById('apiKeyInput').value = this.settings.apiKey;
        document.getElementById('apiEndpointInput').value = this.settings.endpoint;
        document.getElementById('modelSelect').value = this.settings.model;

        // 加载知识库配置
        const imageStorageMode = this.config?.knowledgeBase?.imageStorage?.mode || 'fixed';
        document.getElementById('imageStorageModeSelect').value = imageStorageMode;

        // 加载划词指令配置
        this.renderCommandsList();

        // 绑定标签页切换事件
        this.bindSettingsTabEvents();

        modal.classList.remove('hidden');

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    hideSettings() {
        document.getElementById('settingsModal').classList.add('hidden');
    }

    bindSettingsTabEvents() {
        const tabButtons = document.querySelectorAll('.settings-tab-btn');
        const panels = document.querySelectorAll('.settings-panel');

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // 移除所有激活状态
                tabButtons.forEach(b => b.classList.remove('bg-gray-700'));
                panels.forEach(p => p.classList.add('hidden'));

                // 激活当前标签
                btn.classList.add('bg-gray-700');
                const tabName = btn.dataset.tab;
                const panelId = `${tabName}SettingsPanel`;
                document.getElementById(panelId).classList.remove('hidden');
            });
        });
    }

    renderCommandsList() {
        const commandsList = document.getElementById('commandsList');
        commandsList.innerHTML = '';

        const commands = this.config?.commands || [];

        commands.forEach((cmd, index) => {
            const cmdItem = document.createElement('div');
            cmdItem.className = 'bg-gray-700 p-3 rounded border border-gray-600';
            cmdItem.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <input
                        type="text"
                        value="${this.escapeHtml(cmd.label)}"
                        class="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm mr-2 command-label"
                        placeholder="指令标签"
                        data-index="${index}"
                    >
                    <button class="delete-command-btn px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-sm" data-index="${index}">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
                <textarea
                    class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm command-prompt resize-none"
                    placeholder="提示词模板"
                    rows="2"
                    data-index="${index}"
                >${this.escapeHtml(cmd.prompt)}</textarea>
            `;
            commandsList.appendChild(cmdItem);
        });

        // 绑定删除按钮事件
        document.querySelectorAll('.delete-command-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                this.deleteCommand(index);
            });
        });

        // 绑定添加按钮事件
        const addBtn = document.getElementById('addCommandBtn');
        if (addBtn) {
            addBtn.replaceWith(addBtn.cloneNode(true)); // 移除旧事件
            document.getElementById('addCommandBtn').addEventListener('click', () => {
                this.addCommand();
            });
        }

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    addCommand() {
        if (!this.config.commands) {
            this.config.commands = [];
        }
        this.config.commands.push({
            label: '新指令',
            prompt: '请输入提示词：\n'
        });
        this.renderCommandsList();
    }

    deleteCommand(index) {
        if (confirm('确定要删除这个指令吗？')) {
            this.config.commands.splice(index, 1);
            this.renderCommandsList();
        }
    }

    async saveSettingsFromModal() {
        // 保存LLM配置到localStorage
        this.settings.apiKey = document.getElementById('apiKeyInput').value;
        this.settings.endpoint = document.getElementById('apiEndpointInput').value;
        this.settings.model = document.getElementById('modelSelect').value;
        this.saveSettings();

        // 保存划词指令配置
        const commandLabels = document.querySelectorAll('.command-label');
        const commandPrompts = document.querySelectorAll('.command-prompt');

        this.config.commands = Array.from(commandLabels).map((label, index) => ({
            label: label.value,
            prompt: commandPrompts[index].value
        }));

        // 保存知识库配置
        if (!this.config.knowledgeBase) {
            this.config.knowledgeBase = {};
        }
        if (!this.config.knowledgeBase.imageStorage) {
            this.config.knowledgeBase.imageStorage = {};
        }
        this.config.knowledgeBase.imageStorage.mode = document.getElementById('imageStorageModeSelect').value;

        // 将配置保存到config.json
        try {
            const response = await fetch('http://localhost:8080/api/save-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(this.config)
            });

            if (!response.ok) {
                throw new Error('保存配置失败');
            }

            this.hideSettings();
            this.showNotification('设置已保存', 'success');
        } catch (error) {
            console.error('保存配置失败:', error);
            this.showNotification('保存配置失败: ' + error.message, 'error');
        }
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
        const aiAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 8V4H8'/%3E%3Crect width='16' height='12' x='4' y='8' rx='2'/%3E%3Cpath d='M2 14h2'/%3E%3Cpath d='M20 14h2'/%3E%3Cpath d='M15 13v2'/%3E%3Cpath d='M9 13v2'/%3E%3C/svg%3E`;
        const welcomeHTML = `
            <div class="message-bubble ai-message animate__animated animate__fadeInUp">
                <div class="mb-2 flex items-center gap-2">
                    <img src="${aiAvatar}" class="w-6 h-6" alt="AI">
                    <span class="text-green-400 font-semibold">AI助手</span>
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

        // 检查是否有消息或图片
        if (!message && !this.uploadedImageBase64) return;
        if (this.isStreaming) return;

        // 检查是否在编辑模式（知识库Copilot模式）
        if (this.viewMode === 'editor') {
            input.value = '';
            this.hideInputShortcuts();

            // 在聊天窗口显示用户消息
            this.addMessage(message, 'user');

            // 获取编辑器上下文
            const editorContext = {
                noteId: this.activeNoteId,
                fullText: this.editorInstance?.value || '',
                selectedText: '' // 暂不支持选中文本
            };

            // 调用知识库Agent
            await this.knowledgeAgentHandler.startReActLoop(message, editorContext);

            return;
        }

        // 检查是否为Agent模式
        if (this.isAgentMode || message.startsWith('Agent:')) {
            input.value = '';
            this.hideInputShortcuts();

            // 去除"Agent:"前缀
            const actualMessage = message.startsWith('Agent:') ? message.substring(6).trim() : message;

            // 在聊天窗口显示用户消息
            this.addMessage(actualMessage, 'user');

            // 启动Agent模式
            await this.agentHandler.startReActLoop(actualMessage);

            return;
        }

        if (!this.settings.apiKey) {
            this.showNotification('请先在设置中配置API密钥', 'error');
            this.showSettings();
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
                this.showNotification('图片上传失败', 'error');
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
        const activeSession = this.getActiveSession();
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
                const newTitle = this.generateSessionTitle(message || '图片消息');
                this.updateSessionTitle(activeSession.id, newTitle);
            }

            activeSession.updatedAt = new Date().toISOString();
            this.saveSessions();
        }

        // 清理图片状态
        this.removeImage();

        // 更新Token用量
        this.updateTokenUsage();

        await this.getAIResponse(contentParts);
    }

    async getAIResponse(userMessage) {
        this.isStreaming = true;
        this.toggleSendButton(false);

        const aiMessageElement = this.addMessage('', 'ai', true);
        const contentElement = aiMessageElement.querySelector('.message-content');

        try {
            const activeSession = this.getActiveSession();
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

            const response = await fetch(this.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: messagesToSend,
                    stream: true,
                    temperature: this.config?.apiSettings?.temperature || 0.7,
                    max_tokens: this.config?.apiSettings?.maxTokens || 10000
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
                this.saveSessions();
                this.renderSessionList(); // 更新会话列表中的消息计数
            }

            // 刷新节点轴
            this.renderNodeAxis();

            // 记录交互，包含完整的发送给LLM的消息
            this.logInteraction(userMessage, fullResponse, 'main', messagesToSend);

        } catch (error) {
            console.error('API Error:', error);
            contentElement.innerHTML = `<p class="text-red-400">❌ 请求失败: ${error.message}</p>`;
        } finally {
            this.isStreaming = false;
            this.toggleSendButton(true);
            aiMessageElement.querySelector('.typewriter')?.classList.remove('typewriter');
            this.updateTokenUsage();
        }
    }

    addMessage(content, type, isStreaming = false, imageUrl = null) {
        const messagesContainer = document.getElementById('messages');
        const timestamp = new Date().toLocaleTimeString();

        const messageElement = document.createElement('div');
        messageElement.className = `message-bubble ${type}-message animate__animated animate__fadeInUp`;

        if (type === 'user') {
            let imageHtml = '';
            if (imageUrl) {
                imageHtml = `<img src="${imageUrl}" class="message-image" onclick="window.open('${imageUrl}', '_blank')">`;
            }
            const userAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E`;
            messageElement.innerHTML = `
                <div class="mb-2 flex items-center gap-2">
                    <img src="${userAvatar}" class="w-6 h-6" alt="User">
                    <span class="text-blue-400 font-semibold">你</span>
                    <span class="text-gray-400 text-sm ml-2">${timestamp}</span>
                </div>
                <div class="message-content">
                    ${content ? `<p>${this.escapeHtml(content)}</p>` : ''}
                    ${imageHtml}
                </div>
            `;
        } else {
            const aiAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 8V4H8'/%3E%3Crect width='16' height='12' x='4' y='8' rx='2'/%3E%3Cpath d='M2 14h2'/%3E%3Cpath d='M20 14h2'/%3E%3Cpath d='M15 13v2'/%3E%3Cpath d='M9 13v2'/%3E%3C/svg%3E`;
            messageElement.innerHTML = `
                <div class="mb-2 flex items-center gap-2">
                    <img src="${aiAvatar}" class="w-6 h-6" alt="AI">
                    <span class="text-green-400 font-semibold">AI助手</span>
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

    formatMessage(content) {
        // 1. 先处理可能存在的Unicode转义字符
        let processedContent = this.unescapeUnicodeChars(content);

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
                return this.escapeHtml(processedContent).replace(/\n/g, '<br>');
            }
        }

        // 降级方案：如果 marked.js 未加载，使用基础格式化
        return this.escapeHtml(processedContent).replace(/\n/g, '<br>');
    }

    /**
     * 渲染Wiki链接和标签
     */
    renderWikiLinksAndTags(html) {
        // 处理Wiki链接 [[笔记ID]] 或 [[笔记ID|显示文本]]
        html = html.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (match, noteId, pipe, displayText) => {
            const text = displayText || noteId;
            return `<a href="#" data-note-id="${this.escapeHtml(noteId.trim())}" class="internal-link text-purple-400 hover:text-purple-300 underline">${this.escapeHtml(text.trim())}</a>`;
        });

        // 处理内联标签 #标签名
        // 注意：避免匹配代码块内的标签
        html = html.replace(/(?<!<code[^>]*>.*?)#([a-zA-Z0-9_\u4e00-\u9fa5]+)(?![^<]*<\/code>)/g, (match, tag) => {
            return `<a href="#" data-tag="${this.escapeHtml(tag)}" class="tag-link text-blue-400 hover:text-blue-300">#${this.escapeHtml(tag)}</a>`;
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

        // HTML全屏预览按钮事件
        document.querySelectorAll('.fullscreen-html-btn').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });

        document.querySelectorAll('.fullscreen-html-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const codeId = btn.getAttribute('data-code-id');
                const htmlCode = window.codeStorage ? window.codeStorage.get(codeId) : '';
                if (htmlCode) {
                    this.showFullscreenHtmlPreview(htmlCode);
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
            modal.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    }

    showFullscreenHtmlPreview(htmlCode) {
        // 确保HTML代码经过正确的反转义处理
        const cleanHtmlCode = this.unescapeUnicodeChars(htmlCode);

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

            this.showNotification('已在新窗口打开全屏预览', 'success');

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
                    this.showNotification('已在新窗口打开全屏预览', 'success');
                } else {
                    this.showNotification('无法打开新窗口，请检查浏览器弹窗设置', 'error');
                }
            } else {
                throw new Error('后端预览服务响应错误');
            }
        } catch (error) {
            console.error('备用全屏预览错误:', error);
            this.showNotification('全屏预览失败，请稍后重试', 'error');
        }
    }

    handleTextSelection(e) {
        // 检查是否是textarea (编辑器)
        if (e.target.id === 'noteEditor') {
            const textarea = e.target;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selectedText = textarea.value.substring(start, end).trim();

            if (selectedText && selectedText.length > 3) {
                // 计算textarea中选区的屏幕坐标
                const coords = this.getTextareaSelectionCoords(textarea, start, end);

                this.showTooltip(coords.x, coords.y, selectedText, textarea);
            } else {
                this.hideTooltip();
            }
            return;
        }

        // 原有逻辑：处理普通元素中的选中文本
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

    /**
     * 获取textarea中选区的屏幕坐标
     */
    getTextareaSelectionCoords(textarea, start, end) {
        // 创建一个隐藏的div来模拟textarea的布局
        const div = document.createElement('div');
        const computedStyle = window.getComputedStyle(textarea);

        // 复制textarea的样式
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        div.style.whiteSpace = 'pre-wrap';
        div.style.wordWrap = 'break-word';
        div.style.font = computedStyle.font;
        div.style.padding = computedStyle.padding;
        div.style.border = computedStyle.border;
        div.style.width = textarea.offsetWidth + 'px';

        // 获取光标前的文本
        const textBeforeCursor = textarea.value.substring(0, start);
        div.textContent = textBeforeCursor;

        // 添加一个span来标记光标位置
        const span = document.createElement('span');
        span.textContent = textarea.value.substring(start, end) || '|';
        div.appendChild(span);

        document.body.appendChild(div);

        // 获取span的位置
        const textareaRect = textarea.getBoundingClientRect();
        const spanRect = span.getBoundingClientRect();

        // 计算相对于textarea的位置
        const x = textareaRect.left + (spanRect.left - div.getBoundingClientRect().left);
        const y = textareaRect.top + (spanRect.top - div.getBoundingClientRect().top) - 10;

        document.body.removeChild(div);

        return { x, y };
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
        // 判断上下文来源：textarea或普通消息
        let originalContent;
        if (originalMessage.tagName === 'TEXTAREA') {
            // 来自编辑器
            originalContent = originalMessage.value;
        } else {
            // 来自聊天消息
            originalContent = originalMessage.querySelector('.message-content').textContent;
        }

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

            // 保存追问记录到消息数据
            const activeSession = this.getActiveSession();
            if (activeSession) {
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
                    this.saveSessions();

                    // 刷新节点轴
                    this.renderNodeAxis();
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

    scrollToBottom() {
        const container = document.getElementById('chatContainer');
        container.scrollTop = container.scrollHeight;
    }

    toggleAgentMode() {
        this.isAgentMode = !this.isAgentMode;
        const agentBtn = document.getElementById('agentModeBtn');
        const messageInput = document.getElementById('messageInput');

        if (this.isAgentMode) {
            // 创建新会话
            this.createNewSession();

            agentBtn.classList.add('active');
            messageInput.placeholder = 'Agent模式：描述你要完成的任务...';
            messageInput.classList.add('agent-mode-active');
            this.showNotification('Agent模式已开启，已创建新会话', 'success');
        } else {
            agentBtn.classList.remove('active');
            messageInput.placeholder = '输入你的问题...';
            messageInput.classList.remove('agent-mode-active');
            this.showNotification('Agent模式已关闭', 'info');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg text-white z-50 animate__animated animate__fadeInRight flex items-center gap-2 ${
            type === 'success' ? 'bg-green-600' :
            type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`;

        const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
        notification.innerHTML = `
            <i data-lucide="${iconName}" class="w-5 h-5"></i>
            <span>${message}</span>
        `;

        document.body.appendChild(notification);

        // Initialize icons for notification
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        setTimeout(() => {
            notification.classList.remove('animate__fadeInRight');
            notification.classList.add('animate__fadeOutRight');
            setTimeout(() => notification.remove(), 300);
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

        // 将消息添加到当前活动会话
        const activeSession = this.getActiveSession();
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
                const newTitle = this.generateSessionTitle(userInput);
                this.updateSessionTitle(activeSession.id, newTitle);
            }

            activeSession.updatedAt = new Date().toISOString();
            this.saveSessions();
        }

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
                stepDiv.innerHTML = `<div class="border-t border-gray-600 pt-2">${this.escapeHtml(msg.content)}</div>`;
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
        let contentHtml = `<div class="text-sm text-gray-200 whitespace-pre-wrap">${this.escapeHtml(msg.content)}</div>`;

        // 如果有额外数据（如工具参数），显示
        if (msg.args) {
            contentHtml += `<div class="mt-2 text-xs text-gray-400">${this.escapeHtml(JSON.stringify(msg.args, null, 2))}</div>`;
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
            this.showNotification('请选择图片文件', 'error');
            return;
        }

        try {
            await this.compressAndPreviewImage(file);
        } catch (error) {
            console.error('图片处理失败:', error);
            this.showNotification('图片处理失败: ' + error.message, 'error');
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

                this.showNotification(`图片已压缩 (${(compressedFile.size / 1024).toFixed(1)}KB)`, 'success');
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

    // 渲染节点轴
    renderNodeAxis() {
        const activeSession = this.getActiveSession();
        const svg = document.getElementById('nodeAxisSvg');

        if (!svg) return;

        // 如果没有会话或消息，清空SVG
        if (!activeSession || !activeSession.messages || activeSession.messages.length === 0) {
            svg.innerHTML = '';
            svg.setAttribute('height', '0');
            return;
        }

        const messages = activeSession.messages;
        const nodeSpacing = 40; // 节点间距
        const userNodeRadius = 7; // 用户节点半径（大圆）
        const aiNodeRadius = 5; // AI节点半径（小圆）
        const clickAreaRadius = 12; // 点击区域半径
        const startX = 30; // 起始X位置
        const startY = 20; // 起始Y位置
        const branchLength = 20; // 分叉长度

        // 计算SVG高度
        const svgHeight = startY + (messages.length * nodeSpacing) + 20;
        svg.setAttribute('height', svgHeight);

        // 清空SVG内容
        svg.innerHTML = '';

        // 绘制节点和连线
        messages.forEach((message, index) => {
            const y = startY + (index * nodeSpacing);
            const isUser = message.role === 'user';
            const nodeRadius = isUser ? userNodeRadius : aiNodeRadius;

            // 绘制连线（除了第一个节点）
            if (index > 0) {
                const prevY = startY + ((index - 1) * nodeSpacing);
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', startX);
                line.setAttribute('y1', prevY);
                line.setAttribute('x2', startX);
                line.setAttribute('y2', y);
                line.setAttribute('class', 'node-axis-line');
                svg.appendChild(line);
            }

            // 判断是否有追问
            const hasFollowups = message.followups && message.followups.length > 0;

            // 创建节点组
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('data-message-index', index);
            group.setAttribute('data-message-id', message.messageId || '');

            // 绘制透明的大点击区域
            const clickArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            clickArea.setAttribute('cx', startX);
            clickArea.setAttribute('cy', y);
            clickArea.setAttribute('r', clickAreaRadius);
            clickArea.setAttribute('class', 'node-axis-clickarea');
            group.appendChild(clickArea);

            // 绘制主节点
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', startX);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', nodeRadius);

            // 设置样式类
            let circleClass = `node-axis-circle ${isUser ? 'user' : 'ai'}`;
            if (hasFollowups) {
                circleClass += ' has-followup';
            }
            circle.setAttribute('class', circleClass);

            group.appendChild(circle);
            svg.appendChild(group);

            // 如果有追问，绘制分叉
            if (hasFollowups) {
                // 绘制分叉横线
                const branchLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                branchLine.setAttribute('x1', startX + nodeRadius);
                branchLine.setAttribute('y1', y);
                branchLine.setAttribute('x2', startX + nodeRadius + branchLength);
                branchLine.setAttribute('y2', y);
                branchLine.setAttribute('class', 'node-axis-line');
                svg.appendChild(branchLine);

                // 创建分支节点组
                const branchGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                branchGroup.setAttribute('data-message-index', index);
                branchGroup.setAttribute('data-message-id', message.messageId || '');
                branchGroup.setAttribute('data-is-branch', 'true');

                // 分支节点的点击区域
                const branchClickArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                branchClickArea.setAttribute('cx', startX + nodeRadius + branchLength);
                branchClickArea.setAttribute('cy', y);
                branchClickArea.setAttribute('r', clickAreaRadius * 0.8);
                branchClickArea.setAttribute('class', 'node-axis-clickarea');
                branchGroup.appendChild(branchClickArea);

                // 绘制分叉节点
                const branchCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                branchCircle.setAttribute('cx', startX + nodeRadius + branchLength);
                branchCircle.setAttribute('cy', y);
                branchCircle.setAttribute('r', 4); // 分叉节点最小
                branchCircle.setAttribute('class', 'node-axis-circle branch');
                branchGroup.appendChild(branchCircle);

                svg.appendChild(branchGroup);
            }
        });
    }

    // 切换节点轴折叠状态
    toggleNodeAxis() {
        this.isNodeAxisCollapsed = !this.isNodeAxisCollapsed;
        const content = document.getElementById('nodeAxisContent');
        const icon = document.getElementById('nodeAxisToggleIcon');

        if (this.isNodeAxisCollapsed) {
            content.style.display = 'none';
            icon.style.transform = 'rotate(-90deg)';
        } else {
            content.style.display = 'block';
            icon.style.transform = 'rotate(0deg)';
        }
    }

    // 处理节点点击事件
    handleNodeClick(e) {
        const target = e.target;

        // 查找包含data-message-index的元素（可能是circle或g）
        let clickedElement = target;
        if (target.tagName === 'circle') {
            // 如果点击的是circle，向上查找g元素
            clickedElement = target.closest('g') || target;
        }

        const messageIndex = parseInt(clickedElement.getAttribute('data-message-index'));
        const isBranch = clickedElement.getAttribute('data-is-branch') === 'true';

        if (isNaN(messageIndex)) return;

        // 如果点击的是分叉节点，显示追问内容
        if (isBranch) {
            const activeSession = this.getActiveSession();
            if (activeSession && activeSession.messages[messageIndex]) {
                const message = activeSession.messages[messageIndex];
                if (message.followups && message.followups.length > 0) {
                    this.showFollowupsModal(message.followups);
                }
            }
        }

        // 滚动到对应的消息位置
        this.scrollToMessage(messageIndex);
    }

    // 滚动到指定索引的消息
    scrollToMessage(messageIndex, retryCount = 0) {
        const messagesContainer = document.getElementById('messages');
        const messageElements = messagesContainer.querySelectorAll('[data-message-index]');

        // 找到对应索引的消息元素
        let targetMessageElement = null;
        messageElements.forEach(el => {
            if (parseInt(el.getAttribute('data-message-index')) === messageIndex) {
                targetMessageElement = el;
            }
        });

        if (targetMessageElement) {
            targetMessageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 添加临时高亮效果
            targetMessageElement.classList.add('highlight-search-result');
            setTimeout(() => {
                targetMessageElement.classList.remove('highlight-search-result');
            }, 3000);
        } else if (retryCount < 3) {
            // 如果没找到且重试次数少于3次，延迟后重试（可能消息还在渲染中）
            setTimeout(() => {
                this.scrollToMessage(messageIndex, retryCount + 1);
            }, 200);
        }
    }

    // 显示追问内容的模态框
    showFollowupsModal(followups) {
        const modal = this.createFollowupModal();
        const contentElement = modal.querySelector('.followup-content');

        let html = '<div class="space-y-4">';
        followups.forEach((followup, index) => {
            html += `
                <div class="border border-gray-600 rounded-lg p-4">
                    <div class="mb-2 flex items-center gap-2">
                        <i data-lucide="message-square" class="w-4 h-4 text-blue-400"></i>
                        <span class="text-blue-400 font-semibold">追问 ${index + 1}</span>
                    </div>
                    <div class="mb-3 text-sm text-gray-300 bg-gray-900 p-2 rounded">
                        <strong>问:</strong> ${this.escapeHtml(followup.question)}
                    </div>
                    <div class="text-sm">
                        <strong class="text-green-400">答:</strong>
                        <div class="mt-2">${this.formatMessage(followup.answer)}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        contentElement.innerHTML = html;
        this.addCopyButtons();

        // Initialize icons for followup modal
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        // 应用代码高亮
        if (typeof hljs !== 'undefined') {
            contentElement.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        document.body.appendChild(modal);
    }

    // 主题管理方法
    loadThemePreference() {
        const savedTheme = localStorage.getItem('theme') || 'light'; // 默认为白天模式
        this.setTheme(savedTheme);
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    }

    setTheme(theme) {
        this.currentTheme = theme;

        // 更新 body 类
        if (theme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }

        // 更新按钮图标
        const sunIcon = document.getElementById('sunIcon');
        const moonIcon = document.getElementById('moonIcon');

        if (sunIcon && moonIcon) {
            if (theme === 'light') {
                sunIcon.classList.add('hidden');
                moonIcon.classList.remove('hidden');
            } else {
                sunIcon.classList.remove('hidden');
                moonIcon.classList.add('hidden');
            }
        }

        // 切换代码高亮主题
        const hljsTheme = document.getElementById('hljs-theme');
        if (hljsTheme) {
            if (theme === 'light') {
                hljsTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css';
            } else {
                hljsTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
            }
        }

        // 重新应用代码高亮
        setTimeout(() => {
            if (typeof hljs !== 'undefined') {
                document.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
        }, 100);

        // 持久化存储
        localStorage.setItem('theme', theme);
    }

    // ============ 知识库相关方法 ============

    /**
     * 加载笔记列表
     */
    async loadNotes() {
        try {
            const response = await fetch('http://localhost:8080/api/notes');
            if (!response.ok) {
                console.warn('加载笔记列表失败');
                return;
            }
            const text = await response.text();

            // 尝试解析JSON
            try {
                // 后端返回的是包含树状结构的文本
                // 格式: "知识库中共有 N 个项目:\n[...]"
                const match = text.match(/知识库中共有 \d+ 个项目:\n([\s\S]+)/);
                if (match) {
                    this.notes = JSON.parse(match[1]);
                } else {
                    // 兼容旧格式
                    const oldMatch = text.match(/知识库中共有 \d+ 篇笔记:\n([\s\S]+)/);
                    if (oldMatch) {
                        this.notes = JSON.parse(oldMatch[1]);
                    } else {
                        this.notes = [];
                    }
                }
            } catch (e) {
                console.warn('解析笔记列表时出错:', e);
                this.notes = [];
            }

            this.renderNoteList();
        } catch (error) {
            console.error('加载笔记失败:', error);
        }
    }

    /**
     * 渲染笔记列表
     */
    renderNoteList() {
        const notesList = document.getElementById('notesList');
        if (!notesList) return;

        notesList.innerHTML = '';

        if (!this.notes || this.notes.length === 0) {
            notesList.innerHTML = '<li class="text-gray-400 text-sm p-3 text-center">知识库为空<br><small>点击下方"新建笔记"开始</small></li>';
            return;
        }

        // 递归渲染树节点
        const renderNode = (node, parentElement, depth = 0) => {
            const nodeItem = document.createElement('li');
            nodeItem.className = 'note-tree-item';
            nodeItem.style.paddingLeft = `${depth * 12}px`;

            if (node.type === 'folder') {
                // 文件夹节点
                const folderDiv = document.createElement('div');
                folderDiv.className = 'folder-node p-2 rounded cursor-pointer transition-colors hover:bg-gray-700 border-b border-gray-700 flex items-center gap-2';
                folderDiv.innerHTML = `
                    <i data-lucide="chevron-right" class="w-4 h-4 text-gray-400 folder-chevron transition-transform"></i>
                    <i data-lucide="folder" class="w-4 h-4 text-yellow-400"></i>
                    <span class="font-medium text-sm">${this.escapeHtml(node.name)}</span>
                `;

                // 子节点容器
                const childrenContainer = document.createElement('ul');
                childrenContainer.className = 'folder-children hidden';

                // 切换展开/折叠
                folderDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const chevron = folderDiv.querySelector('.folder-chevron');
                    if (childrenContainer.classList.contains('hidden')) {
                        childrenContainer.classList.remove('hidden');
                        chevron.style.transform = 'rotate(90deg)';
                    } else {
                        childrenContainer.classList.add('hidden');
                        chevron.style.transform = 'rotate(0deg)';
                    }
                });

                nodeItem.appendChild(folderDiv);

                // 渲染子节点
                if (node.children && node.children.length > 0) {
                    node.children.forEach(child => {
                        renderNode(child, childrenContainer, depth + 1);
                    });
                }

                nodeItem.appendChild(childrenContainer);
            } else if (node.type === 'file') {
                // 文件节点
                const fileDiv = document.createElement('div');
                fileDiv.className = 'file-node p-2 rounded cursor-pointer transition-colors hover:bg-gray-700 border-b border-gray-700';

                // 从path提取noteId（移除.md扩展名）
                const noteId = node.path.replace(/\.md$/, '');

                if (noteId === this.activeNoteId) {
                    fileDiv.classList.add('bg-purple-900', 'bg-opacity-30');
                }

                // 获取标题（优先使用metadata中的title）
                const title = node.metadata?.title || node.name.replace(/\.md$/, '');

                // 渲染标签
                let tagsHtml = '';
                if (node.tags && node.tags.length > 0) {
                    tagsHtml = `<div class="flex flex-wrap gap-1 mt-1">
                        ${node.tags.map(tag => `<span class="text-xs px-2 py-0.5 bg-blue-900 bg-opacity-50 text-blue-300 rounded">#${this.escapeHtml(tag)}</span>`).join('')}
                    </div>`;
                }

                fileDiv.innerHTML = `
                    <div class="flex items-center gap-2">
                        <i data-lucide="file-text" class="w-4 h-4 text-purple-400"></i>
                        <span class="font-medium text-sm">${this.escapeHtml(title)}</span>
                    </div>
                    ${tagsHtml}
                `;

                fileDiv.addEventListener('click', () => {
                    this.switchToEditorMode(noteId);
                });

                nodeItem.appendChild(fileDiv);
            }

            parentElement.appendChild(nodeItem);
        };

        // 渲染所有根节点
        this.notes.forEach(node => {
            renderNode(node, notesList, 0);
        });

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 切换到编辑模式
     */
    async switchToEditorMode(noteId) {
        this.viewMode = 'editor';
        this.activeNoteId = noteId;

        // 切换body类
        document.body.classList.remove('view-mode-chat');
        document.body.classList.add('view-mode-editor');

        // 确保右侧知识库显示（如果之前被折叠）
        const rightSidebar = document.getElementById('right-sidebar');
        if (rightSidebar) {
            rightSidebar.classList.remove('hidden', 'collapsed');
        }

        // 隐藏聊天区域主体
        const chatContainer = document.getElementById('chatContainer');
        const editorContainer = document.getElementById('editor-container');

        if (chatContainer) chatContainer.classList.add('hidden');
        if (editorContainer) editorContainer.classList.remove('hidden');

        // 清空Copilot面板（准备显示新对话）
        const copilotMessages = document.getElementById('copilotMessages');
        if (copilotMessages) {
            copilotMessages.innerHTML = '<div class="text-gray-400 text-sm">在编辑器中提问，Copilot将帮助你写作和组织知识...</div>';
        }

        // 加载笔记内容
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`);
            const content = await response.text();

            // 初始化编辑器
            this.initEditor(content, noteId);
        } catch (error) {
            console.error('加载笔记内容失败:', error);
            this.showNotification('加载笔记失败: ' + error.message, 'error');
        }

        // 更新笔记列表高亮
        this.renderNoteList();

        // 初始化lucide图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 初始化编辑器
     */
    initEditor(content, noteId) {
        const editorTextarea = document.getElementById('noteEditor');
        const noteTitleEl = document.getElementById('noteTitle');

        if (editorTextarea) {
            editorTextarea.value = content;
            this.editorInstance = editorTextarea;
        }

        if (noteTitleEl) {
            const note = this.notes.find(n => n.id === noteId);
            noteTitleEl.textContent = note ? note.title : noteId;
        }

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 切换回聊天模式
     */
    switchToChatMode() {
        // 清除自动保存定时器
        clearTimeout(this.autoSaveTimeout);

        this.viewMode = 'chat';
        this.activeNoteId = null;
        this.editorInstance = null;

        // 切换body类
        document.body.classList.remove('view-mode-editor');
        document.body.classList.add('view-mode-chat');

        // 右侧知识库保持可用，不隐藏（用户可以通过折叠按钮控制）

        // 显示聊天容器，隐藏编辑器
        const chatContainer = document.getElementById('chatContainer');
        const editorContainer = document.getElementById('editor-container');

        if (chatContainer) chatContainer.classList.remove('hidden');
        if (editorContainer) editorContainer.classList.add('hidden');

        // 清空消息输入框
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
        }
    }

    /**
     * 折叠/展开知识库抽屉
     */
    toggleKnowledgeDrawer() {
        const rightSidebar = document.getElementById('right-sidebar');
        const expandBtn = document.getElementById('expandKnowledgeDrawerBtn');

        if (!rightSidebar) return;

        if (rightSidebar.classList.contains('collapsed')) {
            // 展开
            rightSidebar.classList.remove('collapsed');
            if (expandBtn) expandBtn.classList.add('hidden');
        } else {
            // 折叠
            rightSidebar.classList.add('collapsed');
            if (expandBtn) expandBtn.classList.remove('hidden');
        }

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 发送Copilot消息（编辑模式专用）
     */
    async sendCopilotMessage() {
        const copilotInput = document.getElementById('copilotInput');
        const message = copilotInput?.value.trim();

        if (!message || this.viewMode !== 'editor') return;

        // 清空输入框
        copilotInput.value = '';

        // 获取编辑器上下文
        const editorContext = {
            noteId: this.activeNoteId,
            fullText: this.editorInstance?.value || '',
            selectedText: '' // 暂不支持选中文本
        };

        // 调用知识库Agent
        await this.knowledgeAgentHandler.startReActLoop(message, editorContext);
    }

    /**
     * 保存当前笔记
     */
    async saveActiveNote() {
        if (!this.activeNoteId || !this.editorInstance) {
            this.showNotification('没有活动的笔记', 'error');
            return;
        }

        try {
            const content = this.editorInstance.value;
            const response = await fetch(`http://localhost:8080/api/notes/${this.activeNoteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content })
            });

            if (!response.ok) {
                throw new Error('保存失败');
            }

            this.showNotification('笔记已保存', 'success');
        } catch (error) {
            console.error('保存笔记失败:', error);
            this.showNotification('保存失败: ' + error.message, 'error');
        }
    }

    /**
     * 处理Wiki链接点击
     */
    async handleWikiLinkClick(noteId) {
        console.log('点击Wiki链接:', noteId);

        // 检查笔记是否存在
        const note = this.notes.find(n => n.id === noteId);
        if (note) {
            // 切换到编辑器模式打开该笔记
            this.switchToEditorMode(noteId);
        } else {
            // 笔记不存在，提示用户
            const confirmed = confirm(`笔记 "${noteId}" 不存在。是否创建新笔记？`);
            if (confirmed) {
                // TODO: 创建新笔记
                this.showNotification('创建新笔记功能待实现', 'info');
            }
        }
    }

    /**
     * 处理标签点击
     */
    async handleTagClick(tag) {
        console.log('点击标签:', tag);

        // 切换到知识库面板并搜索该标签
        const rightSidebar = document.getElementById('right-sidebar');
        if (rightSidebar && rightSidebar.classList.contains('hidden')) {
            this.toggleKnowledgeDrawer();
        }

        // 在笔记搜索框中输入 tag:标签名
        const noteSearch = document.getElementById('noteSearch');
        if (noteSearch) {
            noteSearch.value = `tag:${tag}`;
            // 触发搜索
            noteSearch.dispatchEvent(new Event('input'));
        }

        this.showNotification(`搜索标签: ${tag}`, 'info');
    }

    /**
     * 切换编辑器预览模式
     */
    toggleEditorPreview() {
        this.isEditorPreview = !this.isEditorPreview;

        const notePreview = document.getElementById('notePreview');
        const togglePreviewBtn = document.getElementById('togglePreviewBtn');

        if (this.isEditorPreview) {
            // 显示预览
            notePreview.classList.remove('hidden');
            togglePreviewBtn.classList.add('bg-blue-600');
            togglePreviewBtn.classList.remove('bg-gray-700');

            // 立即更新预览内容
            this.updateEditorPreview();
        } else {
            // 隐藏预览
            notePreview.classList.add('hidden');
            togglePreviewBtn.classList.remove('bg-blue-600');
            togglePreviewBtn.classList.add('bg-gray-700');
        }
    }

    /**
     * 更新编辑器预览
     */
    updateEditorPreview() {
        if (!this.isEditorPreview) return;

        const noteEditor = document.getElementById('noteEditor');
        const notePreview = document.getElementById('notePreview');

        if (!noteEditor || !notePreview) return;

        const content = noteEditor.value;

        // 使用formatMessage渲染Markdown
        const html = this.formatMessage(content);
        notePreview.innerHTML = html;

        // 重新添加复制按钮和代码高亮
        this.addCopyButtons();

        // 重新初始化代码高亮
        if (typeof hljs !== 'undefined') {
            notePreview.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 创建新笔记
     */
    async createNewNote(parentPath = '') {
        const title = prompt('请输入笔记标题:');
        if (!title || !title.trim()) {
            return;
        }

        try {
            // 生成笔记ID（清理文件名）
            const cleanTitle = title.replace(/[\/\\:*?"<>|\s]/g, '_');

            // 如果有父路径，添加到笔记ID前面
            const noteId = parentPath ? `${parentPath}/${cleanTitle}` : cleanTitle;

            // 创建带有YAML Front Matter的初始内容
            const now = new Date().toISOString();
            const initialContent = `---
title: ${title}
created_at: ${now}
updated_at: ${now}
tags: []
---

# ${title}

开始编写你的笔记...
`;

            // 调用后端API创建笔记
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: initialContent })
            });

            if (!response.ok) {
                throw new Error('创建笔记失败');
            }

            this.showNotification('笔记创建成功', 'success');

            // 重新加载笔记列表
            await this.loadNotes();

            // 打开新创建的笔记
            this.switchToEditorMode(noteId);
        } catch (error) {
            console.error('创建笔记失败:', error);
            this.showNotification('创建失败: ' + error.message, 'error');
        }
    }

    /**
     * 创建新文件夹
     */
    async createNewFolder(parentPath = '') {
        const folderName = prompt('请输入文件夹名称:');
        if (!folderName || !folderName.trim()) {
            return;
        }

        try {
            // 清理文件夹名
            const cleanFolderName = folderName.replace(/[\/\\:*?"<>|]/g, '_');

            // 如果有父路径，添加到文件夹名前面
            const folderPath = parentPath ? `${parentPath}/${cleanFolderName}` : cleanFolderName;

            // 在文件夹中创建一个.gitkeep文件以确保文件夹被创建
            const placeholderPath = `${folderPath}/.gitkeep`;

            const response = await fetch(`http://localhost:8080/api/notes/${encodeURIComponent(placeholderPath)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: '' })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('服务器返回错误:', errorText);
                throw new Error('创建文件夹失败');
            }

            this.showNotification('文件夹创建成功', 'success');

            // 重新加载笔记列表
            await this.loadNotes();
        } catch (error) {
            console.error('创建文件夹失败:', error);
            this.showNotification('创建失败: ' + error.message, 'error');
        }
    }

    /**
     * 显示右键菜单
     */
    showContextMenu(event) {
        // 移除已存在的菜单
        this.hideContextMenu();

        // 获取右键点击的目标元素（查找最近的笔记项）
        let targetElement = event.target.closest('.note-item');
        let parentPath = '';

        // 如果点击在某个笔记项上，获取其路径
        if (targetElement) {
            const noteId = targetElement.dataset.noteId;
            // 查找对应的笔记对象
            const findNote = (notes) => {
                for (const note of notes) {
                    if (note.id === noteId) {
                        // 如果是文件夹，使用其路径作为父路径
                        if (note.isFolder) {
                            parentPath = note.path;
                        } else {
                            // 如果是文件，使用其所在目录作为父路径
                            parentPath = note.path.substring(0, note.path.lastIndexOf('/'));
                        }
                        return true;
                    }
                    if (note.children && findNote(note.children)) {
                        return true;
                    }
                }
                return false;
            };
            findNote(this.notes);
        }

        // 创建菜单元素
        const menu = document.createElement('div');
        menu.id = 'contextMenu';
        menu.className = 'fixed bg-gray-800 border border-gray-600 rounded-lg shadow-lg py-2 z-[1002]';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;

        // 菜单项
        const menuItems = [
            {
                icon: 'file-plus',
                label: '新建文件',
                handler: () => {
                    this.hideContextMenu();
                    this.createNewNote(parentPath);
                }
            },
            {
                icon: 'folder-plus',
                label: '新建文件夹',
                handler: () => {
                    this.hideContextMenu();
                    this.createNewFolder(parentPath);
                }
            }
        ];

        // 构建菜单HTML
        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'px-4 py-2 hover:bg-gray-700 cursor-pointer flex items-center gap-2 text-sm';
            menuItem.innerHTML = `
                <i data-lucide="${item.icon}" class="w-4 h-4"></i>
                <span>${item.label}</span>
            `;
            menuItem.addEventListener('click', item.handler);
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        // 点击其他地方关闭菜单
        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 0);
    }

    /**
     * 隐藏右键菜单
     */
    hideContextMenu() {
        const menu = document.getElementById('contextMenu');
        if (menu) {
            menu.remove();
        }
    }

    /**
     * 处理编辑器中的图片拖拽上传
     */
    async handleEditorImageDrop(event) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const noteEditor = document.getElementById('noteEditor');
        if (!noteEditor) return;

        // 获取图片存储配置
        const imageStorageMode = this.config?.knowledgeBase?.imageStorage?.mode || 'fixed';

        // 遍历所有文件
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // 检查是否是图片
            if (!file.type.startsWith('image/')) {
                this.showNotification(`文件 ${file.name} 不是图片`, 'warning');
                continue;
            }

            try {
                // 上传图片
                const formData = new FormData();
                formData.append('image', file);
                formData.append('storage_mode', imageStorageMode);
                if (imageStorageMode === 'relative' && this.activeNoteId) {
                    formData.append('note_id', this.activeNoteId);
                }

                const response = await fetch('http://localhost:8080/api/notes/upload-image', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('上传失败');
                }

                const result = await response.json();

                // 获取光标位置
                const cursorPos = noteEditor.selectionStart;
                const textBefore = noteEditor.value.substring(0, cursorPos);
                const textAfter = noteEditor.value.substring(cursorPos);

                // 构造Markdown图片语法
                const imageMarkdown = `![${file.name}](${result.filePath})`;

                // 插入图片引用
                noteEditor.value = textBefore + imageMarkdown + textAfter;

                // 设置新的光标位置
                const newCursorPos = cursorPos + imageMarkdown.length;
                noteEditor.setSelectionRange(newCursorPos, newCursorPos);

                // 更新预览
                if (this.isEditorPreview) {
                    this.updateEditorPreview();
                }

                this.showNotification('图片上传成功', 'success');
            } catch (error) {
                console.error('图片上传失败:', error);
                this.showNotification(`图片上传失败: ${error.message}`, 'error');
            }
        }
    }

    // 配置 marked.js
    configureMarked() {
        if (typeof marked === 'undefined') return;

        // 配置 marked 选项 - 不使用自定义renderer以保留所有默认渲染功能
        marked.setOptions({
            breaks: true, // 支持GFM换行
            gfm: true, // 启用GitHub风格的Markdown
            tables: true, // 支持表格
            pedantic: false,
            sanitize: false, // 我们会手动处理HTML转义
            smartLists: true,
            smartypants: false
        });
    }

    /**
     * 初始化知识库WebSocket连接
     */
    initNotesWebSocket() {
        const wsUrl = 'ws://localhost:8080/ws/notes';

        const connectWebSocket = () => {
            this.notesWebSocket = new WebSocket(wsUrl);

            this.notesWebSocket.onopen = () => {
                console.log('知识库WebSocket连接已建立');
            };

            this.notesWebSocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'refresh_notes') {
                        console.log('收到知识库更新通知，刷新笔记列表');
                        this.loadNotes();
                    }
                } catch (error) {
                    console.error('解析WebSocket消息失败:', error);
                }
            };

            this.notesWebSocket.onerror = (error) => {
                console.error('WebSocket错误:', error);
            };

            this.notesWebSocket.onclose = () => {
                console.log('WebSocket连接已关闭，5秒后重连...');
                setTimeout(connectWebSocket, 5000);
            };
        };

        connectWebSocket();
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new AIAssistant();

    // 初始化代码高亮
    if (typeof hljs !== 'undefined') {
        hljs.highlightAll();
    }

    // 初始化Lucide图标
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
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