/**
 * 会话管理器
 * 负责会话的增、删、改、查和本地存储
 * 从 app.js 重构提取
 */

export class SessionManager {
    constructor() {
        this.sessions = [];
        this.activeSessionId = null;
    }

    /**
     * 从localStorage加载会话
     * @returns {Object} 返回 {sessions, activeSessionId}
     */
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

        return {
            sessions: this.sessions,
            activeSessionId: this.activeSessionId
        };
    }

    /**
     * 保存会话到localStorage
     */
    saveSessions() {
        localStorage.setItem('aiAssistantSessions', JSON.stringify(this.sessions));
    }

    /**
     * 创建新会话
     * @param {string} title - 会话标题
     * @param {boolean} isDefault - 是否是默认会话（不触发通知）
     * @returns {Object} 新创建的会话对象
     */
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
        }

        return {
            session: newSession,
            isDefault: isDefault
        };
    }

    /**
     * 切换会话
     * @param {string} sessionId - 要切换到的会话ID
     * @returns {Object} 新的活动会话
     */
    switchSession(sessionId) {
        this.activeSessionId = sessionId;
        const activeSession = this.getActiveSession();
        return activeSession;
    }

    /**
     * 获取当前活动会话
     * @returns {Object} 当前活动的会话对象
     */
    getActiveSession() {
        return this.sessions.find(session => session.id === this.activeSessionId);
    }

    /**
     * 更新会话标题
     * @param {string} sessionId - 会话ID
     * @param {string} newTitle - 新标题
     */
    updateSessionTitle(sessionId, newTitle) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.title = newTitle;
            session.updatedAt = new Date().toISOString();
            this.saveSessions();
        }
    }

    /**
     * 删除会话
     * @param {string} sessionId - 要删除的会话ID
     * @returns {Object} {success: boolean, message: string, newActiveSessionId: string}
     */
    deleteSession(sessionId) {
        // 防止删除最后一个会话
        if (this.sessions.length <= 1) {
            return {
                success: false,
                message: '至少需要保留一个会话'
            };
        }

        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            return {
                success: false,
                message: '会话不存在'
            };
        }

        // 从数组中移除会话
        this.sessions = this.sessions.filter(s => s.id !== sessionId);

        let newActiveSessionId = this.activeSessionId;

        // 如果删除的是当前活动会话，切换到最新的会话
        if (this.activeSessionId === sessionId) {
            if (this.sessions.length > 0) {
                newActiveSessionId = this.sessions[this.sessions.length - 1].id;
                this.activeSessionId = newActiveSessionId;
            }
        }

        // 保存更新
        this.saveSessions();

        return {
            success: true,
            message: '会话已删除',
            newActiveSessionId: newActiveSessionId,
            shouldUpdateUI: this.activeSessionId === sessionId
        };
    }

    /**
     * 添加token到当前会话
     * @param {number} tokenCount - 要添加的token数量
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

    /**
     * 计算当前会话的token使用情况
     * @param {number} maxTokens - 最大token数
     * @returns {Object} {currentTokens, maxTokens, hasSummary, percentage}
     */
    calculateTokenUsage(maxTokens) {
        const activeSession = this.getActiveSession();
        if (!activeSession) {
            return {
                currentTokens: 0,
                maxTokens: maxTokens,
                hasSummary: false,
                percentage: 0
            };
        }

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

        return {
            currentTokens: currentTokens,
            maxTokens: maxTokens,
            hasSummary: !!activeSession.summary,
            percentage: percentage
        };
    }

    /**
     * 保存上下文压缩摘要
     * @param {string} summary - 摘要内容
     */
    saveContextSummary(summary) {
        const activeSession = this.getActiveSession();
        if (activeSession) {
            activeSession.summary = summary;
            activeSession.summarySplitIndex = activeSession.messages.length;
            activeSession.updatedAt = new Date().toISOString();
            this.saveSessions();
        }
    }

    /**
     * 从第一条消息生成会话标题
     * @param {string} firstMessage - 第一条消息内容
     * @returns {string} 生成的标题
     */
    generateSessionTitle(firstMessage) {
        if (!firstMessage) return '新对话';

        const truncated = firstMessage.length > 20 ?
            firstMessage.substring(0, 20) + '...' :
            firstMessage;

        return truncated;
    }

    /**
     * 获取所有会话
     * @returns {Array} 会话数组
     */
    getAllSessions() {
        return this.sessions;
    }

    /**
     * 获取当前活动会话ID
     * @returns {string} 活动会话ID
     */
    getActiveSessionId() {
        return this.activeSessionId;
    }

    /**
     * 设置活动会话ID
     * @param {string} sessionId - 会话ID
     */
    setActiveSessionId(sessionId) {
        this.activeSessionId = sessionId;
    }

    /**
     * 更新会话的更新时间
     */
    updateActiveSessionTimestamp() {
        const activeSession = this.getActiveSession();
        if (activeSession) {
            activeSession.updatedAt = new Date().toISOString();
        }
    }
}
