/**
 * 知识库Copilot Agent处理器
 * 专门用于知识库操作的AI助手
 */
class KnowledgeAgentHandler {
    constructor(mainApp) {
        this.mainApp = mainApp;
        this.sessionId = null;
        this.isActive = false;
        this.maxIterations = 10;
        this.availableTools = [];
        this.conversationHistory = [];
    }

    generateSessionId() {
        return `knowledge_agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取知识库工具列表
     */
    async fetchAvailableTools() {
        try {
            const response = await fetch('http://localhost:8080/agent/knowledge/tools');
            const data = await response.json();
            this.availableTools = data.tools;
            return this.availableTools;
        } catch (error) {
            console.error('获取知识库工具列表失败:', error);
            return [];
        }
    }

    /**
     * 构建知识库专用的系统提示
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

        return `你是一个专业的写作和研究助理(Copilot)。你的任务是：

1. 根据用户正在编辑的笔记内容和整个知识库的上下文来回答问题
2. 提供写作建议和内容扩展
3. 在知识库中查找相关信息
4. 帮助用户组织和连接知识

**可用工具**：
${toolsDescription}

**工作模式**：
- 优先使用 \`search_notes\` 在知识库中查找相关信息（支持 tag:标签名 格式搜索标签）
- 使用 \`read_note\` 获取完整笔记内容
- 使用 \`update_note\` 将生成的内容写回笔记
- 使用 \`create_note\` 创建新的笔记

**知识库特性**：
- 每篇笔记可能包含YAML Front Matter元数据（位于文件开头，由---包围）
- 元数据包含：title（标题）、tags（标签数组）、created_at、updated_at等
- 笔记内容支持 [[笔记ID]] 格式的Wiki链接
- 支持 #标签 格式的内联标签
- 在总结和关联笔记时，请充分利用这些元数据和链接信息

**重要提示**：
- 你的回答应该基于知识库的内容
- 如果知识库中没有相关信息，明确告知用户
- 在修改笔记前，先向用户说明你要做什么

请使用ReAct（Reasoning and Acting）模式：
1. Thought: 分析当前情况
2. Action: 选择工具并提供参数
3. Observation: 观察工具执行结果
4. 重复直到给出最终答案

JSON格式：
{
  "thought": "你的思考",
  "action": "tool_name",
  "action_input": {"param": "value"}
}

最终答案：
{
  "thought": "总结",
  "final_answer": "你的答案"
}`;
    }

