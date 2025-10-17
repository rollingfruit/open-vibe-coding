import { StreamingDiffService } from './StreamingDiffService.js';

/**
 * MultiFileDiffManager - 管理多个文件的流式Diff修改
 * 特性：
 * 1. 队列管理：多个文件修改操作顺序执行
 * 2. 标签页UI：为每个文件修改创建独立的标签页
 * 3. 用户控制：每个文件可独立接受/取消
 */
export class MultiFileDiffManager {
    constructor(app) {
        this.app = app;
        this.editorElement = document.getElementById('noteEditor');

        // 修改任务队列
        this.taskQueue = [];

        // 活动的diff实例 Map<taskId, DiffInstance>
        this.activeDiffs = new Map();

        // 文件到标签页的映射 Map<note_id, tabId>
        this.fileToTabMap = new Map();

        // 标签页到文件的映射 Map<tabId, note_id>
        this.tabToFileMap = new Map();

        // 每个标签页下的diff实例列表 Map<tabId, DiffInstance[]>
        this.tabDiffInstances = new Map();

        // 标签页容器
        this.tabContainer = null;
        this.tabContentContainer = null;

        // 当前激活的标签ID
        this.activeTabId = null;

        // 是否正在处理任务
        this.isProcessing = false;
    }

    /**
     * 添加文件修改任务（并发执行，不排队）
     * @param {Object} params - 修改参数
     * @param {string} params.note_id - 笔记ID
     * @param {number} params.start_line - 起始行号
     * @param {number} params.end_line - 结束行号
     * @param {string} params.instruction - 修改指令
     * @returns {Promise<string>} 任务ID
     */
    async enqueueTask({ note_id, start_line, end_line, instruction }) {
        const taskId = `diff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const task = {
            id: taskId,
            note_id,
            start_line,
            end_line,
            instruction,
            status: 'processing', // 直接设置为 processing，并发执行
            createdAt: new Date()
        };

        console.log(`[MultiFileDiff] 任务入队（并发）: ${taskId}, 文件: ${note_id}`);

        // 创建标签页容器（如果还没有）
        this.ensureTabContainerExists();

        // 检查该文件是否已有标签页
        let tabId = this.fileToTabMap.get(note_id);

        if (tabId) {
            // 同一文件，在已有标签页中添加新的diff实例
            console.log(`[MultiFileDiff] 文件 ${note_id} 已有标签页 ${tabId}，追加新的修改`);
            try {
                await this.appendDiffToExistingTab(tabId, task);
            } catch (error) {
                console.error(`[MultiFileDiff] 任务执行失败: ${task.id}`, error);
                task.status = 'error';
                this.app.uiManager.showNotification(`文件修改失败: ${error.message}`, 'error');
            }
        } else {
            // 新文件，创建新标签页
            console.log(`[MultiFileDiff] 文件 ${note_id} 是新文件，创建新标签页`);
            try {
                await this.createDiffInstance(task);
            } catch (error) {
                console.error(`[MultiFileDiff] 任务执行失败: ${task.id}`, error);
                task.status = 'error';
                this.updateTabStatus(task.id, 'error');
                this.app.uiManager.showNotification(`文件修改失败: ${error.message}`, 'error');
            }
        }

        return taskId;
    }

    /**
     * 确保标签页容器存在
     */
    ensureTabContainerExists() {
        if (this.tabContainer) return;

        const editorContainer = document.getElementById('editor-container');
        if (!editorContainer) {
            throw new Error('编辑器容器未找到');
        }

        // 创建标签页UI容器
        const wrapper = document.createElement('div');
        wrapper.id = 'multiFileDiffWrapper';
        wrapper.className = 'multi-file-diff-wrapper';
        wrapper.innerHTML = `
            <div id="diffTabBar" class="diff-tab-bar">
                <!-- 标签页将在这里动态添加 -->
            </div>
            <div id="diffTabContent" class="diff-tab-content">
                <!-- 每个标签页的内容区域 -->
            </div>
        `;

        // 简化插入逻辑：直接插入到editor-container的开头
        editorContainer.insertBefore(wrapper, editorContainer.firstChild);

        this.tabContainer = wrapper.querySelector('#diffTabBar');
        this.tabContentContainer = wrapper.querySelector('#diffTabContent');

        console.log('[MultiFileDiff] 标签页容器已创建');
    }

    /**
     * 为任务创建Diff实例和标签页
     */
    async createDiffInstance(task) {
        // 为新文件创建唯一的标签页ID
        const tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 创建标签页
        const tab = this.createTab(task, tabId);

        // 创建标签页内容区域
        const tabContent = this.createTabContent(task, tabId);

        // 记录文件到标签页的映射
        this.fileToTabMap.set(task.note_id, tabId);
        this.tabToFileMap.set(tabId, task.note_id);

        // 初始化该标签页的diff实例列表
        this.tabDiffInstances.set(tabId, []);

        // 获取diff内容区域（InlineDiffView会在这里渲染）
        const diffContentArea = tabContent.querySelector('.diff-content-area');

        // 为这个任务创建独立的临时编辑器元素
        const tempEditor = document.createElement('textarea');
        tempEditor.style.display = 'none';
        tempEditor.id = `temp-editor-${task.id}`;
        diffContentArea.appendChild(tempEditor);

        // 创建独立的 StreamingDiffService 实例，传递 diffContentArea 作为父容器
        const diffService = new StreamingDiffService(tempEditor, this.app, diffContentArea);

        // 重写 finalizeModification 方法，在接受修改后关闭标签页
        const originalFinalize = diffService.finalizeModification.bind(diffService);
        diffService.finalizeModification = async (newFullText) => {
            await originalFinalize(newFullText);
            // 接受修改后，自动关闭这个标签页
            this.closeTabSilently(tabId);
        };

        // 重写 cancelModification 方法，在取消时也关闭标签页
        const originalCancel = diffService.cancelModification.bind(diffService);
        diffService.cancelModification = () => {
            originalCancel();
            // 取消后，也关闭这个标签页
            this.closeTabSilently(tabId);
        };

        // 存储实例
        const diffInstance = {
            task,
            tabId,
            tab,
            tabContent,
            diffContentArea,
            tempEditor,
            diffService
        };

        this.activeDiffs.set(task.id, diffInstance);
        this.tabDiffInstances.get(tabId).push(diffInstance);

        // 激活这个标签页
        this.switchToTab(tabId);

        // 加载文件内容并启动diff（不阻塞，立即返回）
        this.startDiffForTask(diffInstance).catch(error => {
            console.error(`[MultiFileDiff] 启动Diff失败: ${task.id}`, error);
            this.updateTabStatus(tabId, 'error');
        });
    }

    /**
     * 在已有标签页中追加新的diff实例
     */
    async appendDiffToExistingTab(tabId, task) {
        // 获取已有的标签页内容区域
        const tabContent = this.tabContentContainer.querySelector(`[data-tab-id="${tabId}"]`);
        if (!tabContent) {
            throw new Error(`标签页 ${tabId} 不存在`);
        }

        const diffContentArea = tabContent.querySelector('.diff-content-area');

        // 为这个任务创建独立的临时编辑器元素
        const tempEditor = document.createElement('textarea');
        tempEditor.style.display = 'none';
        tempEditor.id = `temp-editor-${task.id}`;
        diffContentArea.appendChild(tempEditor);

        // 创建独立的 StreamingDiffService 实例，传递 diffContentArea 作为父容器
        const diffService = new StreamingDiffService(tempEditor, this.app, diffContentArea);

        // 重写 finalizeModification 方法，在接受修改后关闭标签页
        const originalFinalize = diffService.finalizeModification.bind(diffService);
        diffService.finalizeModification = async (newFullText) => {
            await originalFinalize(newFullText);
            // 接受修改后，自动关闭这个标签页
            this.closeTabSilently(tabId);
        };

        // 重写 cancelModification 方法，在取消时也关闭标签页
        const originalCancel = diffService.cancelModification.bind(diffService);
        diffService.cancelModification = () => {
            originalCancel();
            // 取消后，也关闭这个标签页
            this.closeTabSilently(tabId);
        };

        // 存储实例
        const tab = this.tabContainer.querySelector(`[data-tab-id="${tabId}"]`);
        const diffInstance = {
            task,
            tabId,
            tab,
            tabContent,
            diffContentArea,
            tempEditor,
            diffService
        };

        this.activeDiffs.set(task.id, diffInstance);
        this.tabDiffInstances.get(tabId).push(diffInstance);

        // 激活这个标签页
        this.switchToTab(tabId);

        // 更新标签页状态为处理中
        this.updateTabStatus(tabId, 'processing');

        // 加载文件内容并启动diff（不阻塞，立即返回）
        this.startDiffForTask(diffInstance).catch(error => {
            console.error(`[MultiFileDiff] 启动Diff失败: ${task.id}`, error);
            this.updateTabStatus(tabId, 'error');
        });
    }

    /**
     * 创建标签页元素
     */
    createTab(task, tabId) {
        const tab = document.createElement('div');
        tab.className = 'diff-tab';
        tab.dataset.tabId = tabId;

        const fileName = task.note_id.split('/').pop() || task.note_id;

        tab.innerHTML = `
            <span class="diff-tab-name">${this.escapeHtml(fileName)}</span>
            <span class="diff-tab-status">
                <i data-lucide="loader" class="w-4 h-4 animate-spin"></i>
            </span>
            <button class="diff-tab-close" title="关闭">
                <i data-lucide="x" class="w-3 h-3"></i>
            </button>
        `;

        // 点击标签页切换
        tab.querySelector('.diff-tab-name').addEventListener('click', () => {
            this.switchToTab(tabId);
        });

        // 关闭按钮
        tab.querySelector('.diff-tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(tabId);
        });

        this.tabContainer.appendChild(tab);

        if (window.lucide) {
            lucide.createIcons();
        }

        return tab;
    }

    /**
     * 创建标签页内容区域
     */
    createTabContent(task, tabId) {
        const content = document.createElement('div');
        content.className = 'diff-tab-pane';
        content.dataset.tabId = tabId;
        content.style.display = 'none';

        content.innerHTML = `
            <div class="diff-pane-header">
                <div class="diff-file-info">
                    <i data-lucide="file-text" class="w-4 h-4"></i>
                    <span class="text-sm font-bold">${this.escapeHtml(task.note_id)}</span>
                </div>
            </div>
            <textarea class="diff-editor-clone" style="display: none;"></textarea>
            <div class="diff-content-area">
                <!-- InlineDiffView 会在这里渲染，可以有多个 inlineLiveDiffContainer -->
            </div>
        `;

        this.tabContentContainer.appendChild(content);

        if (window.lucide) {
            lucide.createIcons();
        }

        return content;
    }

    /**
     * 启动任务的Diff流程
     */
    async startDiffForTask(diffInstance) {
        const { task, diffService, tempEditor } = diffInstance;

        try {
            // 读取文件内容
            const fileContent = await this.loadFileContent(task.note_id);

            // 将内容设置到临时编辑器
            tempEditor.value = fileContent;

            // 启动 StreamingDiffService
            await diffService.startModificationForAgent({
                note_id: task.note_id,
                start_line: task.start_line,
                end_line: task.end_line,
                instruction: task.instruction
            });

            console.log(`[MultiFileDiff] Diff已启动: ${task.id}`);

        } catch (error) {
            console.error(`[MultiFileDiff] 启动Diff失败: ${task.id}`, error);
            task.status = 'error';
            this.updateTabStatus(task.id, 'error');
            throw error;
        }
    }

    /**
     * 加载文件内容
     */
    async loadFileContent(note_id) {
        // 如果是当前编辑的笔记，直接从编辑器获取
        if (this.app.noteManager.activeNoteId === note_id) {
            return this.editorElement.value;
        }

        // 否则，从后端读取
        const response = await fetch('http://localhost:8080/agent/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: 'multi_file_diff',
                tool: 'read_note',
                args: { note_id },
                action: 'execute',
                agent_type: 'knowledge'
            })
        });

        const result = await response.json();
        if (result.success) {
            const noteData = JSON.parse(result.output);
            return noteData.content || '';
        } else {
            throw new Error(`无法读取文件 ${note_id}: ${result.error}`);
        }
    }

    /**
     * 切换到指定标签页
     */
    switchToTab(tabId) {
        if (this.activeTabId === tabId) return;

        // 隐藏所有标签页内容
        this.tabContentContainer.querySelectorAll('.diff-tab-pane').forEach(pane => {
            pane.style.display = 'none';
        });

        // 移除所有标签页的激活状态
        this.tabContainer.querySelectorAll('.diff-tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // 显示目标标签页
        const targetPane = this.tabContentContainer.querySelector(`[data-tab-id="${tabId}"]`);
        const targetTab = this.tabContainer.querySelector(`[data-tab-id="${tabId}"]`);

        if (targetPane && targetTab) {
            targetPane.style.display = 'block';
            targetTab.classList.add('active');
            this.activeTabId = tabId;
            console.log(`[MultiFileDiff] 切换到标签页: ${tabId}`);
        }
    }

    /**
     * 关闭标签页
     */
    closeTab(tabId) {
        // 询问用户确认
        if (!confirm('确定要关闭此修改吗？未接受的修改将丢失。')) {
            return;
        }

        this.closeTabSilently(tabId);
    }

    /**
     * 静默关闭标签页（不需要用户确认）
     */
    closeTabSilently(tabId) {
        // 获取该标签页下的所有diff实例
        const instances = this.tabDiffInstances.get(tabId) || [];

        // 清理所有 StreamingDiffService 实例（但不调用cancelModification，因为可能已经finalized）
        instances.forEach(diffInstance => {
            // 从activeDiffs中移除
            this.activeDiffs.delete(diffInstance.task.id);
        });

        // 移除 DOM 元素
        const tab = this.tabContainer.querySelector(`[data-tab-id="${tabId}"]`);
        const tabContent = this.tabContentContainer.querySelector(`[data-tab-id="${tabId}"]`);
        if (tab) tab.remove();
        if (tabContent) tabContent.remove();

        // 从映射中移除
        const note_id = this.tabToFileMap.get(tabId);
        if (note_id) {
            this.fileToTabMap.delete(note_id);
        }
        this.tabToFileMap.delete(tabId);
        this.tabDiffInstances.delete(tabId);

        // 如果没有标签页了，隐藏容器
        if (this.tabDiffInstances.size === 0) {
            this.hideTabContainer();
        } else {
            // 切换到第一个标签页
            const firstTabId = this.tabDiffInstances.keys().next().value;
            this.switchToTab(firstTabId);
        }

        console.log(`[MultiFileDiff] 标签页已关闭: ${tabId}`);
    }

    /**
     * 更新标签页状态图标
     */
    updateTabStatus(tabId, status) {
        const tab = this.tabContainer.querySelector(`[data-tab-id="${tabId}"]`);
        if (!tab) return;

        const statusIcon = tab.querySelector('.diff-tab-status i');
        if (!statusIcon) return;

        let icon = 'loader';
        let className = 'w-4 h-4';

        switch (status) {
            case 'processing':
                icon = 'loader';
                className = 'w-4 h-4 animate-spin';
                break;
            case 'completed':
                icon = 'check';
                className = 'w-4 h-4 text-green-400';
                break;
            case 'error':
                icon = 'alert-circle';
                className = 'w-4 h-4 text-red-400';
                break;
        }

        statusIcon.setAttribute('data-lucide', icon);
        statusIcon.className = className;

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 隐藏标签页容器
     */
    hideTabContainer() {
        if (this.tabContainer && this.tabContainer.parentElement) {
            this.tabContainer.parentElement.style.display = 'none';
        }
    }

    /**
     * 转义HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 清理所有资源
     */
    cleanup() {
        this.activeDiffs.forEach((diffInstance) => {
            if (diffInstance.diffService) {
                diffInstance.diffService.cancelModification();
            }
        });

        this.activeDiffs.clear();
        this.taskQueue = [];
        this.isProcessing = false;

        if (this.tabContainer && this.tabContainer.parentElement) {
            this.tabContainer.parentElement.remove();
            this.tabContainer = null;
            this.tabContentContainer = null;
        }
    }
}
