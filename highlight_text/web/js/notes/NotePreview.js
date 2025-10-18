
/**
 * NotePreview - 管理笔记预览的渲染和交互
 */
export class NotePreview {
    /**
     * @param {HTMLElement} previewElement - 用于显示预览的DOM元素
     * @param {object} app - 主应用程序实例，用于访问渲染器等
     */
    constructor(previewElement, app) {
        this.previewElement = previewElement;
        this.app = app;
    }

    /**
     * 更新预览内容
     * @param {string} content - Markdown格式的笔记内容
     */
    update(content) {
        if (!this.previewElement || !this.app.chatManager) {
            console.error("Preview element or ChatManager not found!");
            return;
        }

        // 使用ChatManager中的formatMessage方法来渲染Markdown
        const html = this.app.chatManager.formatMessage(content);
        this.previewElement.innerHTML = html;

        // 执行渲染后的处理
        this.postRender();
    }

    /**
     * 渲染后的处理，例如代码高亮、图片缩放等
     */
    postRender() {
        if (!this.previewElement) return;

        // 为预览中的图片设置宽度（从URL的#zoom参数读取，或使用默认60%）
        this.previewElement.querySelectorAll('img').forEach(img => {
            const src = img.src;
            const zoomMatch = src.match(/#zoom=(\d+)/);

            if (zoomMatch) {
                img.style.width = `${zoomMatch[1]}%`;
            } else if (!img.style.width) {
                img.style.width = '60%';
            }
        });

        // 重新添加代码块的复制按钮等交互
        if (this.app.chatManager) {
            // addCopyButtons会处理高亮和图标
            this.app.chatManager.addCopyButtons();
        } else {
            // Fallback if chatManager is not available for some reason
            if (typeof hljs !== 'undefined') {
                this.previewElement.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
            if (window.lucide) {
                lucide.createIcons();
            }
        }
    }

    /**
     * 显示预览
     */
    show() {
        if (this.previewElement) {
            this.previewElement.classList.remove('hidden');
        }
    }

    /**
     * 隐藏预览
     */
    hide() {
        if (this.previewElement) {
            this.previewElement.classList.add('hidden');
        }
    }

    /**
     * 渲染纯文本内容
     * @param {string} content - 纯文本内容
     */
    renderText(content) {
        if (!this.previewElement) {
            console.error("Preview element not found!");
            return;
        }

        // 清空并移除markdown样式
        this.previewElement.classList.remove('markdown-body');

        // 将文本包装在<pre>标签中以保留格式
        this.previewElement.innerHTML = `<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: monospace; padding: 1rem;">${this.escapeHtml(content)}</pre>`;
    }

    /**
     * 渲染PDF文件
     * @param {string} filePath - PDF文件路径
     */
    renderPdf(filePath) {
        if (!this.previewElement) {
            console.error("Preview element not found!");
            return;
        }

        // 清空并移除markdown样式
        this.previewElement.classList.remove('markdown-body');

        // 使用iframe + PDF.js viewer
        const viewerUrl = `/js/lib/pdfjs/web/viewer.html?file=${encodeURIComponent(filePath)}`;
        this.previewElement.innerHTML = `
            <iframe
                src="${viewerUrl}"
                style="width: 100%; height: 100%; border: none; min-height: 600px;"
                id="pdfViewerFrame"
            ></iframe>
        `;

        // 存储当前PDF路径，用于后续的划词功能
        this.currentPdfPath = filePath;
    }

    /**
     * HTML转义
     * @param {string} text - 需要转义的文本
     * @returns {string} 转义后的文本
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
