import { escapeHtml } from '../../utils/helpers.js';

/**
 * InlineDiffView - 内联 Diff 视图，直接嵌入到编辑器位置显示
 * 负责所有与内联 Diff 相关的 DOM 操作和 UI 渲染
 */
export class InlineDiffView {
    /**
     * @param {HTMLElement} editorElement - noteEditor 元素
     * @param {Object} callbacks - 回调函数
     * @param {Function} callbacks.onAccept - 接受修改的回调
     * @param {Function} callbacks.onCancel - 取消修改的回调
     * @param {HTMLElement} [parentContainer=null] - 可选的父容器，如果提供则渲染到该容器而不是替换编辑器
     */
    constructor(editorElement, callbacks = {}, parentContainer = null) {
        this.editorElement = editorElement;
        this.callbacks = callbacks;
        this.parentContainer = parentContainer; // 可选的父容器

        // DOM 元素引用
        this.hostContainer = null;
        this.liveDiffContainer = null;

        // 内容状态
        this.fullText = '';
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.originalContent = '';
        this.streamedContent = '';
        this.isActive = false;

        // 用户编辑追踪
        this.userEdits = new Map();

        // 自动滚动控制
        this.shouldAutoScroll = true; // 是否启用自动滚动
        this.lastScrollTop = 0; // 记录上次滚动位置
    }

    /**
     * 显示内联 Diff 视图
     * @param {string} fullText - 完整文档内容
     * @param {number} selectionStart - 选区起始位置
     * @param {number} selectionEnd - 选区结束位置
     * @param {string} originalContent - 被修改的原始内容
     */
    show(fullText, selectionStart, selectionEnd, originalContent) {
        this.fullText = fullText;
        this.selectionStart = selectionStart;
        this.selectionEnd = selectionEnd;
        this.originalContent = originalContent;
        this.streamedContent = '';
        this.isActive = true;
        this.userEdits.clear(); // 清空之前的编辑记录

        // 如果没有指定父容器，使用默认行为（隐藏编辑器，在其位置渲染）
        if (!this.parentContainer) {
            // 隐藏原始编辑器
            this.editorElement.style.display = 'none';

            // 创建宿主容器，样式与 noteEditor 一致
            this.hostContainer = document.createElement('div');
            this.hostContainer.id = 'inlineDiffHost';
            this.hostContainer.className = this.editorElement.className;

            // 复制编辑器的样式
            const computedStyle = window.getComputedStyle(this.editorElement);
            this.hostContainer.style.backgroundColor = computedStyle.backgroundColor;
            this.hostContainer.style.color = computedStyle.color;
            this.hostContainer.style.fontFamily = computedStyle.fontFamily;
            this.hostContainer.style.fontSize = computedStyle.fontSize;
            this.hostContainer.style.lineHeight = computedStyle.lineHeight;
            this.hostContainer.style.padding = computedStyle.padding;
            this.hostContainer.style.border = computedStyle.border;
            this.hostContainer.style.borderRadius = computedStyle.borderRadius;
            this.hostContainer.style.overflow = 'auto';
            this.hostContainer.style.whiteSpace = 'pre-wrap';
            this.hostContainer.style.wordWrap = 'break-word';

            // 插入到编辑器位置
            this.editorElement.parentNode.insertBefore(this.hostContainer, this.editorElement);
        } else {
            // 使用指定的父容器，不隐藏编辑器
            // 创建宿主容器（简化版，不需要复制编辑器的所有样式）
            this.hostContainer = document.createElement('div');
            this.hostContainer.className = 'inlineDiffHost-in-parent';

            // 添加到指定的父容器
            this.parentContainer.appendChild(this.hostContainer);
        }

        // 渲染三段式内容
        this.renderThreePartView();
    }

