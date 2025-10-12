import { DiffViewer } from './js/diff/DiffViewer.js';
import { escapeHtml, unescapeUnicodeChars } from './js/utils/helpers.js';
import { UIManager } from './js/core/UIManager.js';
import { SettingsManager } from './js/core/SettingsManager.js';
import { SessionManager } from './js/core/SessionManager.js';
import { NoteManager } from './js/notes/NoteManager.js';
import { ChatManager } from './js/core/ChatManager.js';

class AIAssistant {
    constructor() {
        this.config = null;
        this.settings = {};
        this.loadSettings();
        this.sessionManager = new SessionManager();
        this.sessions = []; // 保留引用以便其他代码使用
        this.activeSessionId = null; // 保留引用
        this.isSearchActive = false; // 是否正在搜索模式
        this.searchIndex = null; // 搜索索引（可选）
        this.isNodeAxisCollapsed = false; // 节点轴是否折叠
        this.isAgentMode = false; // 是否处于Agent模式

        // UI管理器
        this.uiManager = new UIManager();
        this.agentHandler = null; // Agent处理器
        this.chatManager = null; // 聊天管理器（延迟初始化）

        // 知识库相关
        this.viewMode = 'chat'; // 'chat' or 'editor'
        this.noteManager = null; // 笔记管理器（延迟初始化）
        this.knowledgeAgentHandler = null; // 知识库Copilot处理器
        this.approvedFolders = new Set(); // 已授权的文件夹路径集合
        this.shortcutManager = null; // 快捷键管理器

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

        // 初始化NoteManager
        this.noteManager = new NoteManager(this);
        this.noteManager.diffViewer = new DiffViewer(noteEditor);

        // 初始化ChatManager
        this.chatManager = new ChatManager(this);

        this.bindEvents();
        this.uiManager.loadThemePreference();
        this.checkUrlParams();
        this.loadSessions();
        this.noteManager.loadNotes(); // 加载笔记列表
        this.noteManager.initNotesWebSocket(); // 初始化WebSocket连接
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

    configureMarked() {
        if (typeof marked === 'undefined') return;

        // 创建自定义renderer
        const renderer = new marked.Renderer();

        // 自定义代码块渲染
        renderer.code = (code, infostring) => {
            // marked.js v4+ 传递的第一个参数可能是对象或字符串
            // 处理不同版本的marked.js
            let codeText, language;

            if (typeof code === 'object' && code !== null) {
                // marked.js v4+
                codeText = code.text || '';
                language = code.lang || infostring || 'text';
            } else {
                // marked.js v3 或更早版本
                codeText = code || '';
                language = infostring || 'text';
            }

            const codeId = 'code_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const cleanCode = codeText.trim();
            const escapedCode = escapeHtml(cleanCode);

            // 存储代码以便复制
            if (window.codeStorage) {
                window.codeStorage.set(codeId, cleanCode);
            }

            return `
                <div class="code-block relative bg-gray-800 rounded-lg mt-2 mb-2">
                    <div class="flex justify-between items-center px-4 py-2 bg-gray-700 rounded-t-lg">
                        <span class="text-sm text-gray-300 font-medium">${language || 'text'}</span>
                        <div class="flex space-x-2">
                            ${(language || '').toLowerCase() === 'html' ? `
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
                    <pre class="p-4 overflow-x-auto"><code class="language-${language || 'text'}">${escapedCode}</code></pre>
                </div>
            `;
        };

        // 配置 marked 选项
        marked.setOptions({
            breaks: true, // 支持GFM换行
            gfm: true, // 启用GitHub风格的Markdown
            tables: true, // 支持表格
            pedantic: false,
            sanitize: false, // 我们会手动处理HTML转义
            smartLists: true,
            smartypants: false,
            renderer: renderer // 使用自定义renderer
        });
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

    loadSessions() {
        const { sessions, activeSessionId } = this.sessionManager.loadSessions();
        this.sessions = sessions;  // 保留引用以便其他代码使用
        this.activeSessionId = activeSessionId;  // 保留引用

        this.renderSessionList();
        this.renderActiveSessionMessages();
        this.updateCurrentSessionTitle();

        // 检查并显示摘要
        const activeSession = this.sessionManager.getActiveSession();
        if (activeSession && activeSession.summary) {
            this.showSummary(activeSession.summary);
        }

        // 更新Token用量
        this.updateTokenUsage();

        // 渲染节点轴
        this.renderNodeAxis();
    }

    saveSessions() {
        this.sessionManager.saveSessions();
    }

    // 会话管理方法
    createNewSession(title = null, isDefault = false) {
        const { session, isDefault: isDefaultSession } = this.sessionManager.createNewSession(title, isDefault);

        // 更新本地引用
        this.sessions = this.sessionManager.getAllSessions();
        this.activeSessionId = this.sessionManager.getActiveSessionId();

        if (!isDefault) {
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

        return session;
    }

    switchSession(sessionId) {
        this.sessionManager.switchSession(sessionId);
        this.activeSessionId = sessionId;  // 同步引用

        this.renderActiveSessionMessages();
        this.renderSessionList(); // 更新选中状态
        this.updateCurrentSessionTitle();

        // 退出搜索模式
        this.exitSearchMode();

        // 检查并显示摘要
        const activeSession = this.sessionManager.getActiveSession();
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
        return this.sessionManager.getActiveSession();
    }

    updateSessionTitle(sessionId, newTitle) {
        this.sessionManager.updateSessionTitle(sessionId, newTitle);
        this.renderSessionList();
        this.updateCurrentSessionTitle();
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
        this.sessionManager.addTokensToCurrentSession(tokenCount);
    }

    updateTokenUsage() {
        if (!this.config || !this.config.apiSettings) {
            return;
        }

        const maxTokens = this.config.apiSettings.maxContextTokens || 20000;
        const tokenData = this.sessionManager.calculateTokenUsage(maxTokens);

        this.uiManager.updateTokenUsage(tokenData);
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
            this.sessionManager.saveContextSummary(summary);

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
        this.uiManager.showSummary(summary);
    }

    hideSummary() {
        this.uiManager.hideSummary();
    }

    generateSessionTitle(firstMessage) {
        return this.sessionManager.generateSessionTitle(firstMessage);
    }


    deleteSession(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            return;
        }

        // 确认删除
        if (!confirm(`确定要删除会话"${session.title}"吗？此操作不可撤销。`)) {
            return;
        }

        const result = this.sessionManager.deleteSession(sessionId);

        if (!result.success) {
            this.uiManager.showNotification(result.message, 'error');
            return;
        }

        // 更新本地引用
        this.sessions = this.sessionManager.getAllSessions();
        this.activeSessionId = this.sessionManager.getActiveSessionId();

        // 如果需要更新UI
        if (result.shouldUpdateUI) {
            this.renderActiveSessionMessages();
            this.updateCurrentSessionTitle();
        }

        this.renderSessionList();
        this.uiManager.showNotification(result.message, 'success');
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
            () => this.uiManager.renderCollapsedSessionList(
                this.sessions,
                this.activeSessionId,
                (id) => this.switchSession(id),
                (id) => this.deleteSession(id)
            ),
            () => this.exitSearchMode(),
            () => this.renderSessionList()
        );
    }

    // 渲染折叠状态下的会话图标列表
    // 重写renderSessionList方法，考虑折叠状态
    renderSessionList() {
        this.uiManager.renderSessionList(
            this.sessions,
            this.activeSessionId,
            (id) => this.switchSession(id),
            (id) => this.deleteSession(id)
        );
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
                this.chatManager.renderAgentMessage(msg, currentAgentContainer, index);

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

                const messageEl = this.chatManager.addMessage(textContent, 'user', false, msg.imageUrl);
                messageEl.setAttribute('data-message-index', index);
            } else if (msg.role === 'assistant') {
                // 结束当前Agent气泡（如果有）
                currentAgentBubble = null;
                currentAgentContainer = null;

                const messageEl = this.chatManager.addMessage(msg.content, 'ai', false);
                messageEl.setAttribute('data-message-index', index);
            }
        });

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        // 绑定代码块按钮事件
        if (this.chatManager) {
            this.chatManager.addCopyButtons();
        }
    }

    bindEvents() {
        // 聊天表单提交
        document.getElementById('chatForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.chatManager.sendMessage();
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
            this.chatManager.handleInputChange(e.target.value);
        });

        messageInput.addEventListener('focus', () => {
            if (messageInput.value.trim()) {
                this.chatManager.showInputShortcuts();
            }
        });

        messageInput.addEventListener('blur', () => {
            // 延迟隐藏，以允许点击快捷按钮
            setTimeout(() => {
                this.chatManager.hideInputShortcuts();
            }, 200);
        });

        // 图片上传相关事件
        document.getElementById('uploadImageBtn').addEventListener('click', () => {
            document.getElementById('imageUploadInput').click();
        });

        document.getElementById('imageUploadInput').addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.chatManager.handleImageSelection(e.target.files[0]);
            }
        });

        document.getElementById('removeImageBtn').addEventListener('click', () => {
            this.chatManager.removeImage();
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
                            this.chatManager.handleImageSelection(file);
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
                    this.chatManager.handleImageSelection(file);
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
                this.uiManager.hideTooltip();
            }
        });

        // 滚动时隐藏tooltip
        document.getElementById('chatContainer').addEventListener('scroll', () => {
            this.uiManager.hideTooltip();
        });

        // ====== 知识库相关事件 ======

        // 返回聊天按钮
        const backToChatBtn = document.getElementById('backToChatBtn');
        if (backToChatBtn) {
            backToChatBtn.addEventListener('click', () => {
                this.noteManager.switchToChatMode();
            });
        }

        // 保存笔记按钮
        const saveNoteBtn = document.getElementById('saveNoteBtn');
        if (saveNoteBtn) {
            saveNoteBtn.addEventListener('click', () => {
                this.noteManager.saveActiveNote();
            });
        }

        // 全部回退按钮
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        if (rejectAllChangesBtn) {
            rejectAllChangesBtn.addEventListener('click', () => {
                this.noteManager.rejectAllChanges();
            });
        }

        // 完成审查按钮
        const finishDiffReviewBtn = document.getElementById('finishDiffReviewBtn');
        if (finishDiffReviewBtn) {
            finishDiffReviewBtn.addEventListener('click', () => {
                this.noteManager.finishDiffReview();
            });
        }

        // 新建笔记按钮
        const newNoteBtn = document.getElementById('newNoteBtn');
        if (newNoteBtn) {
            newNoteBtn.addEventListener('click', () => {
                this.noteManager.createNewNote();
            });
        }

        // 新建文件夹按钮
        const newFolderBtn = document.getElementById('newFolderBtn');
        if (newFolderBtn) {
            newFolderBtn.addEventListener('click', () => {
                this.noteManager.createNewFolder();
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
                this.noteManager.sendCopilotMessage();
            });
        }

        if (copilotInput) {
            copilotInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.noteManager.sendCopilotMessage();
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
                this.noteManager.toggleEditorPreview();
            });
        }

        // Diff视图关闭按钮
        const closeDiffViewBtn = document.getElementById('closeDiffViewBtn');
        if (closeDiffViewBtn) {
            closeDiffViewBtn.addEventListener('click', () => {
                this.noteManager.closeDiffView();
            });
        }

        // Diff视图取消按钮
        const cancelDiffBtn = document.getElementById('cancelDiffBtn');
        if (cancelDiffBtn) {
            cancelDiffBtn.addEventListener('click', () => {
                this.noteManager.closeDiffView();
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
                this.noteManager.showContextMenu(e);
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
                        this.noteManager.moveNoteOrFolder(sourcePath, '');
                    }
                }
            });
        }

        // 编辑器输入事件 - 实时更新预览 + 自动保存
        const noteEditor = document.getElementById('noteEditor');
        if (noteEditor) {
            noteEditor.addEventListener('input', () => {
                // 实时更新预览（防抖500ms）
                if (this.noteManager.isEditorPreview) {
                    clearTimeout(this.noteManager.previewDebounceTimeout);
                    this.noteManager.previewDebounceTimeout = setTimeout(() => {
                        this.noteManager.updateEditorPreview();
                    }, 500);
                }

                // 自动保存（防抖5秒）
                clearTimeout(this.noteManager.autoSaveTimeout);
                this.noteManager.autoSaveTimeout = setTimeout(() => {
                    this.noteManager.saveActiveNote();
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
                this.noteManager.handleEditorImageDrop(e);
            });

            // 编辑器右键划词功能
            noteEditor.addEventListener('contextmenu', (e) => {
                console.log('🖱️ noteEditor右键事件触发');
                console.log('  - 事件目标:', e.target);
                console.log('  - 事件目标ID:', e.target.id);
                console.log('  - editorInstance:', this.noteManager.editorInstance);

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
                this.noteManager.handleEditorPaste(e);
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
                    this.noteManager.handleWikiLinkClick(noteId);
                }
                return;
            }

            // 标签点击
            const tagLink = e.target.closest('.tag-link');
            if (tagLink) {
                e.preventDefault();
                const tag = tagLink.getAttribute('data-tag');
                if (tag) {
                    this.noteManager.handleTagClick(tag);
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
                    this.noteManager.addCopilotContextFile(actualPath);
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
                this.chatManager.sendMessage();
            }, 500);
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


    // 渲染节点轴
    renderNodeAxis() {
        const activeSession = this.getActiveSession();
        const messages = activeSession ? activeSession.messages : [];
        this.uiManager.renderNodeAxis(messages);
    }

    // 切换节点轴折叠状态
    toggleNodeAxis() {
        this.isNodeAxisCollapsed = !this.isNodeAxisCollapsed;
        this.uiManager.toggleNodeAxis(this.isNodeAxisCollapsed);
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
        const modal = this.chatManager.createFollowupModal();
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
                        <div class="mt-2">${this.chatManager.formatMessage(followup.answer)}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        contentElement.innerHTML = html;
        this.chatManager.addCopyButtons();

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

    // ==================== 划词追问相关方法 ====================

    toggleAgentMode() {
        this.isAgentMode = !this.isAgentMode;
        const btn = document.getElementById('agentModeBtn');
        if (this.isAgentMode) {
            btn.classList.add('active-agent-mode');
            this.uiManager.showNotification('Agent模式已启用', 'success');
        } else {
            btn.classList.remove('active-agent-mode');
            this.uiManager.showNotification('Agent模式已关闭', 'info');
        }
    }

    handleTextSelection(e) {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText && selectedText.length > 0) {
            // 检查选中的是否在消息气泡内
            const messageElement = e.target.closest('.ai-message');
            if (messageElement && this.config && this.config.commands) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // 显示tooltip
                this.uiManager.showTooltip(
                    rect.left + rect.width / 2,
                    rect.top - 10,
                    selectedText,
                    messageElement,
                    this.config.commands,
                    (text, command, element) => this.chatManager.handleFollowup(text, command, element)
                );
            }
        }
    }

    handleEditorContextMenu(e, selectedText) {
        if (!this.config || !this.config.commands) return;

        const noteEditor = document.getElementById('noteEditor');
        const rect = noteEditor.getBoundingClientRect();

        // 显示tooltip
        this.uiManager.showTooltip(
            e.clientX,
            e.clientY - 10,
            selectedText,
            noteEditor,
            this.config.commands,
            (text, command, element) => this.chatManager.handleFollowup(text, command, element)
        );
    }

    handlePreviewContextMenu(e) {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText && selectedText.length > 0) {
            e.preventDefault();

            if (!this.config || !this.config.commands) return;

            const notePreview = document.getElementById('notePreview');
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            // 显示tooltip
            this.uiManager.showTooltip(
                rect.left + rect.width / 2,
                rect.top - 10,
                selectedText,
                notePreview,
                this.config.commands,
                (text, command, element) => this.chatManager.handleFollowup(text, command, element)
            );
        }
    }

    confirmDiffSave() {
        // 这个方法应该在 NoteManager 中
        this.noteManager.finishDiffReview();
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