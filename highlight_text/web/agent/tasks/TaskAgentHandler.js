/**
 * TaskAgentHandler - 任务规划 Copilot
 * 负责与用户交互,智能规划任务,并协调与 WorkspaceView 的数据同步
 */
export class TaskAgentHandler {
    constructor(uiContainer, workspaceView, apiSettings) {
        this.container = uiContainer;
        this.workspaceView = workspaceView;
        this.apiSettings = apiSettings;

        // 任务规划队列
        this.planningQueue = [];
        this.currentTaskIndex = 0;

        // 会话历史
        this.conversationHistory = [];

        // UI 元素
        this.messagesContainer = null;
        this.inputArea = null;

        // 工具定义
        this.tools = [];

        // System Prompt
        this.systemPrompt = `你是一个高效的项目规划助理,专门帮助用户安排日程和管理任务。

**你的工具:**
- get_current_time: 获取当前准确时间
- list_tasks: 查看用户现有的任务安排(了解空闲时间)
- create_task: 创建一个新任务

**任务分类:**
为每个任务选择合适的类型,帮助用户更好地管理不同类别的事务:
- work: 工作相关任务(会议、项目、报告等) - 蓝色
- personal: 个人事务(锻炼、购物、娱乐等) - 绿色
- study: 学习任务(课程、阅读、培训等) - 橙色
- 如果无法确定类型,可以不指定(将使用默认黄色)

**核心规则:**
1. 当用户提出多个任务时,将它们分解成一个有序的**规划队列**
2. **一次只处理队列中的一项任务**
3. 为每个任务规划时:
   - 首先调用 list_tasks 获取最新的日程安排
   - 分析任务性质,判断任务类型(work/personal/study)
   - 分析空闲时间段
   - 选择合适的时间并调用 create_task(包含type参数)
   - 创建成功后,**暂停并等待用户确认**
4. 暂停时输出: "已为您安排【任务名】,您可以在日历上调整。确认后,我将继续安排下一项。"
5. 用户确认后,重新调用 list_tasks 获取最新状态(包含用户的调整),然后处理下一个任务

**示例流程:**
用户: "我下午要开会,晚上要写报告"
你: [内部规划队列: [{title: '下午开会', type: 'work'}, {title: '晚上写报告', type: 'work'}]]
你: [调用 list_tasks 查看空闲]
你: [为"下午开会"选择14:00-15:00, 调用 create_task(title='下午开会', type='work', dtstart=..., dtend=...)]
你: "已为您安排【下午开会】,您可以在日历上调整。确认后,我将继续安排下一项。"
[用户在UI上调整时间或点击"继续"]
你: [重新调用 list_tasks, 获取用户调整后的最新状态]
你: [为"晚上写报告"选择空闲时间, 调用 create_task(title='晚上写报告', type='work', dtstart=..., dtend=...)]
你: "已为您安排【晚上写报告】,所有任务已规划完成!"`;
    }

    async init() {
        this.buildUI();
        await this.loadTools();
        this.displayWelcomeMessage();
    }

