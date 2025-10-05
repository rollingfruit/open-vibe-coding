/**
 * DiffViewer - 独立的差异视图组件
 * 负责计算、渲染和管理文本差异的可视化展示
 */
export class DiffViewer {
    /**
     * 构造函数
     * @param {HTMLElement} editorEl - 编辑器元素，DiffViewer会在其旁边创建容器
     */
    constructor(editorEl) {
        this.editorEl = editorEl;
        this.containerEl = null;
        this.onUpdateCallback = null;
        this.onCloseCallback = null;
        this.currentDiffData = null;
        this.originalContent = null;

        // 初始化容器
        this._initContainer();
    }

    /**
     * 初始化Diff容器
     * @private
     */
    _initContainer() {
        // 查找或创建 Diff 容器
        let container = document.getElementById('inlineDiffContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'inlineDiffContainer';
            container.className = this.editorEl.className;
            container.classList.add('hidden');
            this.editorEl.parentNode.insertBefore(container, this.editorEl.nextSibling);
        }
        this.containerEl = container;
    }

    /**
     * 显示Diff视图
     * @param {Object} options - 配置选项
     * @param {string} options.originalContent - 修改前的完整文本
     * @param {string} options.newContent - 修改后的完整文本
     * @param {Function} options.onUpdate - 当用户撤销变更时触发的回调，返回最新的文本内容
     * @param {Function} options.onClose - 当Diff视图关闭时触发的回调
     */
    show({ originalContent, newContent, onUpdate, onClose }) {
        this.originalContent = originalContent;
        this.onUpdateCallback = onUpdate;
        this.onCloseCallback = onClose;

        // 计算差异
        this.currentDiffData = this._computeClientDiff(originalContent, newContent);

        // 隐藏编辑器，显示Diff容器
        this.editorEl.classList.add('hidden');
        this.containerEl.classList.remove('hidden');

        // 渲染Diff视图
        this._renderDiffView(newContent);
    }

