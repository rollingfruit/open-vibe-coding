/**
 * SelectionHighlighter - 统一管理划词文本的高亮显示
 *
 * 核心功能:
 * 1. 为不同类型的内容(textarea, div, PDF)提供统一的高亮显示
 * 2. 确保用户在弹出tooltip时能始终看到被选中的文本
 * 3. 提供美观、一致的视觉效果
 */

export class SelectionHighlighter {
    /**
     * @param {object} app - 主应用程序实例
     */
    constructor(app) {
        this.app = app;

        // 存储当前活跃的高亮元素
        this.activeHighlights = new Set();

        // 存储原生选区信息
        this.lastNativeRange = null;
        this.lastSelectedText = '';

        // 存储textarea的选中信息
        this.textareaSelection = {
            element: null,
            start: 0,
            end: 0,
            text: ''
        };
    }

    /**
     * 高亮textarea中的选中内容
     * 由于textarea的原生特性限制,我们通过在tooltip中显示选中文本来解决
     *
     * @param {HTMLTextAreaElement} textarea - textarea元素
     * @param {string} selectedText - 选中的文本
     */
    highlightTextareaContent(textarea, selectedText) {
        // 存储textarea选区信息
        this.textareaSelection = {
            element: textarea,
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
            text: selectedText
        };

        this.lastSelectedText = selectedText;
    }

    /**
     * 高亮div元素中的选中文本
     * 通过在选中文本周围包裹<span>元素实现高亮
     *
     * @param {HTMLElement} targetElement - 目标容器元素
     * @param {Range} selectionRange - 浏览器选区Range对象
     */
    highlightDivSelection(targetElement, selectionRange) {
        if (!selectionRange || !targetElement) {
            return;
        }

        try {
            // 保存原生选区
            this.storeNativeSelection();

            // 创建高亮包装器
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'highlight-selection';
            highlightSpan.setAttribute('data-highlighter-mark', 'true');

            // 使用Range的surroundContents方法包裹选中内容
            // 注意:如果选区跨越多个节点,需要特殊处理
            try {
                const clonedRange = selectionRange.cloneRange();
                clonedRange.surroundContents(highlightSpan);
                this.activeHighlights.add(highlightSpan);
            } catch (e) {
                // 如果surroundContents失败(跨越多个节点),使用更复杂的方法
                this.highlightComplexSelection(targetElement, selectionRange);
            }
        } catch (error) {
            console.error('高亮div选中内容失败:', error);
        }
    }

    /**
     * 处理跨越多个节点的复杂选区高亮
     *
     * @param {HTMLElement} targetElement - 目标容器元素
     * @param {Range} selectionRange - 浏览器选区Range对象
     */
    highlightComplexSelection(targetElement, selectionRange) {
        try {
            // 提取选区内容
            const fragment = selectionRange.extractContents();

            // 创建高亮包装器
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'highlight-selection';
            highlightSpan.setAttribute('data-highlighter-mark', 'true');
            highlightSpan.appendChild(fragment);

            // 插入高亮元素
            selectionRange.insertNode(highlightSpan);

            this.activeHighlights.add(highlightSpan);
        } catch (error) {
            console.error('复杂选区高亮失败:', error);
        }
    }

    /**
     * 为PDF创建高亮浮层
     *
     * @param {object} pdfPositionRect - PDF位置信息 {x, y, width, height}
     * @param {HTMLElement} containerElement - 浮层容器元素
     */
    highlightPdfOverlay(pdfPositionRect, containerElement) {
        if (!pdfPositionRect || !containerElement) {
            return;
        }

        try {
            // 创建浮层元素
            const overlay = document.createElement('div');
            overlay.className = 'pdf-highlight-overlay';
            overlay.setAttribute('data-highlighter-mark', 'true');

            // 设置位置和尺寸
            const { x, y, width, height } = pdfPositionRect;
            overlay.style.left = `${x}px`;
            overlay.style.top = `${y}px`;
            overlay.style.width = `${width}px`;
            overlay.style.height = `${height}px`;

            // 添加到容器
            containerElement.appendChild(overlay);
            this.activeHighlights.add(overlay);
        } catch (error) {
            console.error('创建PDF高亮浮层失败:', error);
        }
    }

    /**
     * 清除所有高亮
     */
    clearHighlights() {
        // 清除所有高亮元素
        this.activeHighlights.forEach(element => {
            if (element && element.parentNode) {
                // 对于span包裹的高亮,将内容还原
                if (element.tagName === 'SPAN' && element.classList.contains('highlight-selection')) {
                    const parent = element.parentNode;
                    while (element.firstChild) {
                        parent.insertBefore(element.firstChild, element);
                    }
                    parent.removeChild(element);
                } else {
                    // 对于浮层,直接移除
                    element.remove();
                }
            }
        });

        this.activeHighlights.clear();

        // 清空原生选区(但不影响已经弹出的tooltip)
        // 注意:不调用removeAllRanges,因为这会影响某些场景下的用户体验
    }

    /**
     * 存储当前的原生选区
     */
    storeNativeSelection() {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            this.lastNativeRange = selection.getRangeAt(0).cloneRange();
            this.lastSelectedText = selection.toString();
        }
    }

    /**
     * 恢复之前存储的原生选区
     */
    restoreNativeSelection() {
        if (this.lastNativeRange) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(this.lastNativeRange);
            } catch (error) {
                console.warn('恢复原生选区失败:', error);
            }
        }
    }

    /**
     * 恢复textarea的选区
     */
    restoreTextareaSelection() {
        const { element, start, end } = this.textareaSelection;
        if (element && element.setSelectionRange) {
            try {
                element.focus();
                element.setSelectionRange(start, end);
            } catch (error) {
                console.warn('恢复textarea选区失败:', error);
            }
        }
    }

    /**
     * 获取最后选中的文本
     * @returns {string}
     */
    getLastSelectedText() {
        return this.lastSelectedText || this.textareaSelection.text || '';
    }
}
