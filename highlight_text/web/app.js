import { DiffViewer } from './js/diff/DiffViewer.js';
import { escapeHtml, unescapeUnicodeChars } from './js/utils/helpers.js';
import { UIManager } from './js/core/UIManager.js';
import { SettingsManager } from './js/core/SettingsManager.js';

class AIAssistant {
    constructor() {
        this.config = null;
        this.settings = {};
        this.loadSettings();
        this.sessions = []; // 所有会话的数组
        this.activeSessionId = null; // 当前活动会话ID
        this.isStreaming = false;
        this.isSearchActive = false; // 是否正在搜索模式
        this.searchIndex = null; // 搜索索引（可选）
        this.isNodeAxisCollapsed = false; // 节点轴是否折叠
        this.uploadedImageFile = null; // 待上传的图片文件
        this.uploadedImageBase64 = null; // 压缩后的Base64字符串
        this.isAgentMode = false; // 是否处于Agent模式

        // UI管理器
        this.uiManager = new UIManager();
        this.agentHandler = null; // Agent处理器

        // 知识库相关
        this.viewMode = 'chat'; // 'chat' or 'editor'
        this.notes = []; // 笔记列表
        this.activeNoteId = null; // 当前编辑的笔记ID
        this.editorInstance = null; // 编辑器实例
        this.knowledgeAgentHandler = null; // 知识库Copilot处理器
        this.isEditorPreview = false; // 编辑器预览模式
        this.autoSaveTimeout = null; // 自动保存定时器
        this.previewDebounceTimeout = null; // 预览防抖定时器
        this.notesWebSocket = null; // WebSocket连接
        this.approvedFolders = new Set(); // 已授权的文件夹路径集合
        this.activeNoteOriginalContent = null; // 笔记的原始内容（用于手动编辑diff）
        this.contentBeforeLLMUpdate = null; // LLM修改前的内容（用于全部回退）
        this.copilotContextFiles = []; // Copilot上下文文件列表
        this.shortcutManager = null; // 快捷键管理器
        this.diffViewer = null; // Diff视图组件

        // 工作台相关
        this.isWorkspaceMode = false; // 是否处于工作台模式
        this.workspaceView = null; // 工作台视图实例

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

        // 初始化设置管理器（需要在loadConfig之后）
        this.settingsManager = new SettingsManager(this.config, this.settings, this);

        this.agentHandler = new AgentHandler(this); // 初始化Agent处理器
        this.knowledgeAgentHandler = new KnowledgeAgentHandler(this); // 初始化知识库Agent

        // 初始化快捷键管理器
        const noteEditor = document.getElementById('noteEditor');
        this.shortcutManager = new ShortcutManager(noteEditor, this.config.shortcuts || [], this);
        this.shortcutManager.init();

        // 初始化Diff视图组件（DiffViewer会自己管理容器的创建）
        this.diffViewer = new DiffViewer(noteEditor);

        this.bindEvents();
        this.uiManager.loadThemePreference();
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
        const savedSettings = localStorage.getItem('appSettings');
        if (savedSettings) {
            this.settings = JSON.parse(savedSettings);
        } else {
            this.settings = {
                apiKey: '',
                endpoint: 'https://api.openai.com/v1/chat/completions',
                model: 'gpt-4o',
            };
        }

        // 初始化或验证分类设置
        if (!this.settings.categories || !Array.isArray(this.settings.categories) || this.settings.categories.length === 0) {
            this.settings.categories = [
              { id: 'work', name: '工作', color: '#3B82F6' }, // 蓝色
              { id: 'personal', name: '个人', color: '#10B981' }, // 绿色
              { id: 'study', name: '学习', color: '#F97316' }, // 橙色
              { id: 'default', name: '默认', color: '#FBBF24' } // 黄色
            ];
        }

        // 应用主题
        if (this.settings.theme) {
            document.documentElement.setAttribute('data-theme', this.settings.theme);
        }
    }

    saveSettings() {
        localStorage.setItem('appSettings', JSON.stringify(this.settings));

        // Apply theme
        if (this.settings.theme) {
            document.documentElement.setAttribute('data-theme', this.settings.theme);
        }

        // Update workspace styles if it exists
        if (this.workspace) {
            this.workspace.updateCategoryStyles();
        }
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

            this.uiManager.showNotification('已创建新会话', 'success');
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
            this.uiManager.showNotification('当前会话没有可压缩的内容', 'error');
            return;
        }

        if (activeSession.summary) {
            this.uiManager.showNotification('当前会话已经压缩过了', 'error');
            return;
        }

        // 显示加载提示
        this.uiManager.showNotification('正在压缩上下文...', 'info');

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

