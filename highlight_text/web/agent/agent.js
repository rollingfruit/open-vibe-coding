/**
 * Agent模式处理器
 * 实现ReAct循环和工具调用
 */
class AgentHandler {
    constructor(mainApp) {
        this.mainApp = mainApp;
        this.sessionId = null;
        this.isActive = false;
        this.maxIterations = 10; // 防止无限循环
        this.availableTools = [];
        this.conversationHistory = [];
        this.initialDirectory = null; // 初始工作目录
        this.logEntries = []; // 日志条目
        this.logFileName = null; // 日志文件名
    }

    /**
     * 生成唯一的会话ID
     */
    generateSessionId() {
        return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取可用工具列表
     */
    async fetchAvailableTools() {
        try {
            const response = await fetch('http://localhost:8080/agent/tools');
            const data = await response.json();
            this.availableTools = data.tools;
            return this.availableTools;
        } catch (error) {
            console.error('获取工具列表失败:', error);
            return [];
        }
    }

    /**
     * 向后端发送工具执行请求
     */
    async executeToolOnBackend(toolName, args, userConfirmed = false) {
        try {
            const response = await fetch('http://localhost:8080/agent/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    tool: toolName,
                    args: args,
                    action: 'execute',
                    user_confirmed: userConfirmed,
                    initial_directory: this.initialDirectory
                })
            });

            const result = await response.json();

            // 保存初始目录
            if (result.initial_directory && !this.initialDirectory) {
                this.initialDirectory = result.initial_directory;
            }