    /**
     * 渲染三段式视图：上文 + Diff区域 + 下文
     */
    renderThreePartView() {
        // 切分内容
        const beforeSelection = this.fullText.substring(0, this.selectionStart);
        const afterSelection = this.fullText.substring(this.selectionEnd);

        this.hostContainer.innerHTML = '';

        // 1. 上文（选区之前的内容）
        if (beforeSelection) {
            const beforeDiv = document.createElement('div');
            beforeDiv.className = 'inline-diff-context inline-diff-before';
            beforeDiv.textContent = beforeSelection;
            this.hostContainer.appendChild(beforeDiv);
        }

        // 2. Diff 区域
        this.liveDiffContainer = document.createElement('div');
        this.liveDiffContainer.id = 'inlineLiveDiffContainer';
        this.liveDiffContainer.className = 'inline-diff-live-container';

        // 初始加载状态
        this.liveDiffContainer.innerHTML = `
            <div class="inline-diff-loading">
                <span class="loading-spinner"></span>
                <span class="loading-text">AI 正在生成修改建议...</span>
            </div>
        `;

        this.hostContainer.appendChild(this.liveDiffContainer);

        // 3. 下文（选区之后的内容）
        if (afterSelection) {
            const afterDiv = document.createElement('div');
            afterDiv.className = 'inline-diff-context inline-diff-after';
            afterDiv.textContent = afterSelection;
            this.hostContainer.appendChild(afterDiv);
        }

        // 自动滚动到 Diff 区域
        setTimeout(() => {
            this.liveDiffContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

        // 监听用户滚动行为
        this.setupScrollListener();
    }

    /**
     * 更新流式内容
     * @param {string} streamedContent - 最新的流式内容
     */
    update(streamedContent) {
        this.streamedContent = streamedContent;
        this.renderDiff();

        // 流式更新时自动滚动到底部
        this.autoScrollToBottom();
    }

    /**
     * 渲染 Diff 视图
     */
    renderDiff() {
        if (!this.liveDiffContainer) return;

        // Use jsdiff for line-level diffing
        const lineDiffs = typeof Diff !== 'undefined'
            ? Diff.diffLines(this.originalContent, this.streamedContent)
            : null;

        if (!lineDiffs) {
            // Fallback: simple display
            this.liveDiffContainer.innerHTML = `
                <div class="inline-diff-simple">
                    <div class="inline-diff-header">
                        <span class="diff-status-badge">修改预览</span>
                        <button class="inline-diff-close-btn" id="inlineCloseBtnTop">
                            <i data-lucide="x" class="w-4 h-4"></i>
                        </button>
                    </div>
                    <pre class="inline-diff-content">${escapeHtml(this.streamedContent)}${this.isActive ? '<span class="cursor-blink">▌</span>' : ''}</pre>
                </div>
            `;
            this.bindCloseButton();
            return;
        }

        // Preprocess: merge adjacent removed/added as modified
        const processedDiffs = this.mergeModifications(lineDiffs);

        // Unified diff view
        let html = '<div class="inline-diff-unified">';

        // Header with close button
        html += '<div class="inline-diff-header">';
        html += '<div class="inline-diff-header-left">';
        if (this.isActive) {
            html += '<span class="diff-status-badge diff-status-processing">正在修改</span>';
            html += ' <span class="cursor-blink">▌</span>';
        } else {
            html += '<span class="diff-status-badge diff-status-complete">修改完成</span>';
        }
        html += '</div>';
        html += '<button class="inline-diff-close-btn" id="inlineCloseBtnTop">';
        html += '<i data-lucide="x" class="w-4 h-4"></i>';
        html += '</button>';
        html += '</div>';

        // Content
        html += '<div class="inline-diff-content">';

        let lineNum = 1;
        for (const diff of processedDiffs) {
            if (diff.type === 'unchanged') {
                // Unchanged lines
                const lines = diff.value.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');
                for (const line of lines) {
                    html += this.renderLine(lineNum++, line, 'unchanged');
                }
            } else if (diff.type === 'removed') {
                // Pure removed lines
                const lines = diff.value.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');
                for (const line of lines) {
                    html += this.renderLine(lineNum++, line, 'removed', '-');
                }
            } else if (diff.type === 'added') {
                // Pure added lines - 可编辑
                const lines = diff.value.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');
                for (const line of lines) {
                    html += this.renderLine(lineNum, line, 'added', '+', true);
                }
                lineNum += lines.length;
            } else if (diff.type === 'modified') {
                // Modified lines with character-level diff - 上下配对显示
                const oldLines = diff.oldValue.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');
                const newLines = diff.newValue.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');

                // 为整个修改块创建包装容器
                html += '<div class="diff-pair-wrapper">';

                // 配对渲染：按照较小的长度进行一一配对
                const minLength = Math.min(oldLines.length, newLines.length);
                const maxLength = Math.max(oldLines.length, newLines.length);

                // 先渲染配对的部分（每一对红绿紧密相邻）
                for (let i = 0; i < minLength; i++) {
                    const currentLineNum = lineNum + i;

                    // 红色旧行
                    html += this.renderModifiedLine(currentLineNum, oldLines[i], newLines[i], 'old', '-');
                    // 绿色新行（紧跟在红色行下方）
                    html += this.renderModifiedLine(currentLineNum, newLines[i], oldLines[i], 'new', '+', true);
                }

                // 渲染剩余的行（如果有的话）
                if (oldLines.length > newLines.length) {
                    // 有多余的删除行
                    for (let i = minLength; i < oldLines.length; i++) {
                        html += this.renderLine(lineNum + minLength, oldLines[i], 'removed', '-');
                    }
                } else if (newLines.length > oldLines.length) {
                    // 有多余的新增行
                    for (let i = minLength; i < newLines.length; i++) {
                        const currentLineNum = lineNum + i;
                        html += this.renderLine(currentLineNum, newLines[i], 'added', '+', true);
                    }
                }

                // 行号增加应该基于新内容的行数
                lineNum += newLines.length;

                html += '</div>'; // Close diff-pair-wrapper
            }
        }

        html += '</div></div>'; // Close content and unified

        this.liveDiffContainer.innerHTML = html;

        // Bind close button
        this.bindCloseButton();

        // Bind input events for editable content
        this.bindEditableEvents();

        // Initialize icons
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 合并相邻的删除和添加为修改
     */
    mergeModifications(lineDiffs) {
        const result = [];
        let i = 0;

        while (i < lineDiffs.length) {
            const current = lineDiffs[i];

            if (!current.added && !current.removed) {
                // Unchanged
                result.push({ type: 'unchanged', value: current.value });
                i++;
            } else if (current.removed && i + 1 < lineDiffs.length && lineDiffs[i + 1].added) {
                // Removed + Added = Modified
                result.push({
                    type: 'modified',
                    oldValue: current.value,
                    newValue: lineDiffs[i + 1].value
                });
                i += 2;
            } else if (current.removed) {
                // Pure removal
                result.push({ type: 'removed', value: current.value });
                i++;
            } else if (current.added) {
                // Pure addition
                result.push({ type: 'added', value: current.value });
                i++;
            } else {
                i++;
            }
        }

        return result;
    }

    /**
     * 绑定关闭按钮事件
     */
    bindCloseButton() {
        const closeBtn = document.getElementById('inlineCloseBtnTop');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (this.callbacks.onCancel) {
                    this.callbacks.onCancel();
                }
            });
        }
    }