    /**
     * 调用LLM
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
     * 执行知识库工具
     */
    async executeToolOnBackend(toolName, args) {
        // 检查是否是修改文件的工具
        if (toolName === 'update_note' || toolName === 'create_note') {
            // 提取文件夹路径
            const noteId = args.note_id || args.title || '';
            const folderPath = noteId.includes('/') ? noteId.substring(0, noteId.lastIndexOf('/')) : '';

            // 检查是否已授权
            if (!this.mainApp.approvedFolders.has(folderPath)) {
                // 请求用户授权
                const approved = await this.mainApp.requestFolderPermission(folderPath);
                if (!approved) {
                    // 用户拒绝，返回取消状态
                    return {
                        success: false,
                        error: '用户拒绝修改文件'
                    };
                }
            }
        }

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
                    agent_type: 'knowledge'
                })
            });

            const result = await response.json();

            // 如果是update_note或create_note，处理diff显示
            if (result.success && (toolName === 'update_note' || toolName === 'create_note')) {
                console.log('🔍 工具执行成功，开始处理diff:', toolName);
                console.log('📦 后端返回结果:', result);

                try {
                    // 解析返回的JSON结果
                    const diffResult = JSON.parse(result.output);
                    console.log('📊 解析后的diff结果:', diffResult);

                    if (diffResult.diffData && diffResult.diffData.length > 0) {
                        console.log('✅ 找到diff数据，准备显示视图');
                        console.log('📝 NoteID:', diffResult.noteId);
                        console.log('📈 Diff行数:', diffResult.diffData.length);

                        // 先刷新笔记列表（如果是新创建的笔记）
                        if (toolName === 'create_note') {
                            console.log('🔄 刷新笔记列表（新创建的笔记）');
                            await this.mainApp.loadNotes();
                            // 等待笔记列表更新
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }

                        // 显示diff视图
                        console.log('🎨 准备调用displayDiff...');
                        await this.mainApp.displayDiff(diffResult.noteId, diffResult.diffData, false);
                        console.log('✨ Diff视图显示完成');
                    } else {
                        console.warn('⚠️ 没有diff数据或数据为空');
                    }
                } catch (parseError) {
                    console.error('❌ 无法解析diff结果:', parseError);
                    console.error('原始输出:', result.output);
                    console.error('错误堆栈:', parseError.stack);
                }
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
     * 解析LLM响应
     */
    parseLLMResponse(response) {
        try {
            const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                            response.match(/```\s*([\s\S]*?)\s*```/) ||
                            [null, response];

            const jsonStr = jsonMatch[1] || response;
            return JSON.parse(jsonStr.trim());
        } catch (error) {
            console.warn('无法解析为JSON:', error);
            if (response.includes('final_answer') || response.includes('最终答案')) {
                return {
                    thought: '完成任务',
                    final_answer: response
                };
            }
            return {
                thought: response,
                final_answer: response
            };
        }
    }

    /**
     * 创建Copilot追踪气泡（在左侧Copilot面板）
     */
    createCopilotBubble() {
        // 在编辑模式下，使用左侧的Copilot面板
        const copilotMessagesContainer = document.getElementById('copilotMessages');
        if (!copilotMessagesContainer) {
            console.error('Copilot消息容器未找到');
            return null;
        }

        const bubble = document.createElement('div');
        bubble.className = 'copilot-message bg-gray-700 rounded-lg p-3 animate__animated animate__fadeInUp';
        bubble.id = `copilot-trace-${this.sessionId}`;
        bubble.innerHTML = `
            <div class="mb-2 flex items-center gap-2">
                <i data-lucide="sparkles" class="w-5 h-5 text-purple-400"></i>
                <span class="text-purple-400 font-semibold text-sm">Copilot</span>
                <span class="text-gray-400 text-xs ml-auto">正在思考...</span>
            </div>
            <div class="copilot-trace-content space-y-2">
                <!-- Copilot追踪步骤将在这里动态添加 -->
            </div>
        `;
        copilotMessagesContainer.appendChild(bubble);

        if (window.lucide) {
            lucide.createIcons();
        }

        // 滚动到底部
        copilotMessagesContainer.scrollTop = copilotMessagesContainer.scrollHeight;

        return bubble;
    }

    /**
     * 获取当前Copilot气泡
     */
    getCurrentCopilotBubble() {
        return document.getElementById(`copilot-trace-${this.sessionId}`);
    }

    /**
     * 添加追踪步骤
     */
    addTraceStep(type, content, data = null) {
        const bubble = this.getCurrentCopilotBubble();
        if (!bubble) return;

        const container = bubble.querySelector('.copilot-trace-content');

        // 折叠所有之前的步骤（除了final类型）
        const previousSteps = container.querySelectorAll('.agent-trace-step:not(.collapsed):not(.final-step)');
        previousSteps.forEach(step => {
            if (!step.classList.contains('collapsed')) {
                this.collapseTraceStep(step);
            }
        });

        const stepDiv = document.createElement('div');
        stepDiv.className = 'agent-trace-step border rounded-lg p-3 mb-2 cursor-pointer';

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
            case 'final':
                iconName = 'check-circle';
                titleColor = 'text-purple-400';
                title = '最终答案';
                stepDiv.classList.add('bg-purple-900', 'bg-opacity-20', 'border-purple-500', 'final-step');
                break;
        }

        // 获取内容预览（前50个字符）
        const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;

        stepDiv.innerHTML = `
            <div class="flex items-center gap-2 mb-2">
                <i data-lucide="${iconName}" class="w-4 h-4 ${titleColor}"></i>
                <span class="font-bold ${titleColor}">${title}</span>
                <i data-lucide="chevron-down" class="w-4 h-4 ml-auto collapse-indicator"></i>
            </div>
            <div class="step-preview text-xs text-gray-400 hidden">${this.escapeHtml(preview)}</div>
            <div class="step-content text-sm text-gray-200 whitespace-pre-wrap">${this.escapeHtml(content)}</div>
            ${data ? `<div class="step-data mt-2 text-xs text-gray-400">${this.escapeHtml(JSON.stringify(data, null, 2))}</div>` : ''}
        `;

        // 添加点击事件切换展开/折叠
        stepDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (stepDiv.classList.contains('collapsed')) {
                this.expandTraceStep(stepDiv);
            } else {
                this.collapseTraceStep(stepDiv);
            }
        });

        container.appendChild(stepDiv);

        if (window.lucide) {
            lucide.createIcons();
        }

        stepDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    /**
     * 折叠追踪步骤
     */
    collapseTraceStep(stepDiv) {
        stepDiv.classList.add('collapsed');
        stepDiv.classList.remove('p-3');
        stepDiv.classList.add('p-2');

        const preview = stepDiv.querySelector('.step-preview');
        const content = stepDiv.querySelector('.step-content');
        const data = stepDiv.querySelector('.step-data');
        const indicator = stepDiv.querySelector('.collapse-indicator');

        if (preview) preview.classList.remove('hidden');
        if (content) content.classList.add('hidden');
        if (data) data.classList.add('hidden');
        if (indicator) {
            indicator.setAttribute('data-lucide', 'chevron-right');
            if (window.lucide) lucide.createIcons();
        }
    }

    /**
     * 展开追踪步骤
     */
    expandTraceStep(stepDiv) {
        stepDiv.classList.remove('collapsed');
        stepDiv.classList.remove('p-2');
        stepDiv.classList.add('p-3');

        const preview = stepDiv.querySelector('.step-preview');
        const content = stepDiv.querySelector('.step-content');
        const data = stepDiv.querySelector('.step-data');
        const indicator = stepDiv.querySelector('.collapse-indicator');

        if (preview) preview.classList.add('hidden');
        if (content) content.classList.remove('hidden');
        if (data) data.classList.remove('hidden');
        if (indicator) {
            indicator.setAttribute('data-lucide', 'chevron-down');
            if (window.lucide) lucide.createIcons();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 启动ReAct循环（带编辑器上下文）
     */
    async startReActLoop(initialTask, editorContext) {
        this.sessionId = this.generateSessionId();
        this.isActive = true;
        this.conversationHistory = [];

        await this.fetchAvailableTools();

        // 读取上下文文件内容
        let contextFilesContent = '';
        const contextFiles = this.mainApp.copilotContextFiles || [];

        if (contextFiles.length > 0) {
            contextFilesContent = '用户提供了以下文件作为上下文参考：\n\n';

            for (const noteId of contextFiles) {
                try {
                    const result = await this.executeToolOnBackend('read_note', { note_id: noteId });

                    if (result.success) {
                        // 解析返回的JSON
                        const noteData = JSON.parse(result.output);
                        const content = noteData.content || '';

                        // 分行处理
                        const lines = content.split('\n');
                        const previewLines = lines.slice(0, 200);
                        const hasMore = lines.length > 200;

                        contextFilesContent += `--- 文件: ${noteId} ---\n`;
                        contextFilesContent += previewLines.join('\n');
                        if (hasMore) {
                            contextFilesContent += `\n\n...(文件总共 ${lines.length} 行，仅显示前200行)\n`;
                        }
                        contextFilesContent += '\n\n';
                    }
                } catch (error) {
                    console.error(`读取上下文文件 ${noteId} 失败:`, error);
                    contextFilesContent += `--- 文件: ${noteId} (读取失败) ---\n\n`;
                }
            }
        }

        // 构建包含编辑器上下文的初始消息
        let contextMessage = '';

        // 优先添加上下文文件内容
        if (contextFilesContent) {
            contextMessage += contextFilesContent;
        }

        contextMessage += `用户请求: ${initialTask}\n\n`;

        if (editorContext) {
            contextMessage += `当前编辑的笔记: ${editorContext.noteId || '新笔记'}\n`;
            if (editorContext.selectedText) {
                contextMessage += `选中的文本:\n${editorContext.selectedText}\n\n`;
            }
            if (editorContext.fullText) {
                const preview = editorContext.fullText.substring(0, 500);
                contextMessage += `笔记内容预览:\n${preview}${editorContext.fullText.length > 500 ? '...' : ''}`;
            }
        }

        let iteration = 0;
        let currentMessage = contextMessage;

        // 创建Copilot消息气泡
        this.createCopilotBubble();

        try {
            while (this.isActive && iteration < this.maxIterations) {
                iteration++;

                this.addTraceStep('thought', `第 ${iteration} 轮思考中...`);

                const llmResult = await this.callLLM(currentMessage);
                const llmResponse = llmResult.content;
                const parsed = this.parseLLMResponse(llmResponse);

                if (parsed.thought) {
                    this.addTraceStep('thought', parsed.thought);
                }

                if (parsed.final_answer) {
                    this.addTraceStep('final', parsed.final_answer);
                    break;
                }

                if (parsed.action && parsed.action_input) {
                    this.addTraceStep('action', `执行工具: ${parsed.action}`, parsed.action_input);

                    const result = await this.executeToolOnBackend(parsed.action, parsed.action_input);

                    if (result.success) {
                        this.addTraceStep('observation', result.output);

                        this.conversationHistory.push({
                            role: 'assistant',
                            content: JSON.stringify(parsed)
                        });
                        this.conversationHistory.push({
                            role: 'user',
                            content: `工具执行结果:\n${result.output}`
                        });

                        currentMessage = `工具执行结果:\n${result.output}`;
                    } else {
                        this.addTraceStep('observation', `错误: ${result.error || '工具执行失败'}`);
                        currentMessage = `工具执行失败: ${result.error}`;
                    }
                } else {
                    break;
                }
            }

            if (iteration >= this.maxIterations) {
                this.addTraceStep('final', 'Copilot执行超时，请尝试简化任务');
            }

        } catch (error) {
            console.error('Copilot执行出错:', error);
            this.addTraceStep('final', `Copilot执行出错: ${error.message}`);
        }
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KnowledgeAgentHandler;
}
