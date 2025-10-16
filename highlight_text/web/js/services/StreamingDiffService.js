import { InlineDiffView } from '../diff/inline/InlineDiffView.js';
import { convertLinesToSelection } from '../utils/helpers.js';

/**
 * StreamingDiffService - Handles real-time, line-by-line diffing from an LLM stream.
 * 协调中心：负责与 LLM 通信，驱动 InlineDiffView 进行 UI 更新
 */
export class StreamingDiffService {
    constructor(editorElement, app) {
        this.editorElement = editorElement;
        this.app = app;
        this.originalContent = '';
        this.streamedContent = '';
        this.inlineView = null;
        this.isActive = false;

        // 保存完整上下文（用于内联视图）
        this.fullOriginalText = '';
        this.selectionStart = 0;
        this.selectionEnd = 0;
    }

    /**
     * 为Agent启动修改流程（基于行号）
     * Agent调用此方法时,传入行号范围和修改指令,此方法会转换为字符位置并启动InlineDiffView
     * @param {Object} params - 参数对象
     * @param {string} params.note_id - 要修改的笔记ID
     * @param {number} params.start_line - 起始行号（从1开始）
     * @param {number} params.end_line - 结束行号（包含此行）
     * @param {string} params.instruction - 给AI的修改指令
     * @returns {Promise<void>}
     */
    async startModificationForAgent({ note_id, start_line, end_line, instruction }) {
        // 移除单例限制，允许并发修改
        // 每个实例独立管理自己的状态

        const editor = this.editorElement;

        // 检测是否是创建新文件的操作
        // 判断依据：该笔记当前未打开（不是活动笔记）
        // 注意：不再依赖行号判断，因为 Agent 可能指定任意行号范围
        const isNewFile = this.app.noteManager.activeNoteId !== note_id;

        if (isNewFile) {
            console.log(`[Agent] 创建新文件: ${note_id}, 指令="${instruction}"`);

            // 对于新文件，设置空内容作为起点
            const fullText = '';
            const selection = {
                selectedText: '',
                selectionStart: 0,
                selectionEnd: 0
            };

            // 标记这是新文件创建操作
            this.isNewFileCreation = true;
            this.newFileNoteId = note_id;

            await this.startModification(
                instruction,
                selection.selectedText,
                fullText,
                selection.selectionStart,
                selection.selectionEnd
            );
            return;
        }

        // 修改现有笔记（当前已打开的笔记）
        console.log(`[Agent] 修改现有笔记: ${note_id}, 行=${start_line}-${end_line}`);

        if (!editor) {
            throw new Error(`编辑器未找到`);
        }

        const fullText = editor.value;

        // 自动修正行号范围：如果超出实际行数，使用实际的最大行数
        const actualLines = fullText.split('\n').length;
        const adjustedStartLine = Math.min(start_line, actualLines);
        const adjustedEndLine = Math.min(end_line, actualLines);

        if (adjustedEndLine !== end_line) {
            console.warn(`[StreamingDiff] 行号超出范围，已自动调整: ${start_line}-${end_line} -> ${adjustedStartLine}-${adjustedEndLine} (实际行数: ${actualLines})`);
        }

        // 关键步骤:将行号转换成字符位置
        const selection = convertLinesToSelection(fullText, adjustedStartLine, adjustedEndLine);
        if (!selection) {
            throw new Error('无效的行号范围');
        }

        console.log(`[Agent] 启动流式Diff: 笔记=${note_id}, 行=${start_line}-${end_line}, 指令="${instruction}"`);

        // 重置新文件标记
        this.isNewFileCreation = false;
        this.newFileNoteId = null;

        // 复用已有的 startModification 方法来启动视图和LLM流
        await this.startModification(
            instruction,
            selection.selectedText,
            fullText,
            selection.selectionStart,
            selection.selectionEnd
        );
    }

