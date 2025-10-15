import { InlineDiffView } from '../diff/inline/InlineDiffView.js';

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
     * Starts the modification process.
     * @param {string} instruction - The user's instruction for modification.
     * @param {string} selectedText - The full lines of text selected by the user.
     * @param {string} fullText - The complete content of the editor.
     * @param {number} selectionStart - Start position of selection in fullText.
     * @param {number} selectionEnd - End position of selection in fullText.
     */
    async startModification(instruction, selectedText, fullText, selectionStart, selectionEnd) {
        if (this.isActive) {
            this.app.uiManager.showNotification('正在处理中，请稍候', 'warning');
            return;
        }

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
    finalizeModification(newFullText) {
        // 应用完整的内容到编辑器
        this.editorElement.value = newFullText;

        // 保存笔记
        if (this.app.noteManager && this.app.noteManager.performActualSave) {
            this.app.noteManager.performActualSave(newFullText);
        }

        this.cleanup();
        this.app.uiManager.showNotification('修改已应用并保存', 'success');
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