    buildUI() {
        this.container.innerHTML = `
            <div class="task-agent-container" style="display: flex; flex-direction: column; height: 100%; background: #fff;">
                <div class="task-agent-header" style="padding: 16px; border-bottom: 1px solid #e0e0e0; background: #f5f5f5;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 600;">📋 Todo Copilot</h3>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">智能任务规划助手</p>
                </div>

                <div class="task-agent-messages" style="flex: 1; overflow-y: auto; padding: 16px;">
                    <!-- 消息将在这里显示 -->
                </div>

                <div class="task-agent-input" style="padding: 16px; border-top: 1px solid #e0e0e0; background: #fafafa;">
                    <textarea
                        placeholder="输入任务需求,如: 我今天下午要开3个会,晚上要准备明天的PPT..."
                        style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical; font-family: inherit;"
                    ></textarea>
                    <div style="margin-top: 8px; display: flex; gap: 8px;">
                        <button class="task-agent-send-btn" style="flex: 1; padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
                            发送
                        </button>
                        <button class="task-agent-clear-btn" style="padding: 8px 16px; background: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer;">
                            清空
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.messagesContainer = this.container.querySelector('.task-agent-messages');
        this.inputArea = this.container.querySelector('textarea');

        // 绑定事件
        this.container.querySelector('.task-agent-send-btn').addEventListener('click', () => this.handleUserInput());
        this.container.querySelector('.task-agent-clear-btn').addEventListener('click', () => this.clearConversation());

        this.inputArea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleUserInput();
            }
        });
    }

    async loadTools() {
        try {
            const response = await fetch('/agent/tasks/tools');
            const data = await response.json();
            this.tools = data.tools || [];
            console.log('Loaded task tools:', this.tools);
        } catch (error) {
            console.error('Failed to load task tools:', error);
        }
    }

    displayWelcomeMessage() {
        this.addMessage('assistant', '你好!我是你的任务规划助手。告诉我你的安排,我会帮你智能规划日程 📅');
    }

    addMessage(role, content, isHtml = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `task-agent-message task-agent-message-${role}`;
        messageDiv.style.cssText = `
            margin-bottom: 16px;
            padding: 12px;
            border-radius: 8px;
            ${role === 'user' ? 'background: #E3F2FD; margin-left: 20%; text-align: right;' : 'background: #F5F5F5; margin-right: 20%;'}
        `;

        if (isHtml) {
            messageDiv.innerHTML = content;
        } else {
            messageDiv.textContent = content;
        }

        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    async handleUserInput() {
        const userInput = this.inputArea.value.trim();
        if (!userInput) return;

        // 显示用户消息
        this.addMessage('user', userInput);
        this.inputArea.value = '';

        // 添加到会话历史
        this.conversationHistory.push({
            role: 'user',
            content: userInput
        });

        // 调用 LLM
        await this.processWithLLM();

        // 保存会话日志
        await this.saveConversationLog();
    }

    async processWithLLM() {
        try {
            // 构建消息
            const messages = [
                { role: 'system', content: this.systemPrompt },
                ...this.conversationHistory
            ];

            // 调用 LLM API
            const response = await fetch(this.apiSettings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiSettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.apiSettings.model,
                    messages: messages,
                    tools: this.tools.map(tool => ({
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.parameters
                        }
                    })),
                    tool_choice: 'auto'
                })
            });

            const data = await response.json();
            const assistantMessage = data.choices[0].message;

            // 检查是否有思考过程（thought字段）- 支持ReAct模式
            if (assistantMessage.thought) {
                this._renderTraceStep({
                    type: 'thought',
                    title: '思考',
                    content: assistantMessage.thought
                });
            }

            // 处理工具调用
            if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
                await this.handleToolCalls(assistantMessage.tool_calls, assistantMessage);
            } else if (assistantMessage.content) {
                // 纯文本响应
                this._renderTraceStep({
                    type: 'final',
                    title: '回复',
                    content: assistantMessage.content
                });

                this.conversationHistory.push({
                    role: 'assistant',
                    content: assistantMessage.content
                });

                // 检查是否需要显示"继续规划"按钮
                if (assistantMessage.content.includes('确认后') || assistantMessage.content.includes('继续安排')) {
                    this._showContinueButton();
                }
            }
        } catch (error) {
            console.error('LLM processing error:', error);
            this._renderTraceStep({
                type: 'error',
                title: '错误',
                content: `处理出错: ${error.message}`
            });
        }
    }

    async handleToolCalls(toolCalls, assistantMessage) {
        // 添加助手消息到历史(包含工具调用)
        this.conversationHistory.push(assistantMessage);

        const toolResults = [];

        for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            console.log(`Calling tool: ${toolName}`, toolArgs);

            // 渲染工具调用的行动步骤
            this._renderTraceStep({
                type: 'action',
                title: '执行工具',
                content: `工具: ${toolName}`,
                data: toolArgs
            });

            // 执行工具
            const result = await this.executeTool(toolName, toolArgs);

            // 渲染工具执行结果（观察）
            this._renderTraceStep({
                type: 'observation',
                title: '观察结果',
                content: result
            });

            toolResults.push({
                tool_call_id: toolCall.id,
                role: 'tool',
                name: toolName,
                content: result
            });

            // 如果是 create_task,更新 WorkspaceView
            if (toolName === 'create_task') {
                const resultData = JSON.parse(result);
                if (resultData.success) {
                    await this.workspaceView.loadAndSyncTasks();
                }
            }
        }

        // 将工具结果添加到历史
        this.conversationHistory.push(...toolResults);

        // 继续调用 LLM 处理工具结果
        await this.processWithLLM();
    }

    async executeTool(toolName, args) {
        try {
            const response = await fetch('/agent/tasks/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tool: toolName,
                    args: args
                })
            });

            const data = await response.json();

            if (data.success === false) {
                return JSON.stringify({ error: data.error || 'Tool execution failed' });
            }

            return typeof data === 'string' ? data : JSON.stringify(data);
        } catch (error) {
            console.error(`Tool execution error (${toolName}):`, error);
            return JSON.stringify({ error: error.message });
        }
    }

    _showContinueButton() {
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'text-align: center; margin: 16px 0;';
        buttonContainer.innerHTML = `
            <button class="continue-planning-btn" style="padding: 10px 24px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 14px;">
                ✅ 继续规划
            </button>
        `;

        this.messagesContainer.appendChild(buttonContainer);

        buttonContainer.querySelector('.continue-planning-btn').addEventListener('click', async () => {
            buttonContainer.remove();

            // 用户确认,继续规划
            this.conversationHistory.push({
                role: 'user',
                content: '继续'
            });

            await this.processWithLLM();
        });
    }

    /**
     * 渲染ReAct追踪步骤
     * @param {Object} options - 渲染选项
     * @param {string} options.type - 步骤类型: 'thought', 'action', 'observation', 'final', 'error'
     * @param {string} options.title - 步骤标题
     * @param {string} options.content - 步骤内容
     * @param {Object} [options.data] - 可选的额外数据（JSON对象）
     */
    _renderTraceStep({ type, title, content, data = null }) {
        const traceDiv = document.createElement('div');
        traceDiv.className = `trace-step trace-step-${type}`;

        let iconName = '';
        let bgColor = '';
        let borderColor = '';
        let iconColor = '';

        switch (type) {
            case 'thought':
                iconName = '🧠';
                bgColor = '#E3F2FD';
                borderColor = '#2196F3';
                iconColor = '#2196F3';
                break;
            case 'action':
                iconName = '⚡';
                bgColor = '#FFF9C4';
                borderColor = '#FFC107';
                iconColor = '#F57C00';
                break;
            case 'observation':
                iconName = '👁️';
                bgColor = '#E8F5E9';
                borderColor = '#4CAF50';
                iconColor = '#388E3C';
                break;
            case 'final':
                iconName = '✅';
                bgColor = '#F3E5F5';
                borderColor = '#9C27B0';
                iconColor = '#7B1FA2';
                break;
            case 'error':
                iconName = '❌';
                bgColor = '#FFEBEE';
                borderColor = '#F44336';
                iconColor = '#D32F2F';
                break;
            default:
                iconName = '📌';
                bgColor = '#F5F5F5';
                borderColor = '#9E9E9E';
                iconColor = '#616161';
        }

        traceDiv.style.cssText = `
            margin-bottom: 12px;
            padding: 12px;
            border-radius: 8px;
            background: ${bgColor};
            border-left: 4px solid ${borderColor};
        `;

        let html = `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span style="font-size: 18px;">${iconName}</span>
                <span style="font-weight: 600; color: ${iconColor}; font-size: 14px;">${title}</span>
            </div>
            <div style="font-size: 13px; color: #333; white-space: pre-wrap; line-height: 1.5;">
                ${this._escapeHtml(content)}
            </div>
        `;

        if (data) {
            html += `
                <details style="margin-top: 8px;">
                    <summary style="cursor: pointer; font-size: 12px; color: #666;">查看详情</summary>
                    <pre style="margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 11px; overflow-x: auto;">${this._escapeHtml(JSON.stringify(data, null, 2))}</pre>
                </details>
            `;
        }

        traceDiv.innerHTML = html;
        this.messagesContainer.appendChild(traceDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    /**
     * HTML转义工具函数
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clearConversation() {
        this.messagesContainer.innerHTML = '';
        this.conversationHistory = [];
        this.planningQueue = [];
        this.currentTaskIndex = 0;
        this.displayWelcomeMessage();
    }

    /**
     * 保存会话日志到后端
     */
    async saveConversationLog() {
        if (this.conversationHistory.length === 0) {
            return;
        }

        try {
            const logData = {
                timestamp: new Date().toISOString(),
                conversationHistory: this.conversationHistory,
                planningQueue: this.planningQueue,
                currentTaskIndex: this.currentTaskIndex
            };

            const response = await fetch('/agent/tasks/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(logData)
            });

            if (!response.ok) {
                console.error('Failed to save conversation log:', await response.text());
            } else {
                const result = await response.json();
                console.log('Conversation log saved:', result.filename);
            }
        } catch (error) {
            console.error('Error saving conversation log:', error);
        }
    }

    // 提供给 WorkspaceView 调用的方法
    async createSingleTask(title, dtstart, dtend) {
        const args = { title };
        if (dtstart) args.dtstart = dtstart;
        if (dtend) args.dtend = dtend;

        const result = await this.executeTool('create_task', args);
        const resultData = JSON.parse(result);

        if (resultData.success) {
            this.addMessage('assistant', `已创建任务: ${title}`);
            return resultData.task;
        } else {
            throw new Error(resultData.error || 'Failed to create task');
        }
    }
}
