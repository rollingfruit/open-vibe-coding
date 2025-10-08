/**
 * TaskAgentHandler - 任务规划 Copilot
 * 负责与用户交互,智能规划任务,并协调与 WorkspaceView 的数据同步
 */
/**
 * TaskAgentHandler - 任务规划 Copilot
 * 负责与用户交互,智能规划任务,并协调与 WorkspaceView 的数据同步
 */
export class TaskAgentHandler {
    constructor(uiContainer, workspaceView, app) {
        this.container = uiContainer;
        this.workspaceView = workspaceView;
        this.app = app;

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
        this.systemPrompt = this._generateSystemPrompt(this.app.settings.categories);
    }

    _generateSystemPrompt(categories) {
        const categoryDescriptions = categories.map(cat => 
            `- ${cat.name}: ${cat.id} - ${cat.color}`
        ).join('\n');

        return `你是一个高效的任务规划助理,专门帮助用户安排日程和管理任务。

**你的工具:**
- get_current_time: 获取当前准确时间
- list_tasks: 查看用户现有的任务安排(了解空闲时间)。支持 projects_only 参数获取所有项目列表
- create_task: 创建一个新任务(支持 status: 'preview' 参数)

**任务分类:**
为每个任务选择合适的类型,帮助用户更好地管理不同类别的事务:
${categoryDescriptions}
- 如果无法确定类型,可以不指定(将使用默认分类)

**核心规则 - 批量规划模式:**
1. 当用户提出多个任务时,**一次性完成所有任务的时间规划**,不要逐个暂停等待确认
2. 规划步骤:
   - **首先**,必须调用 list_tasks({ projects_only: true }) 获取当前所有已存在的项目列表
   - 调用 list_tasks 获取当前的日程安排(了解空闲时间)
   - 分析所有任务的性质,判断任务类型
   - **任务归属判断**: 判断每个任务是否与获取到的项目列表中的某一个相关
     * 如果任务属于某个已存在的项目,调用 create_task 时必须附加该项目的 id 作为 parent_id
     * 如果任务不属于任何已存在的项目,则创建为顶级任务(即不设置 parent_id)
   - 为每个任务选择合适的时间段
   - **批量调用 create_task,每个任务都附加 status: 'preview' 参数**
3. **重要: 你不能创建项目**
   - 项目只能由用户自己创建
   - 你的职责是将用户请求的任务归属到已存在的项目中
   - 不要尝试创建父项目任务或项目层级结构
   - 只创建任务,并在合适时使用 parent_id 关联到已存在的项目
4. 所有任务创建完成后,输出一个清晰的任务列表总结,**强调目标导向**:
   "✅ 好的!为了助您达成这些目标,我已规划了以下行动项:
   1. 【任务名】- 关联目标: '{项目名}' - 时间段
   2. 【任务名】- 关联目标: 无 - 时间段
   ...

   这些任务已在日历上以预览模式显示(半透明状态),您可以直接在视图中拖拽调整时间。确认无误后,点击下方的'全部采纳'按钮。"

5. **独立任务的引导话术**: 如果AI创建了一个不属于任何项目的独立任务,追加一句引导性话术:
   "这个任务是为了实现某个更大的目标吗?您可以将它关联到一个已设定的目标上,让行动更有方向。"

**预览模式说明:**
- 使用 status: 'preview' 创建的任务会在UI上以半透明、虚线边框显示
- 用户可以在日历和甘特图上拖拽调整预览任务的时间
- 用户点击"全部采纳"后,所有预览任务会自动转为 pending 状态

**示例流程:**
用户: "帮我安排下午开会讨论营销文案,明天上午进行新功能A的代码审查"
你: [调用 list_tasks({ projects_only: true }) 获取项目列表]
你: [假设获取到 "2025年Q4营销活动" 和 "新功能A开发" 两个项目]
你: [调用 list_tasks 查看空闲时间]
你: [识别"营销文案会议"属于"2025年Q4营销活动"项目,"代码审查"属于"新功能A开发"项目]
你: [调用 create_task(title='下午营销文案会议', type='work', parent_id='<2025年Q4营销活动的ID>', status='preview', dtstart='...', dtend='...') ]
你: [调用 create_task(title='明天上午代码审查', type='work', parent_id='<新功能A开发的ID>', status='preview', dtstart='...', dtend='...') ]
你: "✅ 好的!为了助您达成这些目标,我已规划了以下行动项:
1. 【下午营销文案会议】- 关联目标: '2025年Q4营销活动' - 今天 14:00-15:00
2. 【明天上午代码审查】- 关联目标: '新功能A开发' - 明天 09:00-11:00

这些任务已在日历上以预览模式显示,您可以直接拖拽调整。确认无误后,点击'全部采纳'按钮。"

`
    }

    updateCategories(newCategories) {
        this.systemPrompt = this._generateSystemPrompt(newCategories);
        console.log('TaskAgentHandler system prompt updated with new categories.');
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
            const response = await fetch(this.app.apiSettings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.app.apiSettings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.app.apiSettings.model,
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
            console.log('LLM响应数据:', data);
            const assistantMessage = data.choices[0].message;
            console.log('助手消息:', assistantMessage);

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

                // 检查是否需要显示"全部采纳"按钮(批量规划模式)
                if (assistantMessage.content.includes('全部采纳') || assistantMessage.content.includes('预览模式')) {
                    this._showApproveAllButton();
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

    _showApproveAllButton() {
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'text-align: center; margin: 16px 0;';
        buttonContainer.innerHTML = `
            <button class="approve-all-btn" style="padding: 12px 32px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);">
                ✅ 全部采纳
            </button>
        `;

        this.messagesContainer.appendChild(buttonContainer);

        buttonContainer.querySelector('.approve-all-btn').addEventListener('click', async () => {
            buttonContainer.remove();

            try {
                // 将所有 preview 状态的任务更新为 pending 状态
                await this.approveAllPreviewTasks();

                this._renderTraceStep({
                    type: 'final',
                    title: '成功',
                    content: '✅ 所有任务已采纳并正式创建!'
                });

                // 刷新视图
                await this.workspaceView.loadAndSyncTasks();
            } catch (error) {
                this._renderTraceStep({
                    type: 'error',
                    title: '错误',
                    content: `采纳任务失败: ${error.message}`
                });
            }
        });
    }

    async approveAllPreviewTasks() {
        // 获取所有 preview 状态的任务
        const result = await fetch('/agent/tasks/execute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tool: 'list_tasks',
                args: { status: 'preview' }
            })
        });

        const data = await result.json();
        // data 已经是字符串,需要解析一次
        const previewTasks = typeof data === 'string' ? JSON.parse(data) : data;

        // 批量更新所有预览任务为 pending 状态
        const updatePromises = previewTasks.map(task =>
            fetch('/agent/tasks/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tool: 'update_task',
                    args: {
                        task_id: task.id,
                        updates: { status: 'pending' }
                    }
                })
            })
        );

        await Promise.all(updatePromises);
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