    /**
     * Starts the modification process.
     * @param {string} instruction - The user's instruction for modification.
     * @param {string} selectedText - The full lines of text selected by the user.
     * @param {string} fullText - The complete content of the editor.
     * @param {number} selectionStart - Start position of selection in fullText.
     * @param {number} selectionEnd - End position of selection in fullText.
     */
    async startModification(instruction, selectedText, fullText, selectionStart, selectionEnd) {
        // 移除单例限制，每个实例独立工作
        this.isActive = true;
        this.originalContent = selectedText;
        this.streamedContent = '';

        // 保存完整上下文
        this.fullOriginalText = fullText;
        this.selectionStart = selectionStart;
        this.selectionEnd = selectionEnd;

        // 创建并显示内联视图
        this.inlineView = new InlineDiffView(this.editorElement, {
            onAccept: (newFullText) => this.finalizeModification(newFullText),
            onCancel: () => this.cancelModification()
        });

        this.inlineView.show(fullText, selectionStart, selectionEnd, selectedText);

        this.app.llmService.streamCodeModification({
            codeToEdit: selectedText,
            instruction: instruction,
            onData: (textChunk) => this.processStreamChunk(textChunk),
            onComplete: () => this.addFinalActionButtons(),
            onError: (error) => {
                this.app.uiManager.showNotification(`错误: ${error.message}`, 'error');
                this.cancelModification();
            }
        });
    }

    /**
     * Process each text chunk from the LLM stream
     * @param {string} textChunk - A chunk of text from the LLM
     */
    processStreamChunk(textChunk) {
        this.streamedContent += textChunk;

        // 驱动内联视图更新
        if (this.inlineView) {
            this.inlineView.update(this.streamedContent);
        }
    }

    /**
     * Finalize the modification by applying the new content
     * @param {string} newFullText - The complete new content
     */
    async finalizeModification(newFullText) {
        // 应用完整的内容到编辑器
        this.editorElement.value = newFullText;

        // 如果是新文件创建，需要调用后端API创建文件
        if (this.isNewFileCreation && this.newFileNoteId) {
            try {
                const response = await fetch('http://localhost:8080/agent/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: 'streaming_diff_service',
                        tool: 'create_note',
                        args: {
                            title: this.newFileNoteId,
                            content: newFullText
                        },
                        action: 'execute',
                        agent_type: 'knowledge'
                    })
                });

                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error || '创建文件失败');
                }

                console.log(`[StreamingDiff] 新文件已创建: ${this.newFileNoteId}`);
                this.app.uiManager.showNotification(`新文件已创建: ${this.newFileNoteId}`, 'success');

                // 在NoteManager中打开新创建的文件
                if (this.app.noteManager) {
                    await this.app.noteManager.loadNoteFromServer(this.newFileNoteId);
                }
            } catch (error) {
                console.error('[StreamingDiff] 创建文件失败:', error);
                this.app.uiManager.showNotification(`创建文件失败: ${error.message}`, 'error');
                this.cleanup();
                return;
            }
        } else {
            // 保存现有笔记
            if (this.app.noteManager && this.app.noteManager.performActualSave) {
                this.app.noteManager.performActualSave(newFullText);
            }
            this.app.uiManager.showNotification('修改已应用并保存', 'success');
        }

        this.cleanup();
    }

    /**
     * Cancel the modification and restore original content
     */
    cancelModification() {
        // 恢复编辑器原始内容（内联视图已经自动处理显示，这里只需清理）
        if (this.fullOriginalText) {
            this.editorElement.value = this.fullOriginalText;
        }

        this.cleanup();
        this.app.uiManager.showNotification('已取消修改', 'info');
    }

    /**
     * Clean up resources and reset state
     */
    cleanup() {
        // 销毁内联视图
        if (this.inlineView) {
            this.inlineView.destroy();
            this.inlineView = null;
        }

        this.isActive = false;
        this.originalContent = '';
        this.streamedContent = '';
        this.fullOriginalText = '';
        this.selectionStart = 0;
        this.selectionEnd = 0;
    }

    /**
     * Add final action buttons after streaming is complete
     */
    addFinalActionButtons() {
        // 显示操作按钮（由内联视图处理）
        if (this.inlineView) {
            this.inlineView.showActions();
        }
    }
}