            return result;
        } catch (error) {
            console.error('执行工具失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 请求用户确认
     */
    async requestUserConfirmation(message) {
        return new Promise((resolve) => {
            // 创建确认对话框
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modal.innerHTML = `
                <div class="bg-gray-800 rounded-lg p-6 max-w-md mx-4 border border-yellow-500">
                    <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-yellow-400">
                        <i data-lucide="alert-triangle" class="w-5 h-5"></i>
                        <span>需要确认的操作</span>
                    </h3>
                    <p class="text-gray-200 mb-6">${this.escapeHtml(message)}</p>
                    <div class="flex justify-end gap-3">
                        <button id="agentConfirmCancel" class="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded">取消</button>
                        <button id="agentConfirmOk" class="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded">确认执行</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // 初始化图标
            if (window.lucide) {
                lucide.createIcons();
            }

            document.getElementById('agentConfirmOk').onclick = () => {
                document.body.removeChild(modal);
                resolve(true);
            };

            document.getElementById('agentConfirmCancel').onclick = () => {
                document.body.removeChild(modal);
                resolve(false);
            };
        });
    }

    /**
     * 添加日志条目
     */
    addLogEntry(type, content, data = null) {
        const entry = {
            timestamp: new Date().toISOString(),
            type: type,
            content: content,
            data: data
        };
        this.logEntries.push(entry);
    }

    /**
     * 保存日志到后端
     */
    async saveLogToFile() {
        if (this.logEntries.length === 0) return;

        const logData = {
            session_id: this.sessionId,
            start_time: this.logEntries[0]?.timestamp,
            end_time: this.logEntries[this.logEntries.length - 1]?.timestamp,
            entries: this.logEntries
        };

        try {
            const response = await fetch('http://localhost:8080/agent/save-log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(logData)
            });

            if (response.ok) {
                const result = await response.json();
                this.mainApp.showNotification(`日志已保存: ${result.filename}`, 'success');
            } else {
                console.error('保存日志失败');
            }
        } catch (error) {
            console.error('保存日志出错:', error);
        }
    }

    /**
     * 关闭Agent会话
     */
    async closeSession() {
        if (!this.sessionId) return;

        try {
            await fetch('http://localhost:8080/agent/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    action: 'close'
                })
            });
        } catch (error) {
            console.error('关闭会话失败:', error);
        }

        // 保存日志
        await this.saveLogToFile();

        this.sessionId = null;
        this.isActive = false;
        this.conversationHistory = [];
        this.initialDirectory = null;
        this.logEntries = [];
        this.logFileName = null;
    }

    /**
     * 创建Agent消息气泡
     */
    createAgentMessageBubble() {
        const messagesContainer = document.getElementById('messages');
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble ai-message animate__animated animate__fadeInUp agent-message-bubble';
        bubble.id = `agent-trace-${this.sessionId}`;
        bubble.innerHTML = `
            <div class="mb-2 flex items-center gap-2">
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 8V4H8'/%3E%3Crect width='16' height='12' x='4' y='8' rx='2'/%3E%3Cpath d='M2 14h2'/%3E%3Cpath d='M20 14h2'/%3E%3Cpath d='M15 13v2'/%3E%3Cpath d='M9 13v2'/%3E%3C/svg%3E" class="w-6 h-6" alt="AI">
                <span class="text-green-400 font-semibold">Agent执行过程</span>
                <span class="text-gray-400 text-sm ml-2">实时追踪</span>
            </div>
            <div class="message-content agent-trace-content">
                <!-- Agent追踪步骤将在这里动态添加 -->
            </div>
        `;
        messagesContainer.appendChild(bubble);

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        // 滚动到底部
        const chatContainer = document.getElementById('chatContainer');
        chatContainer.scrollTop = chatContainer.scrollHeight;

        return bubble;
    }

    /**
     * 获取当前Agent消息气泡
     */
    getCurrentAgentBubble() {
        return document.getElementById(`agent-trace-${this.sessionId}`);
    }

    /**
     * 添加追踪步骤到UI
     */
    addTraceStep(type, content, data = null) {
        const bubble = this.getCurrentAgentBubble();
        if (!bubble) return;

        const container = bubble.querySelector('.agent-trace-content');

        const stepDiv = document.createElement('div');
        stepDiv.className = 'agent-trace-step border rounded-lg p-3 mb-2';
        stepDiv.dataset.stepType = type; // 记录步骤类型，用于节点轴

        let iconName = 'circle';
        let titleColor = 'text-gray-400';
        let title = type;

        switch (type) {
            case 'thought':
                iconName = 'brain';
                titleColor = 'text-blue-400';
                title = '思考';
                stepDiv.classList.add('bg-blue-900', 'bg-opacity-20', 'border-blue-500');
                break;
            case 'action':
                iconName = 'zap';
                titleColor = 'text-yellow-400';
                title = '执行工具';
                stepDiv.classList.add('bg-yellow-900', 'bg-opacity-20', 'border-yellow-500');
                break;
            case 'observation':
                iconName = 'eye';
                titleColor = 'text-green-400';
                title = '观察结果';
                stepDiv.classList.add('bg-green-900', 'bg-opacity-20', 'border-green-500');
                break;
            case 'error':
                iconName = 'alert-circle';
                titleColor = 'text-red-400';
                title = '错误';
                stepDiv.classList.add('bg-red-900', 'bg-opacity-20', 'border-red-500');
                break;
            case 'final':
                iconName = 'check-circle';
                titleColor = 'text-purple-400';
                title = '最终答案';
                stepDiv.classList.add('bg-purple-900', 'bg-opacity-20', 'border-purple-500');
                break;
        }

        stepDiv.innerHTML = `
            <div class="flex items-center gap-2 mb-2">
                <i data-lucide="${iconName}" class="w-4 h-4 ${titleColor}"></i>
                <span class="font-bold ${titleColor}">${title}</span>
            </div>
            <div class="text-sm text-gray-200 whitespace-pre-wrap">${this.escapeHtml(content)}</div>
            ${data ? `<div class="mt-2 text-xs text-gray-400">${this.escapeHtml(JSON.stringify(data, null, 2))}</div>` : ''}
        `;

        container.appendChild(stepDiv);

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        // 滚动到底部
        stepDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    /**
     * 转义HTML特殊字符
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 构建发送给LLM的系统提示
     */
    buildSystemPrompt() {
        const toolsDescription = this.availableTools.map(tool => {
            const params = tool.parameters?.properties || {};
            const required = tool.parameters?.required || [];
            const paramsDesc = Object.entries(params).map(([key, value]) => {
                const isRequired = required.includes(key);
                return `    - ${key}${isRequired ? ' (必需)' : ' (可选)'}: ${value.description || ''}`;
            }).join('\n');

            return `- ${tool.name}: ${tool.description}\n  参数:\n${paramsDesc}`;
        }).join('\n\n');

        return `你是一个具有工具使用能力的AI助手。你可以使用以下工具来帮助用户完成任务：

${toolsDescription}

**重要规则**：
1. 你必须严格使用工具定义中提供的确切参数名称，任何偏离都将导致执行失败
2. 所有文件路径都是相对于当前工作目录的相对路径
3. 不要使用绝对路径，除非用户明确指定

**read_file工具的灵活使用**：
read_file 工具已经整合了多种读取模式，通过不同的可选参数组合实现：

1. **完整读取**（默认）：只提供 path 参数
   - 适用于小文件（如配置文件、小代码文件）
   - 会自动应用Token限制保护（约2000 tokens）
   - 如果文件过大被截断，系统会提示你使用更精确的参数

2. **预览文件头部**：使用 head 参数
   - 例：{"path": "large.log", "head": 50} 读取前50行
   - 适用于快速预览大文件结构
   - 优先级最高

3. **查看文件尾部**：使用 tail 参数
   - 例：{"path": "app.log", "tail": 100} 读取最后100行
   - 适用于查看日志文件的最新内容
   - 优先级次于head

4. **精确范围读取**：使用 start_line 和 end_line 参数
   - 例：{"path": "code.js", "start_line": 100, "end_line": 150}
   - 适用于查看特定代码段或错误位置
   - 必须同时提供两个参数

**策略建议**：
- 未知大小文件：先用 head 快速预览判断结构
- 日志文件：使用 tail 查看最新内容
- 定位特定内容：结合 grep 找到行号后用 start_line/end_line 精确读取
- 所有读取结果都受Token保护，不会溢出上下文

请使用ReAct（Reasoning and Acting）模式来思考和行动：
1. Thought: 分析当前情况，决定下一步要做什么
2. Action: 选择一个工具并提供参数（必须使用正确的参数名）
3. Observation: 观察工具执行的结果
4. 重复上述步骤，直到能够给出最终答案

当你需要使用工具时，请按照以下JSON格式回复：
{
  "thought": "你的思考过程",
  "action": "tool_name",
  "action_input": {
    "param1": "value1",
    "param2": "value2"
  }
}

当你准备给出最终答案时，请使用：
{
  "thought": "你的思考过程",
  "final_answer": "你的最终答案"
}

**再次强调**：严格遵守工具定义的参数名，不要自创参数名！`;
    }

    /**
     * 调用LLM API
     */
    async callLLM(userMessage) {
        const settings = this.mainApp.settings;

        const messages = [
            { role: 'system', content: this.buildSystemPrompt() },
            ...this.conversationHistory,
            { role: 'user', content: userMessage }
        ];

        try {
            const response = await fetch(settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.apiKey}`
                },
                body: JSON.stringify({
                    model: settings.model,
                    messages: messages,
                    temperature: 0.7,
                })
            });

            if (!response.ok) {
                throw new Error(`API请求失败: ${response.statusText}`);
            }

            const data = await response.json();

            // 返回内容和token使用信息
            return {
                content: data.choices[0].message.content,
                usage: data.usage || null
            };
        } catch (error) {
            console.error('LLM调用失败:', error);
            throw error;
        }
    }

    /**
     * 解析LLM响应
     */
    parseLLMResponse(response) {
        try {
            // 尝试提取JSON部分（可能被markdown代码块包裹）
            const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                            response.match(/```\s*([\s\S]*?)\s*```/) ||
                            [null, response];

            const jsonStr = jsonMatch[1] || response;
            return JSON.parse(jsonStr.trim());
        } catch (error) {
            // 如果不是有效的JSON，尝试从文本中提取信息
            console.warn('无法解析为JSON，尝试文本分析:', error);

            // 检查是否包含最终答案
            if (response.includes('final_answer') || response.includes('最终答案')) {
                return {
                    thought: '完成任务',
                    final_answer: response
                };
            }

            // 否则返回一个包含响应的对象
            return {
                thought: response,
                final_answer: response
            };
        }
    }

    /**
     * 启动ReAct循环
     */
    async startReActLoop(initialTask) {
        // 初始化
        this.sessionId = this.generateSessionId();
        this.isActive = true;
        this.conversationHistory = [];
        this.logEntries = [];
        this.logFileName = `agent_${Date.now()}.json`;

        // 记录初始任务
        this.addLogEntry('start', '开始Agent任务', { task: initialTask });

        // 获取可用工具
        await this.fetchAvailableTools();
        this.addLogEntry('tools', '已加载可用工具', { tools: this.availableTools.map(t => t.name) });

        // 创建Agent消息气泡
        this.createAgentMessageBubble();

        let iteration = 0;
        let currentMessage = initialTask;

        try {
            while (this.isActive && iteration < this.maxIterations) {
                iteration++;

                this.addTraceStep('thought', `第 ${iteration} 轮思考中...`);
                this.addLogEntry('iteration', `第 ${iteration} 轮`, { message: currentMessage });

                // 在会话中添加一个ReAct节点标记
                const activeSession = this.mainApp.getActiveSession();
                if (activeSession) {
                    activeSession.messages.push({
                        role: 'system',
                        content: `[Agent迭代 ${iteration}]`,
                        type: 'agent_iteration',
                        isAgentMarker: true,
                        iteration: iteration,
                        timestamp: new Date().toISOString()
                    });
                }

                // 调用LLM
                const llmResult = await this.callLLM(currentMessage);
                const llmResponse = llmResult.content;
                this.addLogEntry('llm_response', 'LLM响应', { response: llmResponse });

                // 累计token消耗
                if (llmResult.usage) {
                    const totalTokens = (llmResult.usage.prompt_tokens || 0) + (llmResult.usage.completion_tokens || 0);
                    this.mainApp.addTokensToCurrentSession(totalTokens);
                }

                // 解析响应
                const parsed = this.parseLLMResponse(llmResponse);

                // 显示思考过程
                if (parsed.thought) {
                    this.addTraceStep('thought', parsed.thought);
                    // 保存思考步骤到会话
                    if (activeSession) {
                        activeSession.messages.push({
                            role: 'assistant',
                            content: parsed.thought,
                            type: 'agent_thought',
                            iteration: iteration,
                            timestamp: new Date().toISOString()
                        });
                    }
                }

                // 检查是否有最终答案
                if (parsed.final_answer) {
                    this.addTraceStep('final', parsed.final_answer);
                    this.addLogEntry('final_answer', parsed.final_answer);

                    // 在主聊天窗口显示最终答案
                    this.mainApp.addMessage(parsed.final_answer, 'ai');

                    // 保存最终答案到会话
                    if (activeSession) {
                        activeSession.messages.push({
                            role: 'assistant',
                            content: parsed.final_answer,
                            type: 'agent_final_answer',
                            iteration: iteration,
                            timestamp: new Date().toISOString()
                        });
                    }

                    break;
                }

                // 执行工具
                if (parsed.action && parsed.action_input) {
                    this.addTraceStep('action', `执行工具: ${parsed.action}`, parsed.action_input);
                    this.addLogEntry('action', `执行工具: ${parsed.action}`, { tool: parsed.action, args: parsed.action_input });

                    // 保存工具调用到会话
                    if (activeSession) {
                        activeSession.messages.push({
                            role: 'assistant',
                            content: `执行工具: ${parsed.action}`,
                            type: 'agent_action',
                            tool: parsed.action,
                            args: parsed.action_input,
                            iteration: iteration,
                            timestamp: new Date().toISOString()
                        });
                    }

                    let result = await this.executeToolOnBackend(parsed.action, parsed.action_input);

                    // 检查是否需要用户确认
                    if (result.requires_confirm) {
                        this.addTraceStep('action', `⚠️ 等待用户确认: ${result.confirm_message}`);
                        this.addLogEntry('confirm_request', result.confirm_message);

                        const confirmed = await this.requestUserConfirmation(result.confirm_message);

                        if (confirmed) {
                            this.addTraceStep('action', '✓ 用户已确认，继续执行');
                            this.addLogEntry('confirmed', '用户确认执行');
                            // 重新执行，带上确认标志
                            result = await this.executeToolOnBackend(parsed.action, parsed.action_input, true);
                        } else {
                            this.addTraceStep('error', '✗ 用户取消操作');
                            this.addLogEntry('cancelled', '用户取消操作');
                            currentMessage = `用户取消了操作: ${result.confirm_message}，请尝试其他方法`;
                            continue;
                        }
                    }

                    if (result.success) {
                        this.addTraceStep('observation', result.output);
                        this.addLogEntry('observation', result.output, { cwd: result.cwd });

                        // 保存观察结果到会话
                        if (activeSession) {
                            activeSession.messages.push({
                                role: 'system',
                                content: result.output,
                                type: 'agent_observation',
                                cwd: result.cwd,
                                iteration: iteration,
                                timestamp: new Date().toISOString()
                            });
                        }

                        // 将结果添加到对话历史
                        this.conversationHistory.push({
                            role: 'assistant',
                            content: JSON.stringify(parsed)
                        });
                        this.conversationHistory.push({
                            role: 'user',
                            content: `工具执行结果:\n${result.output}\n当前工作目录: ${result.cwd}`
                        });

                        currentMessage = `工具执行结果:\n${result.output}\n当前工作目录: ${result.cwd}`;
                    } else {
                        this.addTraceStep('error', result.error || '工具执行失败');
                        this.addLogEntry('error', result.error || '工具执行失败');

                        // 保存错误到会话
                        if (activeSession) {
                            activeSession.messages.push({
                                role: 'system',
                                content: result.error || '工具执行失败',
                                type: 'agent_error',
                                iteration: iteration,
                                timestamp: new Date().toISOString()
                            });
                        }

                        // 将错误添加到对话历史
                        currentMessage = `工具执行失败: ${result.error}，请尝试其他方法`;
                    }
                } else {
                    // 如果没有工具调用也没有最终答案，说明格式有问题
                    this.addTraceStep('error', '无法理解LLM的响应格式');
                    this.addLogEntry('error', '无法理解LLM的响应格式', { llm_response: llmResponse });

                    // 保存错误到会话
                    if (activeSession) {
                        activeSession.messages.push({
                            role: 'system',
                            content: '无法理解LLM的响应格式',
                            type: 'agent_error',
                            iteration: iteration,
                            timestamp: new Date().toISOString()
                        });
                    }

                    break;
                }
            }

            if (iteration >= this.maxIterations) {
                this.addTraceStep('error', '达到最大迭代次数，终止执行');
                this.mainApp.addMessage('Agent执行超时，请尝试简化任务', 'ai');
            }

        } catch (error) {
            console.error('ReAct循环出错:', error);
            this.addTraceStep('error', `执行出错: ${error.message}`);
            this.mainApp.addMessage(`Agent执行出错: ${error.message}`, 'ai');
        } finally {
            // 保存会话并更新节点轴和Token用量
            const activeSession = this.mainApp.getActiveSession();
            if (activeSession) {
                this.mainApp.saveSessions();
                this.mainApp.renderNodeAxis();
                this.mainApp.updateTokenUsage();
            }

            // 关闭会话
            await this.closeSession();
        }
    }
}

// 在浏览器环境中，将 AgentHandler 导出到全局对象
if (typeof window !== 'undefined') {
    window.AgentHandler = AgentHandler;
}

// Node.js 环境的导出（如果需要）
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = AgentHandler;
}