    /**
     * 隐藏Diff视图
     */
    hide() {
        this.containerEl.classList.add('hidden');
        this.editorEl.classList.remove('hidden');

        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    /**
     * 渲染Diff视图
     * @private
     */
    _renderDiffView(newContent) {
        this.containerEl.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
        this.containerEl.style.fontSize = '13px';
        this.containerEl.style.position = 'relative';
        this.containerEl.innerHTML = '';

        // 添加顶部信息栏
        const actionBar = document.createElement('div');
        actionBar.className = 'sticky top-0 z-10 bg-blue-900 border-b border-blue-700 p-3 flex items-center justify-between';
        const changeCount = this.currentDiffData.filter(l => l.type !== 'unchanged').length;
        actionBar.innerHTML = `
            <div class="flex items-center gap-2">
                <i data-lucide="check-circle" class="w-5 h-5 text-blue-300"></i>
                <span class="text-sm font-semibold text-blue-300">已应用更改</span>
                <span class="text-xs text-blue-400">(${changeCount} 处修改)</span>
            </div>
            <button id="closeDiffViewBtn" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition">
                <i data-lucide="x" class="w-3 h-3 inline mr-1"></i>
                关闭
            </button>
        `;
        this.containerEl.appendChild(actionBar);

        // 创建滚动容器
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'overflow-y-auto';
        scrollContainer.style.maxHeight = 'calc(100vh - 200px)';

        // 渲染专业Diff
        this._renderProfessionalDiff(scrollContainer, this.currentDiffData, {
            showRevertButton: true,
            onRevert: (blockIndex, diffBlocks) => {
                this._handleRevertBlock(blockIndex, diffBlocks);
            }
        });

        this.containerEl.appendChild(scrollContainer);

        // 绑定关闭按钮事件
        const closeBtn = this.containerEl.querySelector('#closeDiffViewBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 核心Diff渲染引擎
     * @private
     */
    _renderProfessionalDiff(container, diffData, options = {}) {
        if (!container || !diffData) {
            console.error('❌ renderProfessionalDiff: 缺少必要参数', { container, diffData });
            return;
        }

        container.innerHTML = '';
        container.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
        container.style.fontSize = '13px';

        const diffBlocks = this._groupDiffBlocks(diffData);

        diffBlocks.forEach((block, blockIndex) => {
            const blockContainer = document.createElement('div');
            blockContainer.className = block.hasChanges ? 'diff-block relative group my-1' : 'diff-block';
            blockContainer.dataset.blockIndex = blockIndex;

            // 渲染块中的每一行
            block.lines.forEach(line => {
                if (line.type === 'modified') {
                    // 专业Diff：将修改行拆分为红色（旧）和绿色（新）两行
                    const oldContent = line.oldContent || '';
                    const newContent = line.content || '';

                    // 1. 渲染旧行（红色竖线标记 + 明显背景色）
                    const oldLineDiv = document.createElement('div');
                    oldLineDiv.className = 'leading-6 py-1 flex items-start';
                    oldLineDiv.style.borderLeft = '4px solid rgb(239, 68, 68)';
                    oldLineDiv.style.paddingLeft = '0.75rem';
                    oldLineDiv.style.backgroundColor = 'rgba(220, 38, 38, 0.25)'; // 更深的红色背景
                    oldLineDiv.innerHTML = `
                        <span class="inline-block w-12 text-right mr-4 text-xs select-none flex-shrink-0 pt-0.5" style="color: #fca5a5; font-weight: 600;">${line.oldLineNumber || '-'}</span>
                        <span class="flex-1" style="font-weight: 500;">${this._renderIntraLineDiff(oldContent, newContent, 'old')}</span>
                    `;
                    blockContainer.appendChild(oldLineDiv);

                    // 2. 渲染新行（绿色竖线标记 + 明显背景色）
                    const newLineDiv = document.createElement('div');
                    newLineDiv.className = 'leading-6 py-1 flex items-start';
                    newLineDiv.style.borderLeft = '4px solid rgb(34, 197, 94)';
                    newLineDiv.style.paddingLeft = '0.75rem';
                    newLineDiv.style.backgroundColor = 'rgba(22, 163, 74, 0.25)'; // 更深的绿色背景
                    newLineDiv.innerHTML = `
                        <span class="inline-block w-12 text-right mr-4 text-xs select-none flex-shrink-0 pt-0.5" style="color: #86efac; font-weight: 600;">${line.lineNumber || '+'}</span>
                        <span class="flex-1" style="font-weight: 500;">${this._renderIntraLineDiff(oldContent, newContent, 'new')}</span>
                    `;
                    blockContainer.appendChild(newLineDiv);

                } else {
                    // 对于 added, removed, unchanged，使用统一渲染
                    const lineDiv = this._createSingleDiffLineElement(line);
                    blockContainer.appendChild(lineDiv);
                }
            });

            // 如果是变更块且需要撤销按钮
            if (block.hasChanges && options.showRevertButton) {
                const revertButton = document.createElement('button');
                revertButton.className = 'absolute top-1/2 -translate-y-1/2 right-4 p-1.5 rounded-full bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white transition opacity-0 group-hover:opacity-100 z-10';
                revertButton.title = '撤销此项修改';
                revertButton.dataset.blockIndex = blockIndex;
                revertButton.innerHTML = `<i data-lucide="rotate-ccw" class="w-4 h-4 pointer-events-none"></i>`;
                revertButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (options.onRevert) {
                        options.onRevert(blockIndex, diffBlocks);
                    }
                });
                blockContainer.appendChild(revertButton);
            }

            container.appendChild(blockContainer);
        });

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 在客户端计算累积 Diff
     * @private
     */
    _computeClientDiff(originalText, newText) {
        const originalLines = originalText.split('\n');
        const newLines = newText.split('\n');

        // 使用简单的 LCS 算法进行行级 diff
        const lcsMatrix = this._computeLCS(originalLines, newLines);

        // 回溯生成 diff
        let i = originalLines.length;
        let j = newLines.length;
        let newLineNum = newLines.length;
        let oldLineNum = originalLines.length;

        const tempResult = [];

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && originalLines[i - 1] === newLines[j - 1]) {
                // 相同行
                tempResult.unshift({
                    type: 'unchanged',
                    content: newLines[j - 1],
                    lineNumber: newLineNum
                });
                i--;
                j--;
                newLineNum--;
                oldLineNum--;
            } else if (j > 0 && (i === 0 || lcsMatrix[i][j - 1] >= lcsMatrix[i - 1][j])) {
                // 添加行
                tempResult.unshift({
                    type: 'added',
                    content: newLines[j - 1],
                    lineNumber: newLineNum
                });
                j--;
                newLineNum--;
            } else if (i > 0) {
                // 删除行
                tempResult.unshift({
                    type: 'removed',
                    content: originalLines[i - 1],
                    lineNumber: 0,
                    oldLineNumber: oldLineNum
                });
                i--;
                oldLineNum--;
            }
        }

        // 重新计算新行号
        let currentLineNum = 1;
        tempResult.forEach(line => {
            if (line.type !== 'removed') {
                line.lineNumber = currentLineNum;
                currentLineNum++;
            }
        });

        // 合并相邻的删除和添加为修改
        return this._mergeModifications(tempResult);
    }