    /**
     * 绑定可编辑区域的输入事件
     */
    bindEditableEvents() {
        if (!this.liveDiffContainer) return;

        // 使用事件委托监听所有可编辑元素的输入
        this.liveDiffContainer.addEventListener('input', (event) => {
            const target = event.target;

            // 检查是否是可编辑元素
            if (target.getAttribute('contenteditable') === 'true' && target.hasAttribute('data-line-id')) {
                const lineId = target.getAttribute('data-line-id');
                const newContent = target.textContent;

                // 更新用户编辑记录
                this.userEdits.set(lineId, newContent);
            }
        });
    }

    /**
     * 获取最终内容（合并 AI 建议和用户编辑）
     * @returns {string} 合并后的最终内容
     */
    getFinalContent() {
        // 将流式内容按行分割
        const lines = this.streamedContent.split('\n');

        // 遍历每一行，检查是否有用户编辑
        const finalLines = lines.map((line, index) => {
            // 行号从 1 开始，数组索引从 0 开始
            const lineId = String(index + 1);

            // 如果用户编辑了这一行，使用用户的版本
            if (this.userEdits.has(lineId)) {
                return this.userEdits.get(lineId);
            }

            // 否则使用原始 AI 建议
            return line;
        });

        // 重新连接成字符串
        return finalLines.join('\n');
    }