            this.uiManager.showNotification('上下文压缩完成！', 'success');

        } catch (error) {
            console.error('压缩上下文失败:', error);
            this.uiManager.showNotification(`压缩失败: ${error.message}`, 'error');
        }
    }

    showSummary(summary) {
        const summaryContainer = document.getElementById('summaryContainer');
        const summaryContent = document.getElementById('summaryContent');

        if (summaryContainer && summaryContent) {
            summaryContent.innerHTML = escapeHtml(summary).replace(/\n/g, '<br>');
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
            this.uiManager.showNotification('至少需要保留一个会话', 'error');
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

        this.uiManager.showNotification('会话已删除', 'success');
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
                    <span class="text-sm font-medium text-blue-400">${escapeHtml(result.sessionTitle)}</span>
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

        return escapeHtml(snippet);
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

        this.uiManager.showNotification('已跳转到搜索结果', 'success');
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
        this.uiManager.toggleDrawerCollapse(
            () => this.renderCollapsedSessionList(),
            () => this.exitSearchMode(),
            () => this.renderSessionList()
        );
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
                <div class="tooltip-collapsed">${escapeHtml(session.title)}</div>
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
        if (this.uiManager.isDrawerCollapsed) {
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
                        <div class="session-title font-medium text-sm truncate">${escapeHtml(session.title)}</div>
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
            this.settingsManager.showSettings();
        });

        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            this.settingsManager.saveSettingsFromModal();
        });

        document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
            this.settingsManager.hideSettings();
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

        // 工作台按钮
        document.getElementById('workspaceBtn').addEventListener('click', () => {
            this.enterWorkspaceMode();
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
                this.uiManager.toggleTheme();
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

        // 全部回退按钮
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        if (rejectAllChangesBtn) {
            rejectAllChangesBtn.addEventListener('click', () => {
                this.rejectAllChanges();
            });
        }

        // 完成审查按钮
        const finishDiffReviewBtn = document.getElementById('finishDiffReviewBtn');
        if (finishDiffReviewBtn) {
            finishDiffReviewBtn.addEventListener('click', () => {
                this.finishDiffReview();
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
                this.uiManager.toggleKnowledgeDrawer();
            });
        }

        const expandKnowledgeDrawerBtn = document.getElementById('expandKnowledgeDrawerBtn');
        if (expandKnowledgeDrawerBtn) {
            expandKnowledgeDrawerBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.uiManager.toggleKnowledgeDrawer();
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

        // Diff视图关闭按钮
        const closeDiffViewBtn = document.getElementById('closeDiffViewBtn');
        if (closeDiffViewBtn) {
            closeDiffViewBtn.addEventListener('click', () => {
                this.closeDiffView();
            });
        }

        // Diff视图取消按钮
        const cancelDiffBtn = document.getElementById('cancelDiffBtn');
        if (cancelDiffBtn) {
            cancelDiffBtn.addEventListener('click', () => {
                this.closeDiffView();
            });
        }

        // Diff视图确认保存按钮
        const confirmSaveBtn = document.getElementById('confirmSaveBtn');
        if (confirmSaveBtn) {
            confirmSaveBtn.addEventListener('click', () => {
                this.confirmDiffSave();
            });
        }

        // 笔记列表右键菜单事件
        const notesList = document.getElementById('notesList');
        if (notesList) {
            notesList.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e);
            });

            // 笔记列表拖拽放置事件（用于移动到根目录）
            notesList.addEventListener('dragover', (e) => {
                // 检查是否在空白区域（不在任何文件夹或文件节点上）
                const targetFolder = e.target.closest('.folder-node');
                const targetFile = e.target.closest('.file-node');

                if (!targetFolder && !targetFile) {
                    e.preventDefault();
                    e.stopPropagation();
                    notesList.style.backgroundColor = 'rgba(139, 92, 246, 0.1)';
                }
            });

            notesList.addEventListener('dragleave', (e) => {
                notesList.style.backgroundColor = '';
            });

            notesList.addEventListener('drop', (e) => {
                // 检查是否在空白区域
                const targetFolder = e.target.closest('.folder-node');
                const targetFile = e.target.closest('.file-node');

                if (!targetFolder && !targetFile) {
                    e.preventDefault();
                    e.stopPropagation();
                    notesList.style.backgroundColor = '';

                    const sourcePath = e.dataTransfer.getData('text/plain');
                    if (sourcePath) {
                        // 移动到根目录（空字符串表示根目录）
                        this.moveNoteOrFolder(sourcePath, '');
                    }
                }
            });
        }

        // 编辑器输入事件 - 实时更新预览 + 自动保存
        const noteEditor = document.getElementById('noteEditor');
        if (noteEditor) {
            noteEditor.addEventListener('input', () => {
                // 实时更新预览（防抖500ms）
                if (this.isEditorPreview) {
                    clearTimeout(this.previewDebounceTimeout);
                    this.previewDebounceTimeout = setTimeout(() => {
                        this.updateEditorPreview();
                    }, 500);
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

            // 编辑器右键划词功能
            noteEditor.addEventListener('contextmenu', (e) => {
                console.log('🖱️ noteEditor右键事件触发');
                console.log('  - 事件目标:', e.target);
                console.log('  - 事件目标ID:', e.target.id);
                console.log('  - editorInstance:', this.editorInstance);

                // 对于textarea，使用selectionStart和selectionEnd获取选中文本
                const textarea = e.target;
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const selectedText = textarea.value.substring(start, end).trim();

                console.log('📝 选中文本:', selectedText);
                console.log('📍 选区位置:', { start, end });
                console.log('📏 选中文本长度:', selectedText.length);

                if (selectedText && selectedText.length > 0) {
                    console.log('✅ 检测到选中文本，显示菜单');
                    e.preventDefault(); // 阻止默认右键菜单
                    this.handleEditorContextMenu(e, selectedText);
                } else {
                    console.log('❌ 未检测到选中文本，允许默认右键菜单');
                }
            });

            // 编辑器粘贴事件 - 支持粘贴图片
            noteEditor.addEventListener('paste', (e) => {
                this.handleEditorPaste(e);
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

        // notePreview右键菜单 - 支持图片缩放
        const notePreview = document.getElementById('notePreview');
        if (notePreview) {
            notePreview.addEventListener('contextmenu', (e) => {
                this.handlePreviewContextMenu(e);
            });
        }

        // Copilot输入区域拖拽事件
        const copilotInputArea = document.getElementById('copilotInputArea');
        if (copilotInputArea) {
            copilotInputArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copilotInputArea.style.backgroundColor = 'rgba(139, 92, 246, 0.2)';
            });

            copilotInputArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copilotInputArea.style.backgroundColor = '';
            });

            copilotInputArea.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copilotInputArea.style.backgroundColor = '';

                const filePath = e.dataTransfer.getData('text/plain');
                const itemType = e.dataTransfer.getData('item-type');
                const noteId = e.dataTransfer.getData('note-id');

                if (itemType === 'file' && (filePath || noteId)) {
                    // 添加文件到上下文
                    const actualPath = noteId || filePath.replace(/\.md$/, '');
                    this.addCopilotContextFile(actualPath);
                } else if (itemType === 'folder' && filePath) {
                    // TODO: 处理文件夹拖拽
                    console.log('文件夹拖拽暂不支持添加到上下文');
                }
            });
        }
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

    /**
     * 构建快捷键字符串（用于设置界面）
     * @param {KeyboardEvent} event
     * @returns {string} 例如 "Ctrl+B", "Ctrl+Shift+N"
     */

    /**
     * 检查快捷键冲突
     * @param {string} keyString - 快捷键字符串
     * @param {number} currentIndex - 当前编辑的快捷键索引
     * @returns {object|null} 冲突的快捷键对象，或null
     */

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
            this.uiManager.showNotification('请先在设置中配置API密钥', 'error');
            this.settingsManager.showSettings();
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
                this.uiManager.showNotification('图片上传失败', 'error');
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
                    ${content ? `<p>${escapeHtml(content)}</p>` : ''}
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
        content = unescapeUnicodeChars(content);
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
                        this.uiManager.showNotification('代码已复制', 'success');
                    });
                } else {
                    this.uiManager.showNotification('代码不存在', 'error');
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
                    this.uiManager.showNotification('HTML代码不存在', 'error');
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
                    this.uiManager.showNotification('HTML代码不存在', 'error');
                }
            });
        });
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

            this.uiManager.showNotification('已在新窗口打开全屏预览', 'success');

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
                    this.uiManager.showNotification('已在新窗口打开全屏预览', 'success');
                } else {
                    this.uiManager.showNotification('无法打开新窗口，请检查浏览器弹窗设置', 'error');
                }
            } else {
                throw new Error('后端预览服务响应错误');
            }
        } catch (error) {
            console.error('备用全屏预览错误:', error);
            this.uiManager.showNotification('全屏预览失败，请稍后重试', 'error');
        }
    }

    /**
     * 处理编辑器右键菜单
     */
    handleEditorContextMenu(e, selectedText) {
        console.log('🎯 handleEditorContextMenu 被调用');
        console.log('  - 选中文本:', selectedText);

        const textarea = e.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        console.log('  - 选区:', { start, end });

        // 计算textarea中选区的屏幕坐标
        const coords = this.getTextareaSelectionCoords(textarea, start, end);
        console.log('  - 坐标:', coords);

        // 显示简化版tooltip（只显示输入框，不显示快捷按钮）
        this.showEditorTooltip(coords.x, coords.y, selectedText, textarea, start, end);
    }

    /**
     * 显示编辑器专用的tooltip（只包含输入框）
     */
    showEditorTooltip(x, y, selectedText, textarea, selectionStart, selectionEnd) {
        console.log('💬 showEditorTooltip 被调用');
        console.log('  - 位置:', { x, y });
        console.log('  - 选中文本:', selectedText);

        // 移除旧的tooltip
        const oldTooltip = document.getElementById('editorTooltip');
        if (oldTooltip) {
            oldTooltip.remove();
        }

        // 创建新的tooltip
        const tooltip = document.createElement('div');
        tooltip.id = 'editorTooltip';
        tooltip.className = 'fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl';

        // 调整位置：默认在选中文本下方，如果空间不够则显示在上方
        const tooltipHeight = 60; // 预估高度
        const viewportHeight = window.innerHeight;
        let finalY = y + 10; // 默认在下方

        if (finalY + tooltipHeight > viewportHeight - 20) {
            // 空间不够，显示在上方
            finalY = y - tooltipHeight - 10;
        }

        // 确保tooltip不超出视口左右边界
        const tooltipWidth = 400;
        let finalX = Math.max(10, Math.min(x, window.innerWidth - tooltipWidth - 10));

        tooltip.style.left = `${finalX}px`;
        tooltip.style.top = `${finalY}px`;
        console.log('✅ 创建新tooltip元素，位置:', { finalX, finalY });

        // 添加关闭按钮、复制按钮和输入框
        tooltip.innerHTML = `
            <div class="flex items-start gap-2 p-3">
                <input
                    type="text"
                    id="editorTooltipInput"
                    class="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="输入指令来修改选中的文本..."
                    style="min-width: 300px;"
                />
                <button
                    id="editorTooltipCopyBtn"
                    class="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm font-semibold transition flex items-center gap-1"
                    title="复制选中的文本"
                >
                    <i data-lucide="copy" class="w-4 h-4"></i>
                    <span>复制</span>
                </button>
                <button
                    id="editorTooltipSendBtn"
                    class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-semibold transition flex items-center gap-1"
                >
                    <i data-lucide="send" class="w-4 h-4"></i>
                    <span>发送</span>
                </button>
                <button
                    id="editorTooltipCloseBtn"
                    class="p-2 hover:bg-gray-700 rounded transition"
                    title="关闭"
                >
                    <i data-lucide="x" class="w-4 h-4 text-gray-400"></i>
                </button>
            </div>
        `;

        // 添加到body
        document.body.appendChild(tooltip);
        console.log('✅ tooltip已添加到DOM');

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        // 保持textarea的选中状态 - 使用更可靠的方式
        // 先保存当前选区
        const savedSelection = { start: selectionStart, end: selectionEnd };

        // 保持选中状态的函数
        const maintainSelection = () => {
            if (textarea && textarea.isConnected) {
                textarea.setSelectionRange(savedSelection.start, savedSelection.end);
            }
        };

        // 初始设置选中状态
        setTimeout(() => {
            maintainSelection();
            console.log('✅ 恢复文本选中状态');

            // 聚焦到输入框
            const input = document.getElementById('editorTooltipInput');
            if (input) {
                input.focus();
                console.log('✅ 输入框已聚焦');
            }
        }, 50);

        // 当输入框失去焦点时,保持textarea的选中状态
        const input = document.getElementById('editorTooltipInput');
        if (input) {
            input.addEventListener('focus', () => {
                // 输入框获得焦点时,在背后维持textarea的选中状态
                setTimeout(maintainSelection, 10);
            });
        }

        // 绑定按钮事件
        const sendBtn = document.getElementById('editorTooltipSendBtn');
        const copyBtn = document.getElementById('editorTooltipCopyBtn');
        const closeBtn = document.getElementById('editorTooltipCloseBtn');

        const closeTooltip = () => {
            tooltip.remove();
            // 恢复选中状态
            textarea.focus();
            textarea.setSelectionRange(selectionStart, selectionEnd);
        };

        const handleSend = async () => {
            const instruction = input.value.trim();
            if (!instruction) return;

            // 移除tooltip
            tooltip.remove();

            // 调用LLM处理选中文本
            await this.processEditorSelectionWithLLM(selectedText, instruction, textarea, selectionStart, selectionEnd);
        };

        const handleCopy = async () => {
            try {
                await navigator.clipboard.writeText(selectedText);
                console.log('✅ 文本已复制到剪贴板');

                // 显示复制成功提示
                if (copyBtn) {
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = `
                        <i data-lucide="check" class="w-4 h-4"></i>
                        <span>已复制</span>
                    `;
                    copyBtn.classList.remove('bg-gray-600', 'hover:bg-gray-500');
                    copyBtn.classList.add('bg-green-600');

                    // 重新初始化图标
                    if (window.lucide) {
                        lucide.createIcons();
                    }

                    // 2秒后恢复原状
                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.classList.remove('bg-green-600');
                        copyBtn.classList.add('bg-gray-600', 'hover:bg-gray-500');
                        if (window.lucide) {
                            lucide.createIcons();
                        }
                    }, 2000);
                }

                // 保持文本选中状态
                maintainSelection();
            } catch (err) {
                console.error('❌ 复制失败:', err);
                if (this.uiManager) {
                    this.uiManager.showNotification('复制失败,请手动复制', 'error');
                }
            }
        };

        if (sendBtn) {
            sendBtn.addEventListener('click', handleSend);
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleCopy();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTooltip();
            });
        }

        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    handleSend();
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeTooltip();
                }
            });
        }

        // 点击外部关闭tooltip
        const closeOnClickOutside = (e) => {
            if (!tooltip.contains(e.target) && e.target !== textarea) {
                closeTooltip();
                document.removeEventListener('click', closeOnClickOutside);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeOnClickOutside);
        }, 200);

        // 添加一个周期性的选中状态维护（避免意外失去选中）
        const selectionMaintainer = setInterval(() => {
            if (!document.body.contains(tooltip)) {
                // tooltip已被移除,清除定时器
                clearInterval(selectionMaintainer);
                return;
            }
            // 如果当前焦点在输入框上,保持textarea的选中状态
            if (document.activeElement === input) {
                maintainSelection();
            }
        }, 100);

        // 当tooltip被移除时清除定时器
        const originalRemove = tooltip.remove.bind(tooltip);
        tooltip.remove = function() {
            clearInterval(selectionMaintainer);
            originalRemove();
        };
    }

    /**
     * 使用LLM处理编辑器中的选中文本
     */
    async processEditorSelectionWithLLM(selectedText, instruction, textarea, selectionStart, selectionEnd) {
        try {
            this.uiManager.showNotification('正在处理...', 'info');

            // 构造prompt
            const prompt = `请根据以下指令修改所提供的文本。只返回修改后的文本，不要包含任何解释或额外内容。

指令：${instruction}

原文本：
${selectedText}`;

            // 调用LLM API
            const response = await fetch(this.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`API请求失败: ${response.statusText}`);
            }

            const data = await response.json();
            const modifiedText = data.choices[0].message.content.trim();

            // 生成新的完整内容
            const originalFullContent = textarea.value;
            const newFullContent =
                originalFullContent.substring(0, selectionStart) +
                modifiedText +
                originalFullContent.substring(selectionEnd);

            console.log('🎯 右键修改完成，准备显示Diff');

            // ✨ 保存初始内容作为Diff基准（如果还没保存）
            if (this.contentBeforeLLMUpdate === null || this.contentBeforeLLMUpdate === undefined) {
                this.contentBeforeLLMUpdate = originalFullContent;
                console.log('📌 保存初始内容作为 Diff 基准');
            }

            // ✨ 使用 DiffViewer 显示差异
            this.diffViewer.show({
                originalContent: this.contentBeforeLLMUpdate,
                newContent: newFullContent,
                onUpdate: (updatedContent) => {
                    textarea.value = updatedContent;
                    this.activeNoteOriginalContent = updatedContent;
                    this.saveActiveNote();
                },
                onClose: () => {
                    console.log('Diff view closed.');
                }
            });

            // 更新编辑器内容
            textarea.value = newFullContent;
            this.activeNoteOriginalContent = newFullContent;

            // 保存到后端
            if (this.activeNoteId) {
                await this.saveNote(this.activeNoteId);
            }

            this.uiManager.showNotification('修改完成', 'success');
        } catch (error) {
            console.error('LLM处理失败:', error);
            this.uiManager.showNotification('处理失败: ' + error.message, 'error');
        }
    }

    handleTextSelection(e) {
        // 编辑器的划词功能已改为右键触发，这里跳过
        if (e.target.id === 'noteEditor') {
            return;
        }

        // 原有逻辑：处理普通元素中的选中文本
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText && selectedText.length > 3) {
            // 检查选择是否在AI消息中或notePreview中
            let targetArea = e.target.closest('.ai-message') || e.target.closest('#notePreview');

            // 如果没有找到，尝试通过选择范围查找
            if (!targetArea && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                let container = range.commonAncestorContainer;

                // 如果是文本节点，获取其父元素
                if (container.nodeType === Node.TEXT_NODE) {
                    container = container.parentElement;
                }

                targetArea = container.closest('.ai-message') || container.closest('#notePreview');
            }

            if (targetArea) {
                // 获取选择的边界矩形
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // 使用选择区域的中心位置
                const x = rect.left + rect.width / 2;
                const y = rect.top - 10;

                this.showTooltip(x, y, selectedText, targetArea);
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

        // 保存当前选区，用于后续恢复
        const selection = window.getSelection();
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

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

        // 自动聚焦到输入框，同时恢复文本选中状态
        setTimeout(() => {
            // 恢复notePreview的文本选中状态
            if (range) {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                console.log('✅ 恢复notePreview文本选中状态');
            }

            // 聚焦到输入框
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
        // 判断上下文来源：textarea、notePreview或普通消息
        let originalContent;
        if (originalMessage.tagName === 'TEXTAREA') {
            // 来自编辑器
            originalContent = originalMessage.value;
        } else if (originalMessage.id === 'notePreview') {
            // 来自笔记预览
            originalContent = this.editorInstance ? this.editorInstance.value : '';
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
            this.uiManager.showNotification('Agent模式已开启，已创建新会话', 'success');
        } else {
            agentBtn.classList.remove('active');
            messageInput.placeholder = '输入你的问题...';
            messageInput.classList.remove('agent-mode-active');
            this.uiManager.showNotification('Agent模式已关闭', 'info');
        }
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
            this.uiManager.showNotification('请选择图片文件', 'error');
            return;
        }

        try {
            await this.compressAndPreviewImage(file);
        } catch (error) {
            console.error('图片处理失败:', error);
            this.uiManager.showNotification('图片处理失败: ' + error.message, 'error');
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

                this.uiManager.showNotification(`图片已压缩 (${(compressedFile.size / 1024).toFixed(1)}KB)`, 'success');
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
                        <strong>问:</strong> ${escapeHtml(followup.question)}
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

        // 绑定关闭按钮事件
        const closeBtn = modal.querySelector('.close-followup');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.remove();
            });
        }

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
                folderDiv.draggable = true;
                folderDiv.dataset.path = node.path;
                folderDiv.dataset.type = 'folder';
                folderDiv.innerHTML = `
                    <i data-lucide="chevron-right" class="w-4 h-4 text-gray-400 folder-chevron transition-transform"></i>
                    <i data-lucide="folder" class="w-4 h-4 text-yellow-400"></i>
                    <span class="font-medium text-sm">${escapeHtml(node.name)}</span>
                `;

                // 子节点容器
                const childrenContainer = document.createElement('ul');
                childrenContainer.className = 'folder-children hidden';

                // 拖拽开始
                folderDiv.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', node.path);
                    e.dataTransfer.setData('item-type', 'folder');
                    folderDiv.style.opacity = '0.5';
                });

                // 拖拽结束
                folderDiv.addEventListener('dragend', (e) => {
                    folderDiv.style.opacity = '1';
                });

                // 拖拽悬停
                folderDiv.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    folderDiv.style.backgroundColor = 'rgba(139, 92, 246, 0.3)';
                });

                // 拖拽离开
                folderDiv.addEventListener('dragleave', (e) => {
                    folderDiv.style.backgroundColor = '';
                });

                // 接收放置
                folderDiv.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    folderDiv.style.backgroundColor = '';

                    const sourcePath = e.dataTransfer.getData('text/plain');
                    const targetPath = node.path;

                    if (sourcePath && sourcePath !== targetPath) {
                        this.moveNoteOrFolder(sourcePath, targetPath);
                    }
                });

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
                fileDiv.draggable = true;
                fileDiv.dataset.path = node.path;
                fileDiv.dataset.type = 'file';

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
                        ${node.tags.map(tag => `<span class="text-xs px-2 py-0.5 bg-blue-900 bg-opacity-50 text-blue-300 rounded">#${escapeHtml(tag)}</span>`).join('')}
                    </div>`;
                }

                fileDiv.innerHTML = `
                    <div class="flex items-center gap-2">
                        <i data-lucide="file-text" class="w-4 h-4 text-purple-400"></i>
                        <span class="font-medium text-sm">${escapeHtml(title)}</span>
                    </div>
                    ${tagsHtml}
                `;

                // 拖拽开始
                fileDiv.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', node.path);
                    e.dataTransfer.setData('item-type', 'file');
                    e.dataTransfer.setData('note-id', noteId);
                    fileDiv.style.opacity = '0.5';
                });

                // 拖拽结束
                fileDiv.addEventListener('dragend', (e) => {
                    fileDiv.style.opacity = '1';
                });

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

        // 清空Copilot上下文文件标签，并添加当前文档
        this.copilotContextFiles = [];
        // 自动添加当前打开的文档到上下文
        if (noteId) {
            this.copilotContextFiles.push(noteId);
        }
        this.renderCopilotContextTags();

        // 加载笔记内容
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`);
            const content = await response.text();

            // 初始化编辑器
            this.initEditor(content, noteId);
        } catch (error) {
            console.error('加载笔记内容失败:', error);
            this.uiManager.showNotification('加载笔记失败: ' + error.message, 'error');
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
            // 保存原始内容用于diff比较
            this.activeNoteOriginalContent = content;
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
            this.uiManager.showNotification('没有活动的笔记', 'error');
            return;
        }

        const currentContent = this.editorInstance.value;

        // 手动编辑时直接保存，不显示diff
        await this.performActualSave(currentContent);
    }

    /**
     * 删除笔记或文件夹
     */
    async deleteNoteOrFolder(path, type) {
        const itemName = path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path;
        const confirmMsg = type === 'folder'
            ? `确定要删除文件夹"${itemName}"及其所有内容吗？此操作不可恢复！`
            : `确定要删除文件"${itemName}"吗？此操作不可恢复！`;

        if (!confirm(confirmMsg)) {
            return;
        }

        try {
            const response = await fetch('http://localhost:8080/api/notes/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: path,
                    type: type
                })
            });

            const result = await response.json();

            if (result.success) {
                this.uiManager.showNotification('删除成功', 'success');

                // 如果删除的是当前打开的笔记，关闭编辑器
                if (this.activeNoteId && path.includes(this.activeNoteId)) {
                    this.activeNoteId = null;
                    this.editorInstance = null;
                    // 切换回聊天模式
                    this.viewMode = 'chat';
                    document.body.classList.remove('view-mode-editor');
                    document.body.classList.add('view-mode-chat');
                    const chatContainer = document.getElementById('chatContainer');
                    const editorContainer = document.getElementById('editor-container');
                    if (chatContainer) chatContainer.classList.remove('hidden');
                    if (editorContainer) editorContainer.classList.add('hidden');
                }

                await this.loadNotes();
            } else {
                this.uiManager.showNotification(`删除失败: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('删除失败:', error);
            this.uiManager.showNotification('删除失败: ' + error.message, 'error');
        }
    }

    /**
     * 移动笔记或文件夹
     */
    async moveNoteOrFolder(sourcePath, targetFolderPath) {
        try {
            const response = await fetch('http://localhost:8080/api/notes/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    source: sourcePath,
                    destination: targetFolderPath
                })
            });

            const result = await response.json();

            if (result.success) {
                this.uiManager.showNotification('移动成功', 'success');
                await this.loadNotes();
            } else {
                this.uiManager.showNotification(`移动失败: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('移动文件失败:', error);
            this.uiManager.showNotification('移动文件失败: ' + error.message, 'error');
        }
    }

    /**
     * 确认diff后执行实际保存
     */
    async confirmDiffSave() {
        if (!this.pendingSaveContent) {
            this.uiManager.showNotification('没有待保存的内容', 'error');
            return;
        }

        await this.performActualSave(this.pendingSaveContent);
        this.pendingSaveContent = null;
        this.closeDiffView();
    }

    /**
     * 执行实际的保存操作
     */
    async performActualSave(content) {
        if (!this.activeNoteId) {
            this.uiManager.showNotification('没有活动的笔记', 'error');
            return;
        }

        try {
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

            this.uiManager.showNotification('笔记已保存', 'success');

            // 更新原始内容为当前保存的内容
            this.activeNoteOriginalContent = content;
        } catch (error) {
            console.error('保存笔记失败:', error);
            this.uiManager.showNotification('保存失败: ' + error.message, 'error');
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
                this.uiManager.showNotification('创建新笔记功能待实现', 'info');
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
            this.uiManager.toggleKnowledgeDrawer();
        }

        // 在笔记搜索框中输入 tag:标签名
        const noteSearch = document.getElementById('noteSearch');
        if (noteSearch) {
            noteSearch.value = `tag:${tag}`;
            // 触发搜索
            noteSearch.dispatchEvent(new Event('input'));
        }

        this.uiManager.showNotification(`搜索标签: ${tag}`, 'info');
    }

    /**
     * 添加Copilot上下文文件
     */
    addCopilotContextFile(noteId) {
        // 避免重复添加
        if (this.copilotContextFiles.includes(noteId)) {
            this.uiManager.showNotification('文件已在上下文中', 'info');
            return;
        }

        this.copilotContextFiles.push(noteId);
        this.renderCopilotContextTags();
        this.uiManager.showNotification(`已添加上下文: ${noteId}`, 'success');
    }

    /**
     * 移除Copilot上下文文件
     */
    removeCopilotContextFile(noteId) {
        const index = this.copilotContextFiles.indexOf(noteId);
        if (index > -1) {
            this.copilotContextFiles.splice(index, 1);
            this.renderCopilotContextTags();
            this.uiManager.showNotification(`已移除上下文: ${noteId}`, 'info');
        }
    }

    /**
     * 渲染Copilot上下文标签
     */
    renderCopilotContextTags() {
        const tagsContainer = document.getElementById('copilotContextTags');
        if (!tagsContainer) return;

        // 清空容器
        tagsContainer.innerHTML = '';

        if (this.copilotContextFiles.length === 0) {
            tagsContainer.classList.add('hidden');
            return;
        }

        tagsContainer.classList.remove('hidden');

        // 创建标签
        this.copilotContextFiles.forEach(noteId => {
            const tag = document.createElement('div');
            tag.className = 'inline-flex items-center gap-1 px-2 py-1 bg-purple-900 bg-opacity-50 border border-purple-600 rounded text-xs text-purple-300';

            // 提取文件名（最多8个字符）
            const fileName = noteId.includes('/') ? noteId.substring(noteId.lastIndexOf('/') + 1) : noteId;
            const displayName = fileName.length > 8 ? fileName.substring(0, 8) + '...' : fileName;

            tag.innerHTML = `
                <span>@${escapeHtml(displayName)}</span>
                <button class="hover:text-red-400 transition-colors" title="移除" data-note-id="${escapeHtml(noteId)}">
                    <i data-lucide="x" class="w-3 h-3"></i>
                </button>
            `;

            // 移除按钮点击事件
            const removeBtn = tag.querySelector('button');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const noteIdToRemove = removeBtn.dataset.noteId;
                this.removeCopilotContextFile(noteIdToRemove);
            });

            tagsContainer.appendChild(tag);
        });

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
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
     * 处理预览区右键菜单
     */
    handlePreviewContextMenu(e) {
        // 检查是否点击的是图片
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
            this.showImageZoomMenu(e.target, e.clientX, e.clientY);
        }
    }

    /**
     * 显示图片缩放菜单
     */
    showImageZoomMenu(imageElement, x, y) {
        // 移除旧菜单
        this.hideImageZoomMenu();

        // 创建菜单容器
        const menu = document.createElement('div');
        menu.id = 'imageZoomMenu';
        menu.className = 'fixed z-[1000] bg-gray-800 border border-gray-600 rounded-lg shadow-xl';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // 获取当前图片的缩放比例（优先从src的#zoom参数读取，其次从style.width）
        const src = imageElement.src;
        const zoomMatch = src.match(/#zoom=(\d+)/);
        let currentScale = 60; // 默认值

        if (zoomMatch) {
            currentScale = parseInt(zoomMatch[1]);
        } else if (imageElement.style.width) {
            currentScale = parseInt(imageElement.style.width);
        }

        menu.innerHTML = `
            <div class="p-3 min-w-[200px]">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-medium text-gray-300">图片缩放</span>
                    <span id="zoomValue" class="text-sm text-blue-400 font-semibold">${currentScale}%</span>
                </div>
                <input
                    type="range"
                    id="zoomSlider"
                    min="20"
                    max="100"
                    value="${currentScale}"
                    class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    style="accent-color: #3b82f6;"
                />
            </div>
        `;

        document.body.appendChild(menu);

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        // 绑定滑轮事件
        const slider = menu.querySelector('#zoomSlider');
        const valueDisplay = menu.querySelector('#zoomValue');

        slider.addEventListener('input', (e) => {
            const newValue = e.target.value;
            valueDisplay.textContent = `${newValue}%`;
            imageElement.style.width = `${newValue}%`;

            // 更新Markdown中的缩放参数
            this.updateImageZoomInMarkdown(imageElement, newValue);
        });

        // 点击外部关闭菜单
        const closeOnClickOutside = (e) => {
            if (!menu.contains(e.target)) {
                this.hideImageZoomMenu();
                document.removeEventListener('click', closeOnClickOutside);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeOnClickOutside);
        }, 100);
    }

    /**
     * 隐藏图片缩放菜单
     */
    hideImageZoomMenu() {
        const menu = document.getElementById('imageZoomMenu');
        if (menu) {
            menu.remove();
        }
    }

    /**
     * 更新Markdown中的图片缩放参数
     */
    updateImageZoomInMarkdown(imageElement, zoomValue) {
        const noteEditor = document.getElementById('noteEditor');
        if (!noteEditor) return;

        // 获取图片的src，移除可能的查询参数和fragment
        let imageSrc = imageElement.src;

        // 将绝对路径转换为相对路径
        const baseUrl = window.location.origin;
        if (imageSrc.startsWith(baseUrl)) {
            imageSrc = imageSrc.substring(baseUrl.length);
        }

        // 移除已有的#zoom参数以便匹配
        const srcWithoutZoom = imageSrc.split('#')[0];

        // 获取当前Markdown内容
        let content = noteEditor.value;

        // 匹配Markdown图片语法: ![...](path) 或 ![...](path#zoom=xx)
        // 需要转义特殊字符
        const escapedPath = srcWithoutZoom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const imageRegex = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedPath}(#zoom=\\d+)?(\\))`, 'g');

        // 替换为带有新缩放参数的图片链接
        const newContent = content.replace(imageRegex, `$1${srcWithoutZoom}#zoom=${zoomValue}$3`);

        // 更新编辑器内容
        if (newContent !== content) {
            noteEditor.value = newContent;

            // 触发自动保存
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = setTimeout(() => {
                this.saveActiveNote();
            }, 5000);
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

        // 为预览中的图片设置宽度（从URL的#zoom参数读取，或使用默认60%）
        notePreview.querySelectorAll('img').forEach(img => {
            // 检查图片src是否包含#zoom参数
            const src = img.src;
            const zoomMatch = src.match(/#zoom=(\d+)/);

            if (zoomMatch) {
                // 如果有zoom参数，使用该值
                img.style.width = `${zoomMatch[1]}%`;
            } else if (!img.style.width) {
                // 否则使用默认值
                img.style.width = '60%';
            }
        });

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

            this.uiManager.showNotification('笔记创建成功', 'success');

            // 重新加载笔记列表
            await this.loadNotes();

            // 打开新创建的笔记
            this.switchToEditorMode(noteId);
        } catch (error) {
            console.error('创建笔记失败:', error);
            this.uiManager.showNotification('创建失败: ' + error.message, 'error');
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

            this.uiManager.showNotification('文件夹创建成功', 'success');

            // 重新加载笔记列表
            await this.loadNotes();
        } catch (error) {
            console.error('创建文件夹失败:', error);
            this.uiManager.showNotification('创建失败: ' + error.message, 'error');
        }
    }

    /**
     * 显示右键菜单
     */
    showContextMenu(event) {
        // 移除已存在的菜单
        this.hideContextMenu();

        // 获取右键点击的目标元素（文件夹或文件）
        let folderElement = event.target.closest('.folder-node');
        let fileElement = event.target.closest('.file-node');
        let parentPath = '';

        // 如果点击在文件夹上，使用文件夹路径作为父路径
        if (folderElement) {
            parentPath = folderElement.dataset.path || '';
            // 移除.md扩展名（如果有）
            parentPath = parentPath.replace(/\.md$/, '');
        }
        // 如果点击在文件上，使用文件所在目录作为父路径
        else if (fileElement) {
            const filePath = fileElement.dataset.path || '';
            // 移除文件名，保留目录部分
            const lastSlash = filePath.lastIndexOf('/');
            parentPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '';
        }

        // 创建菜单元素
        const menu = document.createElement('div');
        menu.id = 'contextMenu';
        menu.className = 'fixed bg-gray-800 border border-gray-600 rounded-lg shadow-lg py-2 z-[1002]';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;

        // 获取当前点击的目标路径（用于删除）
        let targetPath = '';
        let targetType = '';
        if (folderElement) {
            targetPath = folderElement.dataset.path || '';
            targetType = 'folder';
        } else if (fileElement) {
            targetPath = fileElement.dataset.path || '';
            targetType = 'file';
        }

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

        // 如果点击了具体的文件或文件夹，添加删除选项
        if (targetPath) {
            menuItems.push({
                icon: 'trash-2',
                label: targetType === 'folder' ? '删除文件夹' : '删除文件',
                className: 'text-red-400 hover:bg-red-900',
                handler: () => {
                    this.hideContextMenu();
                    this.deleteNoteOrFolder(targetPath, targetType);
                }
            });
        }

        // 构建菜单HTML
        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            const baseClass = 'px-4 py-2 hover:bg-gray-700 cursor-pointer flex items-center gap-2 text-sm';
            menuItem.className = item.className ? `${baseClass} ${item.className}` : baseClass;
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
     * 处理编辑器粘贴事件 - 支持粘贴图片
     */
    async handleEditorPaste(event) {
        const items = event.clipboardData?.items;
        if (!items) return;

        // 查找图片类型的数据
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                event.preventDefault(); // 阻止默认粘贴行为

                const file = item.getAsFile();
                if (file) {
                    // 生成基于时间的文件名 MM_DD_HH_MM_SS
                    const now = new Date();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const seconds = String(now.getSeconds()).padStart(2, '0');

                    // 获取文件扩展名
                    const ext = file.name.split('.').pop() || 'png';
                    const newFileName = `${month}_${day}_${hours}_${minutes}_${seconds}.${ext}`;

                    // 创建新的File对象
                    const renamedFile = new File([file], newFileName, { type: file.type });

                    // 调用上传和插入方法
                    await this.uploadAndInsertImage(renamedFile);
                }
                break;
            }
        }
    }

    /**
     * 上传图片并插入到编辑器光标位置
     */
    async uploadAndInsertImage(file) {
        const noteEditor = document.getElementById('noteEditor');
        if (!noteEditor) return;

        // 获取图片存储配置
        const imageStorageMode = this.config?.knowledgeBase?.imageStorage?.mode || 'fixed';

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

            this.uiManager.showNotification('图片上传成功', 'success');
        } catch (error) {
            console.error('图片上传失败:', error);
            this.uiManager.showNotification(`图片上传失败: ${error.message}`, 'error');
        }
    }

    /**
     * 处理编辑器中的图片拖拽上传
     */
    async handleEditorImageDrop(event) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;

        // 遍历所有文件
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // 检查是否是图片
            if (!file.type.startsWith('image/')) {
                this.uiManager.showNotification(`文件 ${file.name} 不是图片`, 'warning');
                continue;
            }

            // 调用上传和插入方法
            await this.uploadAndInsertImage(file);
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
     * 重新加载笔记内容（从后端）
     */
    async reloadNoteContent(noteId) {
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`);
            if (!response.ok) {
                throw new Error('加载笔记失败');
            }
            const note = await response.json();
            const noteEditor = document.getElementById('noteEditor');
            if (noteEditor) {
                noteEditor.value = note.content;
                this.activeNoteOriginalContent = note.content; // 更新原始内容
            }
        } catch (error) {
            console.error('重新加载笔记内容失败:', error);
        }
    }

    /**
     * 准备流式Diff渲染（隐藏编辑器，显示Diff容器）
     * @param {string} originalContent - 原始内容
     */
    async prepareForStreaming(originalContent) {
        console.log('🎬 准备流式Diff渲染');

        const noteEditor = document.getElementById('noteEditor');
        const notePreview = document.getElementById('notePreview');

        if (!noteEditor) {
            console.error('编辑器未找到');
            return;
        }

        // ✨ 保存原始内容作为Diff基准（如果还没保存的话）
        if (this.contentBeforeLLMUpdate === null || this.contentBeforeLLMUpdate === undefined) {
            this.contentBeforeLLMUpdate = originalContent;
            console.log('📌 保存初始内容作为 Diff 基准');
        }

        // 隐藏编辑器和预览
        noteEditor.classList.add('hidden');
        if (notePreview) {
            notePreview.classList.add('hidden');
        }

        // 查找或创建流式Diff容器
        let streamingDiffContainer = document.getElementById('streamingDiffContainer');
        if (!streamingDiffContainer) {
            streamingDiffContainer = document.createElement('div');
            streamingDiffContainer.id = 'streamingDiffContainer';
            streamingDiffContainer.className = noteEditor.className.replace('hidden', ''); // 继承编辑器样式
            streamingDiffContainer.style.overflowY = 'auto';
            streamingDiffContainer.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
            streamingDiffContainer.style.fontSize = '13px';
            noteEditor.parentNode.insertBefore(streamingDiffContainer, noteEditor.nextSibling);
        }

        streamingDiffContainer.classList.remove('hidden');
        streamingDiffContainer.innerHTML = '<div class="p-4 text-gray-400">🌊 正在流式生成内容...</div>';

        console.log('✅ 流式Diff容器准备完成');
    }

    /**
     * 完成流式Diff渲染（更新编辑器，隐藏Diff容器）
     * @param {string} noteId - 笔记ID
     * @param {string} finalContent - 最终内容
     * @param {string} originalContent - 原始内容
     */
    async finalizeStreaming(noteId, finalContent, originalContent) {
        console.log('🏁 完成流式Diff渲染');

        const noteEditor = document.getElementById('noteEditor');
        const streamingDiffContainer = document.getElementById('streamingDiffContainer');

        if (!noteEditor) {
            console.error('编辑器未找到');
            return;
        }

        // 更新编辑器内容
        noteEditor.value = finalContent;
        this.activeNoteOriginalContent = finalContent;

        // 保存到后端
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: finalContent })
            });

            if (!response.ok) {
                throw new Error('保存失败');
            }

            console.log('✅ 内容已保存到后端');
        } catch (error) {
            console.error('保存失败:', error);
            this.uiManager.showNotification('保存失败: ' + error.message, 'error');
        }

        // 隐藏Diff容器，显示编辑器
        if (streamingDiffContainer) {
            streamingDiffContainer.classList.add('hidden');
        }
        noteEditor.classList.remove('hidden');

        // 如果在预览模式，更新预览
        if (this.isEditorPreview) {
            this.updateEditorPreview();
            const notePreview = document.getElementById('notePreview');
            if (notePreview) {
                notePreview.classList.remove('hidden');
            }
        }

        // 显示回退按钮
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        if (rejectAllChangesBtn) {
            rejectAllChangesBtn.classList.remove('hidden');
        }

        this.uiManager.showNotification('内容改写完成', 'success');
        console.log('✅ 流式Diff渲染完成');
    }

    /**
     * 直接更新编辑器内容（在 noteEditor 位置内联显示 Diff）
     * @param {string} noteId - 笔记ID
     * @param {string} newContent - 新内容
     * @param {Array} diffData - Diff数据（用于回退功能）
     */
    async updateEditorContentDirectly(noteId, newContent, diffData) {
        console.log('✨ 累积 Diff 模式：更新编辑器内容', { noteId, newContentLength: newContent?.length });

        // 确保在编辑器模式
        if (this.viewMode !== 'editor' || this.activeNoteId !== noteId) {
            console.log('🔄 切换到编辑器模式');
            await this.switchToEditorMode(noteId);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const noteEditor = document.getElementById('noteEditor');
        if (!noteEditor) {
            console.error('❌ 编辑器未找到');
            return;
        }

        // ✨ 关键：如果这是 Agent 的第一次修改，保存初始内容
        if (this.contentBeforeLLMUpdate === null || this.contentBeforeLLMUpdate === undefined) {
            this.contentBeforeLLMUpdate = noteEditor.value;
            console.log('📌 保存初始内容作为 Diff 基准', {
                length: this.contentBeforeLLMUpdate.length
            });
        }

        // ✨ 使用 DiffViewer 显示累积 Diff
        console.log('✅ 准备显示Diff视图...');
        this.diffViewer.show({
            originalContent: this.contentBeforeLLMUpdate,
            newContent: newContent,
            onUpdate: (updatedContent) => {
                noteEditor.value = updatedContent;
                this.activeNoteOriginalContent = updatedContent;
                this.saveActiveNote();
            },
            onClose: () => {
                console.log('Diff view closed.');
            }
        });

        // 直接应用更改（不阻塞）
        noteEditor.value = newContent;
        this.activeNoteOriginalContent = newContent;

        // 如果在预览模式，更新预览
        if (this.isEditorPreview) {
            this.updateEditorPreview();
        }

        // 显示"全部回退"按钮
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        if (rejectAllChangesBtn) {
            rejectAllChangesBtn.classList.remove('hidden');
        }

        // 隐藏"完成审查"按钮（不再需要）
        const finishDiffReviewBtn = document.getElementById('finishDiffReviewBtn');
        if (finishDiffReviewBtn) {
            finishDiffReviewBtn.classList.add('hidden');
        }

        console.log('✅ 编辑器内容已直接更新');
    }


    /**
     * 在编辑器位置显示内联 Diff 视图（带手动应用按钮）
     * @param {HTMLElement} noteEditor - 编辑器元素
     * @param {Array} diffData - Diff 数据
     * @param {string} newContent - 新内容
     * @returns {Promise<boolean>} - 是否应用更改
     */
    async showInlineDiffInEditor(noteEditor, diffData, newContent) {
        console.log('📊 在编辑器位置显示内联 Diff');

        return new Promise((resolve) => {
            // 隐藏编辑器
            noteEditor.classList.add('hidden');

            // 查找或创建内联 Diff 容器
            let inlineDiffContainer = document.getElementById('inlineDiffContainer');
            if (!inlineDiffContainer) {
                inlineDiffContainer = document.createElement('div');
                inlineDiffContainer.id = 'inlineDiffContainer';
                inlineDiffContainer.className = noteEditor.className.replace('hidden', '');
                noteEditor.parentNode.insertBefore(inlineDiffContainer, noteEditor.nextSibling);
            }

            inlineDiffContainer.classList.remove('hidden');
            inlineDiffContainer.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
            inlineDiffContainer.style.fontSize = '13px';
            inlineDiffContainer.style.position = 'relative';
            inlineDiffContainer.innerHTML = '';

            // 添加顶部操作栏
            const actionBar = document.createElement('div');
            actionBar.className = 'sticky top-0 z-10 bg-gray-800 border-b border-gray-700 p-3 flex items-center justify-between';
            actionBar.innerHTML = `
                <div class="flex items-center gap-2">
                    <i data-lucide="git-compare" class="w-5 h-5 text-blue-400"></i>
                    <span class="text-sm font-semibold text-blue-400">正在查看更改</span>
                    <span class="text-xs text-gray-400">(${diffData.filter(l => l.type !== 'unchanged').length} 处修改)</span>
                </div>
                <div class="flex items-center gap-2">
                    <button id="applyDiffBtn" class="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition">
                        <i data-lucide="check" class="w-4 h-4 inline mr-1"></i>
                        应用更改
                    </button>
                    <button id="cancelDiffBtn" class="px-4 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded transition">
                        <i data-lucide="x" class="w-4 h-4 inline mr-1"></i>
                        取消
                    </button>
                </div>
            `;
            inlineDiffContainer.appendChild(actionBar);

            // 创建滚动容器
            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'overflow-y-auto';
            scrollContainer.style.maxHeight = 'calc(100vh - 200px)';

            // 渲染 Diff 内容
            diffData.forEach(line => {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'leading-6 py-1 px-3';

                if (line.type === 'removed') {
                    lineDiv.classList.add('bg-red-900', 'bg-opacity-20', 'border-l-4', 'border-red-500');
                    lineDiv.innerHTML = `<span class="text-red-300 line-through opacity-80">${escapeHtml(line.content)}</span>`;
                } else if (line.type === 'added') {
                    lineDiv.classList.add('bg-green-900', 'bg-opacity-20', 'border-l-4', 'border-green-500');
                    lineDiv.innerHTML = `<span class="text-green-300">${escapeHtml(line.content)}</span>`;
                } else if (line.type === 'modified') {
                    // 修改的行显示为旧内容（红色）+ 新内容（绿色），并高亮字符级差异
                    const oldContent = line.oldContent || '';
                    const newContent = line.content || '';

                    const oldLineDiv = document.createElement('div');
                    oldLineDiv.className = 'leading-6 py-1 px-3 bg-red-900 bg-opacity-20 border-l-4 border-red-500';
                    // 使用字符级diff，只显示删除部分
                    const oldDiff = this.computeInlineDiffWithDeepHighlight(oldContent, newContent, 'old');
                    oldLineDiv.innerHTML = oldDiff;
                    scrollContainer.appendChild(oldLineDiv);

                    const newLineDiv = document.createElement('div');
                    newLineDiv.className = 'leading-6 py-1 px-3 bg-green-900 bg-opacity-20 border-l-4 border-green-500';
                    // 使用字符级diff，只显示新增部分
                    const newDiff = this.computeInlineDiffWithDeepHighlight(oldContent, newContent, 'new');
                    newLineDiv.innerHTML = newDiff;
                    scrollContainer.appendChild(newLineDiv);
                    return; // 已经添加了两行，跳过后面的 appendChild
                } else {
                    lineDiv.classList.add('bg-gray-800', 'bg-opacity-10');
                    lineDiv.innerHTML = `<span class="text-gray-300">${escapeHtml(line.content)}</span>`;
                }

                scrollContainer.appendChild(lineDiv);
            });

            inlineDiffContainer.appendChild(scrollContainer);

            // 初始化图标
            if (window.lucide) {
                lucide.createIcons();
            }

            // 绑定按钮事件
            const applyBtn = document.getElementById('applyDiffBtn');
            const cancelBtn = document.getElementById('cancelDiffBtn');

            const cleanupAndResolve = (shouldApply) => {
                // 隐藏 Diff 容器，显示编辑器
                inlineDiffContainer.classList.add('hidden');
                noteEditor.classList.remove('hidden');

                if (shouldApply) {
                    // 应用更改
                    noteEditor.value = newContent;
                    this.activeNoteOriginalContent = newContent;
                }

                resolve(shouldApply);
            };

            applyBtn.addEventListener('click', () => cleanupAndResolve(true));
            cancelBtn.addEventListener('click', () => cleanupAndResolve(false));

            console.log('✅ 内联 Diff 已显示，等待用户操作');
        });
    }

    /**
     * 完成diff审查
     */
    async finishDiffReview() {
        console.log('✅ 完成审查，关闭diff视图');
        this.closeDiffView();
        this.uiManager.showNotification('审查完成', 'success');
    }

    /**
     * 全部回退变更
     */
    async rejectAllChanges() {
        if (!confirm('确定要回退所有变更吗？这将恢复到修改前的状态。')) {
            return;
        }

        console.log('🔄 全部回退变更');

        // 优先使用保存的修改前内容
        let originalContent = this.contentBeforeLLMUpdate;

        // 如果没有保存的内容，从diffData中提取原始内容
        if (!originalContent && this.currentDiffData) {
            const originalLines = [];
            this.currentDiffData.forEach(line => {
                if (line.type === 'removed' || line.type === 'unchanged') {
                    originalLines.push(line.content);
                } else if (line.type === 'modified') {
                    originalLines.push(line.oldContent);
                }
                // added类型的行不包含在原始内容中
            });
            originalContent = originalLines.join('\n');
        }

        if (!originalContent) {
            this.uiManager.showNotification('无法找到原始内容', 'error');
            return;
        }

        // 保存回后端
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${this.activeNoteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: originalContent })
            });

            if (!response.ok) {
                throw new Error('回退失败');
            }

            // 更新编辑器
            const noteEditor = document.getElementById('noteEditor');
            if (noteEditor) {
                noteEditor.value = originalContent;
                this.activeNoteOriginalContent = originalContent;
            }

            // 隐藏回退按钮
            const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
            if (rejectAllChangesBtn) {
                rejectAllChangesBtn.classList.add('hidden');
            }

            // 清除保存的状态
            this.contentBeforeLLMUpdate = null;
            this.currentDiffData = null;

            this.uiManager.showNotification('已回退所有变更', 'success');
            this.closeDiffView();
        } catch (error) {
            console.error('回退失败:', error);
            this.uiManager.showNotification('回退失败: ' + error.message, 'error');
        }
    }

    /**
     * 将diff数据分组为变更块
     */
    groupDiffChanges(diffData) {
        const blocks = [];
        let currentBlock = null;

        diffData.forEach(line => {
            const isChange = line.type !== 'unchanged';

            if (isChange) {
                // 开始新的变更块或继续当前块
                if (!currentBlock) {
                    currentBlock = {
                        hasChanges: true,
                        lines: []
                    };
                }
                currentBlock.lines.push(line);
            } else {
                // 遇到unchanged行
                if (currentBlock) {
                    // 结束当前变更块
                    blocks.push(currentBlock);
                    currentBlock = null;
                }

                // 添加unchanged行到单独的块（不显示操作按钮）
                blocks.push({
                    hasChanges: false,
                    lines: [line]
                });
            }
        });

        // 处理最后一个块
        if (currentBlock) {
            blocks.push(currentBlock);
        }

        return blocks;
    }

    /**
     * 计算行内diff（高亮变更部分）
     * @param {string} oldText - 旧文本
     * @param {string} newText - 新文本
     * @param {boolean} showOnlyNew - 是否只显示新内容（用于绿色边框）
     */
    computeInlineDiff(oldText, newText, showOnlyNew = false) {
        if (typeof diff_match_patch === 'undefined') {
            console.warn('diff_match_patch未加载，使用简单对比');
            if (showOnlyNew) {
                return `<span class="text-gray-100">${escapeHtml(newText)}</span>`;
            }
            return `<span class="diff-removed-text">${escapeHtml(oldText)}</span> → <span class="diff-added-text">${escapeHtml(newText)}</span>`;
        }

        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(oldText, newText);
        dmp.diff_cleanupSemantic(diffs);

        let html = '';
        diffs.forEach(([type, text]) => {
            const escaped = escapeHtml(text);
            if (type === 1) { // 添加
                html += `<span class="inline-diff-added">${escaped}</span>`;
            } else if (type === -1) { // 删除
                // 如果只显示新内容，跳过删除部分
                if (!showOnlyNew) {
                    html += `<span class="inline-diff-removed">${escaped}</span>`;
                }
            } else { // 不变
                html += `<span class="text-gray-100">${escaped}</span>`;
            }
        });

        return html;
    }

    /**
     * 计算字符级diff，使用更深的颜色高亮差异部分
     * @param {string} oldText - 旧文本
     * @param {string} newText - 新文本
     * @param {string} mode - 'old' 显示旧版本（红色行），'new' 显示新版本（绿色行）
     */
    computeInlineDiffWithDeepHighlight(oldText, newText, mode = 'new') {
        // 防御性编程：确保输入不为 null 或 undefined
        const safeOldText = oldText || '';
        const safeNewText = newText || '';

        if (typeof diff_match_patch === 'undefined') {
            console.warn('diff_match_patch未加载，使用简单显示');
            const text = mode === 'old' ? safeOldText : safeNewText;
            const color = mode === 'old' ? 'text-red-300' : 'text-green-300';
            return `<span class="${color}">${escapeHtml(text)}</span>`;
        }

        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(safeOldText, safeNewText);
        dmp.diff_cleanupSemantic(diffs);

        let html = '';

        if (mode === 'old') {
            // 红色行：显示旧内容，用深红色背景高亮被删除的字符
            diffs.forEach(([type, text]) => {
                const escaped = escapeHtml(text);
                if (type === -1) {
                    // 被删除的字符：深红色背景 + 删除线 + 更亮的文字
                    html += `<span class="line-through" style="background-color: rgba(239, 68, 68, 0.5); color: #fecaca; font-weight: 700; text-shadow: 0 0 1px rgba(254, 202, 202, 0.5);">${escaped}</span>`;
                } else if (type === 0) {
                    // 不变的字符：更亮的红色
                    html += `<span style="color: #fca5a5;">${escaped}</span>`;
                }
                // type === 1 (新增) 在旧版本行中不显示
            });
        } else {
            // 绿色行：显示新内容，用深绿色背景高亮新增的字符
            diffs.forEach(([type, text]) => {
                const escaped = escapeHtml(text);
                if (type === 1) {
                    // 新增的字符：深绿色背景 + 加粗 + 更亮的文字
                    html += `<span style="background-color: rgba(34, 197, 94, 0.5); color: #bbf7d0; font-weight: 700; text-shadow: 0 0 1px rgba(187, 247, 208, 0.5);">${escaped}</span>`;
                } else if (type === 0) {
                    // 不变的字符：更亮的绿色
                    html += `<span style="color: #86efac;">${escaped}</span>`;
                }
                // type === -1 (删除) 在新版本行中不显示
            });
        }

        return html;
    }


    /**
     * 接受变更块
     */
    /**
     * 拒绝单行变更（回退修改）
     */
    async rejectLineChange(blockIndex, lineIndex) {
        console.log('❌ 回退行变更:', blockIndex, lineIndex);

        const inlineDiffContainer = document.getElementById('inlineDiffContainer');
        if (!inlineDiffContainer) return;

        const block = this.currentDiffBlocks[blockIndex];
        if (!block) return;

        const line = block.lines[lineIndex];
        if (!line) return;

        // 查找相关的DOM元素
        const allLines = inlineDiffContainer.querySelectorAll(`[data-block-index="${blockIndex}"][data-line-index="${lineIndex}"]`);
        const nextBtn = inlineDiffContainer.querySelector(`.diff-reject-change-btn[data-block="${blockIndex}"][data-line="${lineIndex}"]`);

        if (line.type === 'modified') {
            // 对于modified类型：保留旧行（红色变普通），移除新行（绿色），移除按钮
            allLines.forEach(lineDiv => {
                if (lineDiv.dataset.lineType === 'removed') {
                    // 红色旧行变为普通行
                    lineDiv.className = 'leading-6 py-1 px-3 bg-gray-800 bg-opacity-10';
                    lineDiv.innerHTML = `<span class="text-gray-300">${escapeHtml(line.oldContent)}</span>`;
                } else if (lineDiv.dataset.lineType === 'added') {
                    lineDiv.remove(); // 移除绿色新行
                }
            });
            if (nextBtn && nextBtn.parentElement) {
                nextBtn.parentElement.remove(); // 移除按钮组
            }
        } else if (line.type === 'removed') {
            // 查找下一行（added）
            const nextLineIndex = lineIndex + 1;
            const nextLine = block.lines[nextLineIndex];
            if (nextLine && nextLine.type === 'added') {
                // 保留removed行，移除added行，移除按钮
                const removedLine = inlineDiffContainer.querySelector(`[data-block-index="${blockIndex}"][data-line-index="${lineIndex}"][data-line-type="removed"]`);
                const addedLine = inlineDiffContainer.querySelector(`[data-block-index="${blockIndex}"][data-line-index="${nextLineIndex}"][data-line-type="added"]`);

                if (removedLine) {
                    removedLine.className = 'leading-6 py-1 px-3 bg-gray-800 bg-opacity-10';
                    removedLine.innerHTML = `<span class="text-gray-300">${escapeHtml(line.content)}</span>`;
                }
                if (addedLine) addedLine.remove();
                if (nextBtn && nextBtn.parentElement) {
                    nextBtn.parentElement.remove();
                }
            }
        }

        // 收集当前所有可见行，构建新内容
        await this.updateBackendFromInlineDiff();
    }

    /**
     * 从内联diff视图更新后端文件
     */
    async updateBackendFromInlineDiff() {
        const inlineDiffContainer = document.getElementById('inlineDiffContainer');
        if (!inlineDiffContainer) return;

        // 收集所有可见的行（跳过按钮行）
        const lines = [];
        inlineDiffContainer.querySelectorAll('[data-line-type]').forEach(lineDiv => {
            const lineText = lineDiv.textContent.trim();
            lines.push(lineText);
        });

        const newContent = lines.join('\n');

        // 更新编辑器
        const noteEditor = document.getElementById('noteEditor');
        if (noteEditor) {
            noteEditor.value = newContent;
        }

        // 保存到后端
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${this.activeNoteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: newContent })
            });

            if (!response.ok) {
                throw new Error('保存失败');
            }

            // 更新原始内容
            this.activeNoteOriginalContent = newContent;

            // 更新预览
            if (this.isEditorPreview) {
                this.updateEditorPreview();
            }

            this.uiManager.showNotification('已回退该变更', 'success');
        } catch (error) {
            console.error('回退失败:', error);
            this.uiManager.showNotification('回退失败: ' + error.message, 'error');
        }
    }

    /**
     * 接受内联diff块的变更
     */
    acceptInlineDiffBlock(blockIndex, changeBlocks) {
        console.log('✅ 接受变更块:', blockIndex);

        const blockDiv = document.querySelector(`.inline-diff-block[data-block-index="${blockIndex}"]`);
        if (!blockDiv) return;

        const block = changeBlocks[blockIndex];
        if (!block) return;

        // 更新header为已接受状态
        const header = blockDiv.querySelector('.flex.items-center');
        if (header) {
            header.innerHTML = `
                <span class="text-xs text-green-400 font-semibold">✓ 已接受变更</span>
            `;
            header.className = 'flex items-center justify-between px-3 py-2 bg-green-900 bg-opacity-30 border-l-4 border-green-500 mb-1';
        }

        // 移除所有removed行，保留added和modified的新内容
        const linesContainer = blockDiv.querySelector('.inline-diff-lines');
        if (linesContainer) {
            linesContainer.querySelectorAll('.inline-diff-line').forEach(lineDiv => {
                const lineType = lineDiv.dataset.lineType;
                if (lineType === 'removed') {
                    lineDiv.remove();
                } else if (lineType === 'modified' || lineType === 'added') {
                    // 清除diff样式，变为普通文本
                    lineDiv.className = 'inline-diff-line leading-6 px-2 bg-gray-800 bg-opacity-20';
                    const lineContent = lineDiv.textContent;
                    const lineNumber = lineDiv.querySelector('span').textContent;
                    lineDiv.innerHTML = `<span class="inline-block w-12 text-right pr-3 text-gray-400 select-none">${lineNumber}</span><span class="text-gray-200">${escapeHtml(lineContent.substring(lineNumber.length))}</span>`;
                }
            });
        }

        // 更新编辑器内容和预览
        this.updateEditorFromInlineDiff();
    }

    /**
     * 拒绝内联diff块的变更
     */
    rejectInlineDiffBlock(blockIndex, changeBlocks) {
        console.log('❌ 拒绝变更块:', blockIndex);

        const blockDiv = document.querySelector(`.inline-diff-block[data-block-index="${blockIndex}"]`);
        if (!blockDiv) return;

        const block = changeBlocks[blockIndex];
        if (!block) return;

        // 更新header为已拒绝状态
        const header = blockDiv.querySelector('.flex.items-center');
        if (header) {
            header.innerHTML = `
                <span class="text-xs text-red-400 font-semibold">✗ 已拒绝变更</span>
            `;
            header.className = 'flex items-center justify-between px-3 py-2 bg-red-900 bg-opacity-30 border-l-4 border-red-500 mb-1';
        }

        // 移除所有added和modified行，保留removed的原始内容
        const linesContainer = blockDiv.querySelector('.inline-diff-lines');
        if (linesContainer) {
            linesContainer.querySelectorAll('.inline-diff-line').forEach(lineDiv => {
                const lineType = lineDiv.dataset.lineType;
                if (lineType === 'added' || lineType === 'modified') {
                    lineDiv.remove();
                } else if (lineType === 'removed') {
                    // 清除删除样式，恢复为普通文本
                    lineDiv.className = 'inline-diff-line leading-6 px-2 bg-gray-800 bg-opacity-20';
                    const lineContent = lineDiv.textContent;
                    const lineNumber = block.lines.find(l => l.type === 'removed')?.oldLineNumber || '-';
                    lineDiv.innerHTML = `<span class="inline-block w-12 text-right pr-3 text-gray-400 select-none">${lineNumber}</span><span class="text-gray-200">${escapeHtml(lineContent.substring(2))}</span>`;
                }
            });
        }

        // 更新编辑器内容和预览
        this.updateEditorFromInlineDiff();
    }

    /**
     * 从内联diff视图更新编辑器内容
     */
    updateEditorFromInlineDiff() {
        const inlineDiffContainer = document.getElementById('inlineDiffContainer');
        if (!inlineDiffContainer) return;

        // 收集所有可见的行
        const lines = [];
        inlineDiffContainer.querySelectorAll('.inline-diff-line').forEach(lineDiv => {
            const lineText = lineDiv.textContent.trim();
            // 移除行号（前12个字符）
            const content = lineText.substring(lineText.indexOf(' ') + 1);
            lines.push(content);
        });

        const newContent = lines.join('\n');

        // 更新编辑器
        const noteEditor = document.getElementById('noteEditor');
        if (noteEditor) {
            noteEditor.value = newContent;
        }

        // 更新预览
        if (this.isEditorPreview) {
            this.updateEditorPreview();
        }
    }

    acceptDiffBlock(blockIndex, changeBlocks) {
        console.log('✅ 接受变更块:', blockIndex);

        const blockDiv = document.querySelector(`.diff-block[data-block-index="${blockIndex}"]`);
        if (!blockDiv) return;

        // 移除拒绝按钮，只保留已接受状态
        const header = blockDiv.querySelector('.diff-block-header');
        if (header) {
            header.innerHTML = `
                <div class="flex items-center justify-between px-3 py-1 bg-green-900 bg-opacity-30">
                    <span class="text-xs text-green-400 flex items-center gap-1">
                        <i data-lucide="check-circle" class="w-3 h-3"></i>
                        <span>已接受</span>
                    </span>
                </div>
            `;
        }

        // 移除删除的行，只保留添加/修改的行
        blockDiv.querySelectorAll('.diff-line').forEach(lineDiv => {
            if (lineDiv.dataset.lineType === 'removed') {
                lineDiv.remove();
            } else if (lineDiv.dataset.lineType === 'modified' || lineDiv.dataset.lineType === 'added') {
                // 转换为unchanged样式
                lineDiv.classList.remove('diff-modified', 'diff-add');
                lineDiv.classList.add('diff-unchanged');
            }
        });

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        this.uiManager.showNotification('已接受变更', 'success');
    }

    /**
     * 拒绝变更块
     */
    rejectDiffBlock(blockIndex, changeBlocks) {
        console.log('❌ 拒绝变更块:', blockIndex);

        const blockDiv = document.querySelector(`.diff-block[data-block-index="${blockIndex}"]`);
        if (!blockDiv) return;

        // 移除接受按钮，只保留已拒绝状态
        const header = blockDiv.querySelector('.diff-block-header');
        if (header) {
            header.innerHTML = `
                <div class="flex items-center justify-between px-3 py-1 bg-red-900 bg-opacity-30">
                    <span class="text-xs text-red-400 flex items-center gap-1">
                        <i data-lucide="x-circle" class="w-3 h-3"></i>
                        <span>已拒绝</span>
                    </span>
                </div>
            `;
        }

        // 移除添加/修改的行，只保留删除的行（但显示为unchanged）
        blockDiv.querySelectorAll('.diff-line').forEach(lineDiv => {
            if (lineDiv.dataset.lineType === 'added' || lineDiv.dataset.lineType === 'modified') {
                lineDiv.remove();
            } else if (lineDiv.dataset.lineType === 'removed') {
                // 转换为unchanged样式（恢复原始内容）
                lineDiv.classList.remove('diff-remove');
                lineDiv.classList.add('diff-unchanged');
            }
        });

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        this.uiManager.showNotification('已拒绝变更', 'info');
    }

    /**
     * 关闭Diff视图
     */
    closeDiffView() {
        const noteEditor = document.getElementById('noteEditor');
        const notePreview = document.getElementById('notePreview');
        const noteDiffViewer = document.getElementById('noteDiffViewer');
        const inlineDiffContainer = document.getElementById('inlineDiffContainer');

        // 隐藏旧的diff视图
        if (noteDiffViewer) noteDiffViewer.classList.add('hidden');

        // 隐藏内联diff容器
        if (inlineDiffContainer) inlineDiffContainer.classList.add('hidden');

        // 显示编辑器
        if (noteEditor) noteEditor.classList.remove('hidden');

        // 恢复预览状态
        if (this.isEditorPreview && notePreview) {
            notePreview.classList.remove('hidden');
        }

        // 恢复顶部按钮状态
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        const finishDiffReviewBtn = document.getElementById('finishDiffReviewBtn');
        const saveNoteBtn = document.getElementById('saveNoteBtn');
        const togglePreviewBtn = document.getElementById('togglePreviewBtn');

        if (rejectAllChangesBtn) rejectAllChangesBtn.classList.add('hidden');
        if (finishDiffReviewBtn) finishDiffReviewBtn.classList.add('hidden');
        if (saveNoteBtn) saveNoteBtn.classList.remove('hidden');
        if (togglePreviewBtn) togglePreviewBtn.classList.remove('hidden');
    }


    /**
     * 请求用户确认文件夹授权
     * @param {string} folderPath - 文件夹路径
     * @returns {Promise<boolean>} 是否授权
     */
    async requestFolderPermission(folderPath) {
        return new Promise((resolve) => {
            // 创建确认对话框
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modal.innerHTML = `
                <div class="bg-gray-800 rounded-lg p-6 max-w-md">
                    <h3 class="text-lg font-bold mb-3 flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-5 h-5 text-yellow-400"></i>
                        <span>文件修改授权</span>
                    </h3>
                    <p class="text-gray-300 mb-4">
                        Copilot尝试修改以下位置的文件：<br>
                        <code class="text-blue-400">${escapeHtml(folderPath || '根目录')}</code>
                    </p>
                    <div class="mb-4">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="rememberChoice" class="w-4 h-4">
                            <span class="text-sm text-gray-400">记住本次选择，不再询问此文件夹</span>
                        </label>
                    </div>
                    <div class="flex justify-end gap-2">
                        <button id="denyBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">
                            拒绝
                        </button>
                        <button id="allowBtn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded">
                            允许
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // 初始化图标
            if (window.lucide) {
                lucide.createIcons();
            }

            const allowBtn = modal.querySelector('#allowBtn');
            const denyBtn = modal.querySelector('#denyBtn');
            const rememberChoice = modal.querySelector('#rememberChoice');

            allowBtn.addEventListener('click', () => {
                const remember = rememberChoice.checked;
                if (remember) {
                    this.approvedFolders.add(folderPath);
                }
                document.body.removeChild(modal);
                resolve(true);
            });

            denyBtn.addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(false);
            });
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

    // ==================== 工作台模式 ====================
    async enterWorkspaceMode() {
        this.isWorkspaceMode = true;

        // 隐藏主应用容器
        document.getElementById('app').style.display = 'none';

        // 显示工作台容器
        const workspaceContainer = document.getElementById('workspace-container');
        workspaceContainer.style.display = 'block';

        // 动态导入 WorkspaceView
        const { WorkspaceView } = await import('./views/workspace/WorkspaceView.js');

        // 创建工作台视图
        this.workspaceView = new WorkspaceView('#workspace-container', this);
        await this.workspaceView.init();

        console.log('Entered workspace mode');
    }

    exitWorkspaceMode() {
        this.isWorkspaceMode = false;

        // 隐藏工作台容器
        const workspaceContainer = document.getElementById('workspace-container');
        workspaceContainer.style.display = 'none';
        workspaceContainer.innerHTML = ''; // 清空内容

        // 显示主应用容器
        document.getElementById('app').style.display = 'flex';

        // 销毁工作台视图
        this.workspaceView = null;

        console.log('Exited workspace mode');
    }

    get apiSettings() {
        return {
            endpoint: this.settings?.endpoint || this.settings?.apiEndpoint,
            apiKey: this.settings?.apiKey,
            model: this.settings?.model
        };
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