    /**
     * 计算 LCS 矩阵
     * @private
     */
    _computeLCS(a, b) {
        const m = a.length;
        const n = b.length;
        const lcs = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1] === b[j - 1]) {
                    lcs[i][j] = lcs[i - 1][j - 1] + 1;
                } else {
                    lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
                }
            }
        }

        return lcs;
    }

    /**
     * 合并相邻的删除和添加为修改
     * @private
     */
    _mergeModifications(diffs) {
        const result = [];
        let i = 0;

        while (i < diffs.length) {
            const current = diffs[i];

            if (current.type === 'removed') {
                // 收集连续的 removed 行
                const removedLines = [current];
                let j = i + 1;
                while (j < diffs.length && diffs[j].type === 'removed') {
                    removedLines.push(diffs[j]);
                    j++;
                }

                // 收集紧随其后的连续 added 行
                const addedLines = [];
                while (j < diffs.length && diffs[j].type === 'added') {
                    addedLines.push(diffs[j]);
                    j++;
                }

                // 如果有 added 行，进行配对合并
                if (addedLines.length > 0) {
                    const pairCount = Math.min(removedLines.length, addedLines.length);

                    // 配对的行合并为 modified
                    for (let k = 0; k < pairCount; k++) {
                        result.push({
                            type: 'modified',
                            content: addedLines[k].content,
                            oldContent: removedLines[k].content,
                            lineNumber: addedLines[k].lineNumber,
                            oldLineNumber: removedLines[k].oldLineNumber
                        });
                    }

                    // 多余的 removed 行保持为 removed
                    for (let k = pairCount; k < removedLines.length; k++) {
                        result.push(removedLines[k]);
                    }

                    // 多余的 added 行保持为 added
                    for (let k = pairCount; k < addedLines.length; k++) {
                        result.push(addedLines[k]);
                    }

                    i = j;
                } else {
                    // 没有 added 行，保持所有 removed 行
                    removedLines.forEach(line => result.push(line));
                    i = j;
                }
            } else {
                // 非 removed 行直接添加
                result.push(current);
                i++;
            }
        }

        return result;
    }

    /**
     * 将 Diff 数据分组为变更块
     * @private
     */
    _groupDiffBlocks(diffData) {
        const blocks = [];
        let currentBlock = null;

        diffData.forEach((line, index) => {
            const isChange = line.type !== 'unchanged';

            if (isChange) {
                if (!currentBlock || !currentBlock.hasChanges) {
                    // 开始一个新的变更块
                    currentBlock = {
                        hasChanges: true,
                        lines: [line],
                        startIndex: index
                    };
                    blocks.push(currentBlock);
                } else {
                    // 添加到当前变更块
                    currentBlock.lines.push(line);
                }
            } else {
                // 未变更的行
                if (!currentBlock || currentBlock.hasChanges) {
                    // 开始一个新的未变更块
                    currentBlock = {
                        hasChanges: false,
                        lines: [line],
                        startIndex: index
                    };
                    blocks.push(currentBlock);
                } else {
                    // 添加到当前未变更块
                    currentBlock.lines.push(line);
                }
            }
        });

        return blocks;
    }

    /**
     * 创建单个 Diff 行的 DOM 元素
     * @private
     */
    _createSingleDiffLineElement(line) {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'leading-6 py-1 px-3 flex items-start';

        const lineNumberSpan = document.createElement('span');
        lineNumberSpan.className = 'inline-block w-12 text-right mr-4 text-xs select-none flex-shrink-0 pt-0.5';

        const contentSpan = document.createElement('span');
        contentSpan.className = 'flex-1';

        switch (line.type) {
            case 'removed':
                // 删除行：明显的红色背景 + 亮文字 + 删除线
                lineDiv.style.borderLeft = '4px solid rgb(239, 68, 68)';
                lineDiv.style.paddingLeft = '0.75rem';
                lineDiv.style.backgroundColor = 'rgba(220, 38, 38, 0.25)'; // 更深的红色背景
                lineNumberSpan.textContent = line.oldLineNumber || '-';
                lineNumberSpan.style.color = '#fca5a5'; // 亮红色
                lineNumberSpan.style.fontWeight = '600';
                contentSpan.innerHTML = `<span style="color:rgb(78, 76, 76); text-decoration: line-through; font-weight: 500;">${this._escapeHtml(line.content)}</span>`;
                break;
            case 'added':
                // 新增行：明显的绿色背景 + 白色文字
                lineDiv.style.borderLeft = '4px solid rgb(34, 197, 94)';
                lineDiv.style.paddingLeft = '0.75rem';
                lineDiv.style.backgroundColor = 'rgba(22, 163, 74, 0.25)'; // 更深的绿色背景
                lineNumberSpan.textContent = line.lineNumber || '+';
                lineNumberSpan.style.color = '#86efac'; // 亮绿色
                lineNumberSpan.style.fontWeight = '600';
                contentSpan.innerHTML = `<span style="color:rgb(78, 75, 75); font-weight: 500;">${this._escapeHtml(line.content)}</span>`;
                break;
            default: // unchanged
                lineNumberSpan.textContent = line.lineNumber || ' ';
                lineNumberSpan.style.color = '#9ca3af';
                contentSpan.innerHTML = `<span style="color:rgb(21, 22, 23);">${this._escapeHtml(line.content)}</span>`;
                break;
        }

        lineDiv.appendChild(lineNumberSpan);
        lineDiv.appendChild(contentSpan);
        return lineDiv;
    }

    /**
     * 渲染行内差异
     * @private
     */
    _renderIntraLineDiff(oldText, newText, mode) {
        if (typeof diff_match_patch === 'undefined') {
            console.warn('diff_match_patch 未加载，使用简单显示');
            return this._escapeHtml(mode === 'old' ? oldText : newText);
        }

        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(oldText, newText);
        dmp.diff_cleanupSemantic(diffs);

        let html = '';

        diffs.forEach(([type, text]) => {
            const escaped = this._escapeHtml(text);
            if (type === 0) { // 相等 (DIFF_EQUAL)
                html += `<span style="color:rgb(77, 77, 77); font-weight: 500;">${escaped}</span>`;
            } else if (type === -1) { // 删除 (DIFF_DELETE)
                if (mode === 'old') {
                    // 删除的文字：深红色背景 + 白色文字 + 更明显的样式
                    html += `<span style="background-color: rgb(185, 28, 28); color: #ffffff; border-radius: 3px; padding: 2px 4px; font-weight: 600; text-decoration: line-through;">${escaped}</span>`;
                }
            } else if (type === 1) { // 插入 (DIFF_INSERT)
                if (mode === 'new') {
                    // 新增的文字：深绿色背景 + 白色文字 + 更明显的样式
                    html += `<span style="background-color: rgb(22, 163, 74); color: #ffffff; border-radius: 3px; padding: 2px 4px; font-weight: 600;">${escaped}</span>`;
                }
            }
        });
        return html;
    }

    /**
     * 撤销单个变更块的修改
     * @private
     */
    _handleRevertBlock(blockIndex, allBlocks) {
        console.log('🔄 撤销变更块:', blockIndex);

        const blockToRevert = allBlocks[blockIndex];
        if (!blockToRevert || !blockToRevert.hasChanges) {
            console.warn('无效的变更块');
            return;
        }

        // 从所有块中重建文档内容，但在目标块上使用原始内容
        const revertedLines = [];

        allBlocks.forEach((block, index) => {
            if (index === blockIndex) {
                // 这是要撤销的块，恢复到原始内容
                block.lines.forEach(line => {
                    if (line.type === 'removed') {
                        // 删除的行要恢复回来
                        revertedLines.push(line.content);
                    } else if (line.type === 'modified') {
                        // 修改的行要恢复到旧内容
                        revertedLines.push(line.oldContent);
                    }
                    // 'added' 类型的行不添加（即撤销新增）
                });
            } else {
                // 其他块，保留其当前（修改后）的内容
                block.lines.forEach(line => {
                    if (line.type !== 'removed') {
                        // 非删除的行都要保留
                        revertedLines.push(line.content);
                    }
                    // 'removed' 类型的行不添加
                });
            }
        });

        const newContent = revertedLines.join('\n');

        // 触发更新回调
        if (this.onUpdateCallback) {
            this.onUpdateCallback(newContent);
        }

        // 重新计算并显示累积 Diff
        this.currentDiffData = this._computeClientDiff(this.originalContent, newContent);
        this._renderDiffView(newContent);
    }

    /**
     * HTML 转义
     * @private
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