    /**
     * 渲染单行
     */
    renderLine(lineNum, lineContent, type, prefix = '', editable = false) {
        const lineClass = `inline-diff-line inline-diff-line-${type}`;
        const prefixSpan = prefix ? `<span class="diff-prefix">${prefix}</span>` : '<span class="diff-prefix"> </span>';

        // 绿色行（added）可编辑
        const contentEditableAttr = editable ? ' contenteditable="true"' : '';
        const dataLineIdAttr = editable ? ` data-line-id="${lineNum}"` : '';

        return `<div class="${lineClass}">` +
               `<span class="line-number">${lineNum}</span>` +
               prefixSpan +
               `<span class="line-content"${contentEditableAttr}${dataLineIdAttr}>${escapeHtml(lineContent)}</span>` +
               `</div>`;
    }

    /**
     * 渲染修改的行（带字符级差异）
     */
    renderModifiedLine(lineNum, line, compareLine, side, prefix, editable = false) {
        const lineClass = side === 'old'
            ? 'inline-diff-line inline-diff-line-removed'
            : 'inline-diff-line inline-diff-line-added';
        const prefixSpan = `<span class="diff-prefix">${prefix}</span>`;

        // 绿色行（new）可编辑
        const contentEditableAttr = editable ? ' contenteditable="true"' : '';
        const dataLineIdAttr = editable ? ` data-line-id="${lineNum}"` : '';

        // Use diff-match-patch for character-level diff
        if (typeof diff_match_patch !== 'undefined' && line && compareLine) {
            const dmp = new diff_match_patch();
            const charDiff = dmp.diff_main(
                side === 'old' ? line : compareLine,
                side === 'old' ? compareLine : line
            );
            dmp.diff_cleanupSemantic(charDiff);

            let lineContent = '';
            for (const [operation, text] of charDiff) {
                const escapedText = escapeHtml(text);
                if (operation === 0) {
                    // Unchanged characters
                    lineContent += escapedText;
                } else if (operation === -1 && side === 'old') {
                    // Removed characters - show only on old side
                    lineContent += `<span class="char-removed">${escapedText}</span>`;
                } else if (operation === 1 && side === 'new') {
                    // Added characters - show only on new side
                    lineContent += `<span class="char-added">${escapedText}</span>`;
                } else if (operation === -1 && side === 'new') {
                    // Skip removed chars on new side
                    continue;
                } else if (operation === 1 && side === 'old') {
                    // Skip added chars on old side
                    continue;
                }
            }

            return `<div class="${lineClass}">` +
                   `<span class="line-number">${lineNum}</span>` +
                   prefixSpan +
                   `<span class="line-content"${contentEditableAttr}${dataLineIdAttr}>${lineContent}</span>` +
                   `</div>`;
        } else {
            // Fallback without character-level diff
            return `<div class="${lineClass}">` +
                   `<span class="line-number">${lineNum}</span>` +
                   prefixSpan +
                   `<span class="line-content"${contentEditableAttr}${dataLineIdAttr}>${escapeHtml(line)}</span>` +
                   `</div>`;
        }
    }

    /**
     * 显示操作按钮（接受/取消）
     */
    showActions() {
        this.isActive = false;

        if (!this.liveDiffContainer) return;

        // 先重新渲染 diff（移除加载状态，更新状态标记）
        this.renderDiff();

        // 然后添加操作按钮栏
        const actionBar = document.createElement('div');
        actionBar.className = 'inline-diff-actions';
        actionBar.innerHTML = `
            <button id="inlineAcceptBtn" class="inline-diff-btn inline-diff-btn-accept">
                <i data-lucide="check" class="w-4 h-4"></i>
                <span>接受修改</span>
            </button>
            <button id="inlineCancelBtn" class="inline-diff-btn inline-diff-btn-cancel">
                <i data-lucide="x" class="w-4 h-4"></i>
                <span>取消</span>
            </button>
        `;

        // 找到 unified 容器，添加到底部
        const unifiedDiv = this.liveDiffContainer.querySelector('.inline-diff-unified');
        if (unifiedDiv) {
            unifiedDiv.appendChild(actionBar);
        } else {
            this.liveDiffContainer.appendChild(actionBar);
        }

        // 绑定事件
        document.getElementById('inlineAcceptBtn').addEventListener('click', () => {
            if (this.callbacks.onAccept) {
                // 获取最终内容（合并用户编辑）
                const finalContent = this.getFinalContent();

                // 拼接完整内容
                const beforeSelection = this.fullText.substring(0, this.selectionStart);
                const afterSelection = this.fullText.substring(this.selectionEnd);
                const newFullText = beforeSelection + finalContent + afterSelection;

                this.callbacks.onAccept(newFullText);
            }
        });

        document.getElementById('inlineCancelBtn').addEventListener('click', () => {
            if (this.callbacks.onCancel) {
                this.callbacks.onCancel();
            }
        });

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 设置滚动监听器，检测用户是否主动滚动
     */
    setupScrollListener() {
        if (!this.liveDiffContainer) return;

        // 找到可滚动的内容区域
        const diffContent = this.liveDiffContainer.querySelector('.inline-diff-content');
        if (!diffContent) return;

        // 监听滚动事件
        diffContent.addEventListener('scroll', () => {
            const scrollTop = diffContent.scrollTop;
            const scrollHeight = diffContent.scrollHeight;
            const clientHeight = diffContent.clientHeight;

            // 计算是否接近底部（允许10px的误差）
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 10;

            // 如果用户向上滚动（远离底部），禁用自动滚动
            if (scrollTop < this.lastScrollTop && !isNearBottom) {
                this.shouldAutoScroll = false;
            }

            // 如果用户滚动到接近底部，重新启用自动滚动
            if (isNearBottom) {
                this.shouldAutoScroll = true;
            }

            this.lastScrollTop = scrollTop;
        });
    }

    /**
     * 自动滚动到底部（仅在启用时）
     */
    autoScrollToBottom() {
        if (!this.shouldAutoScroll || !this.liveDiffContainer) return;

        // 找到可滚动的内容区域
        const diffContent = this.liveDiffContainer.querySelector('.inline-diff-content');
        if (!diffContent) return;

        // 使用 requestAnimationFrame 确保DOM已更新
        requestAnimationFrame(() => {
            // 平滑滚动到底部
            diffContent.scrollTo({
                top: diffContent.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    /**
     * 销毁视图，恢复编辑器
     */
    destroy() {
        // 移除宿主容器
        if (this.hostContainer && this.hostContainer.parentNode) {
            this.hostContainer.parentNode.removeChild(this.hostContainer);
        }

        // 只有在没有使用父容器时才恢复编辑器显示
        if (!this.parentContainer && this.editorElement) {
            this.editorElement.style.display = '';
        }

        // 清理引用
        this.hostContainer = null;
        this.liveDiffContainer = null;
        this.isActive = false;

        // 重置自动滚动状态
        this.shouldAutoScroll = true;
        this.lastScrollTop = 0;
    }
}
