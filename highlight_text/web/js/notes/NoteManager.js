// 1. **基础功能**
//    - 笔记列表加载
//    - 创建/编辑/保存/删除笔记
//    - 文件夹操作

// 2. **Copilot 功能**
//    - 发送Copilot消息
//    - 上下文文件管理
//    - 文件夹授权流程

// 3. **Diff 功能**
//    - 流式Diff渲染
//    - 内联Diff显示
//    - 回退功能

// 4. **编辑器功能**
//    - 预览模式切换
//    - 图片上传
//    - Wiki链接和标签

import { escapeHtml } from '../utils/helpers.js';
import { DiffViewer } from '../diff/DiffViewer.js';
import { NotePreview } from './NotePreview.js';

/**
 * NoteManager - 管理所有笔记相关的功能
 */
class NoteManager {
    constructor(app) {
        this.app = app;
        this.notes = [];
        this.activeNoteId = null;
        this.editorInstance = null;
        this.isEditorPreview = false;
        this.autoSaveTimeout = null;
        this.previewDebounceTimeout = null;
        this.notesWebSocket = null;
        this.activeNoteOriginalContent = null;
        this.contentBeforeLLMUpdate = null;
        this.copilotContextFiles = [];
        this.notePreview = null; // 将由外部初始化
        this.streamingDiffService = null; // 将由外部初始化
        this.currentDiffData = null;
    }

    /**
     * 加载笔记列表
     */
    async loadNotes() {
        try {
            const response = await fetch('http://localhost:8080/api/notes');
            if (!response.ok) {
                console.warn('加载笔记列表失败');
                return;
            }
            const text = await response.text();

            // 尝试解析JSON
            try {
                // 后端返回的是包含树状结构的文本
                // 格式: "知识库中共有 N 个项目:\n[...]"
                const match = text.match(/知识库中共有 \d+ 个项目:\n([\s\S]+)/);
                if (match) {
                    this.notes = JSON.parse(match[1]);
                } else {
                    // 兼容旧格式
                    const oldMatch = text.match(/知识库中共有 \d+ 篇笔记:\n([\s\S]+)/);
                    if (oldMatch) {
                        this.notes = JSON.parse(oldMatch[1]);
                    } else {
                        this.notes = [];
                    }
                }
            } catch (e) {
                console.warn('解析笔记列表时出错:', e);
                this.notes = [];
            }

            this.renderNoteList();
        } catch (error) {
            console.error('加载笔记失败:', error);
        }
    }

    /**
     * 渲染笔记列表
     */
    renderNoteList() {
        const notesList = document.getElementById('notesList');
        if (!notesList) return;

        notesList.innerHTML = '';

        if (!this.notes || this.notes.length === 0) {
            notesList.innerHTML = '<li class="text-gray-400 text-sm p-3 text-center">知识库为空<br><small>点击下方"新建笔记"开始</small></li>';
            return;
        }

        // 递归渲染树节点
        const renderNode = (node, parentElement, depth = 0) => {
            const nodeItem = document.createElement('li');
            nodeItem.className = 'note-tree-item';
            nodeItem.style.paddingLeft = `${depth * 12}px`;

            if (node.type === 'folder') {
                // 文件夹节点
                const folderDiv = document.createElement('div');
                folderDiv.className = 'folder-node p-2 rounded cursor-pointer transition-colors hover:bg-gray-700 border-b border-gray-700 flex items-center gap-2';
                folderDiv.draggable = true;
                folderDiv.dataset.path = node.path;
                folderDiv.dataset.type = 'folder';
                folderDiv.innerHTML = `
                    <i data-lucide="chevron-right" class="w-4 h-4 text-gray-400 folder-chevron transition-transform"></i>
                    <i data-lucide="folder" class="w-4 h-4 text-yellow-400"></i>
                    <span class="font-medium text-sm">${escapeHtml(node.name)}</span>
                `;

                // 子节点容器
                const childrenContainer = document.createElement('ul');
                childrenContainer.className = 'folder-children hidden';

                // 拖拽开始
                folderDiv.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', node.path);
                    e.dataTransfer.setData('item-type', 'folder');
                    folderDiv.style.opacity = '0.5';
                });

                // 拖拽结束
                folderDiv.addEventListener('dragend', (e) => {
                    folderDiv.style.opacity = '1';
                });

                // 拖拽悬停
                folderDiv.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    folderDiv.style.backgroundColor = 'rgba(139, 92, 246, 0.3)';
                });

                // 拖拽离开
                folderDiv.addEventListener('dragleave', (e) => {
                    folderDiv.style.backgroundColor = '';
                });

                // 接收放置
                folderDiv.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    folderDiv.style.backgroundColor = '';

                    const sourcePath = e.dataTransfer.getData('text/plain');
                    const targetPath = node.path;

                    if (sourcePath && sourcePath !== targetPath) {
                        this.moveNoteOrFolder(sourcePath, targetPath);
                    }
                });

                // 切换展开/折叠
                folderDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const chevron = folderDiv.querySelector('.folder-chevron');
                    if (childrenContainer.classList.contains('hidden')) {
                        childrenContainer.classList.remove('hidden');
                        chevron.style.transform = 'rotate(90deg)';
                    } else {
                        childrenContainer.classList.add('hidden');
                        chevron.style.transform = 'rotate(0deg)';
                    }
                });

                nodeItem.appendChild(folderDiv);

                // 渲染子节点
                if (node.children && node.children.length > 0) {
                    node.children.forEach(child => {
                        renderNode(child, childrenContainer, depth + 1);
                    });
                }

                nodeItem.appendChild(childrenContainer);
            } else if (node.type === 'file') {
                // 文件节点
                const fileDiv = document.createElement('div');
                fileDiv.className = 'file-node p-2 rounded cursor-pointer transition-colors hover:bg-gray-700 border-b border-gray-700';
                fileDiv.draggable = true;
                fileDiv.dataset.path = node.path;
                fileDiv.dataset.type = 'file';

                // 从path提取noteId（移除.md扩展名）
                const noteId = node.path.replace(/\.md$/, '');

                if (noteId === this.activeNoteId) {
                    fileDiv.classList.add('bg-purple-900', 'bg-opacity-30');
                }

                // 获取标题（优先使用metadata中的title）
                const title = node.metadata?.title || node.name.replace(/\.md$/, '');

                // 渲染标签
                let tagsHtml = '';
                if (node.tags && node.tags.length > 0) {
                    tagsHtml = `<div class="flex flex-wrap gap-1 mt-1">
                        ${node.tags.map(tag => `<span class="text-xs px-2 py-0.5 bg-blue-900 bg-opacity-50 text-blue-300 rounded">#${escapeHtml(tag)}</span>`).join('')}
                    </div>`;
                }

                fileDiv.innerHTML = `
                    <div class="flex items-center gap-2">
                        <i data-lucide="file-text" class="w-4 h-4 text-purple-400"></i>
                        <span class="font-medium text-sm">${escapeHtml(title)}</span>
                    </div>
                    ${tagsHtml}
                `;

                // 拖拽开始
                fileDiv.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', node.path);
                    e.dataTransfer.setData('item-type', 'file');
                    e.dataTransfer.setData('note-id', noteId);
                    fileDiv.style.opacity = '0.5';
                });

                // 拖拽结束
                fileDiv.addEventListener('dragend', (e) => {
                    fileDiv.style.opacity = '1';
                });

                fileDiv.addEventListener('click', () => {
                    this.switchToEditorMode(noteId);
                });

                nodeItem.appendChild(fileDiv);
            }

            parentElement.appendChild(nodeItem);
        };

        // 渲染所有根节点
        this.notes.forEach(node => {
            renderNode(node, notesList, 0);
        });

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 切换到编辑模式
     */
    async switchToEditorMode(noteId) {
        // 业务逻辑：切换模式状态
        this.app.viewMode = 'editor';
        this.activeNoteId = noteId;

        // 提取笔记标题（用于header显示）
        const noteTitle = noteId.includes('/') ? noteId.substring(noteId.lastIndexOf('/') + 1) : noteId;

        // UI操作：调用UIManager，传入笔记标题
        this.app.uiManager.switchToEditorMode(noteTitle);

        // 业务逻辑：清空Copilot上下文文件标签，并添加当前文档
        this.copilotContextFiles = [];
        if (noteId) {
            this.copilotContextFiles.push(noteId);
        }
        this.renderCopilotContextTags();

        // 业务逻辑：加载笔记内容
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`);
            const content = await response.text();

            // 初始化编辑器
            this.initEditor(content, noteId);
        } catch (error) {
            console.error('加载笔记内容失败:', error);
            this.app.uiManager.showNotification('加载笔记失败: ' + error.message, 'error');
        }

        // 更新笔记列表高亮
        this.renderNoteList();

        // 初始化lucide图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 初始化编辑器
     */
    initEditor(content, noteId) {
        const editorTextarea = document.getElementById('noteEditor');
        const noteTitleEl = document.getElementById('noteTitle');

        if (editorTextarea) {
            editorTextarea.value = content;
            this.editorInstance = editorTextarea;
            // 保存原始内容用于diff比较
            this.activeNoteOriginalContent = content;
        }

        if (noteTitleEl) {
            const note = this.notes.find(n => n.id === noteId);
            noteTitleEl.textContent = note ? note.title : noteId;
        }

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 切换回聊天模式
     */
    switchToChatMode() {
        // 业务逻辑：清除自动保存定时器
        clearTimeout(this.autoSaveTimeout);

        // 业务逻辑：切换模式状态
        this.app.viewMode = 'chat';
        this.activeNoteId = null;
        this.editorInstance = null;

        // UI操作：调用UIManager
        this.app.uiManager.switchToChatMode();
    }

    /**
     * 发送Copilot消息（编辑模式专用）
     */
    async sendCopilotMessage() {
        const copilotInput = document.getElementById('copilotInput');
        const message = copilotInput?.value.trim();

        if (!message || this.app.viewMode !== 'editor') return;

        // 清空输入框
        copilotInput.value = '';

        // 获取编辑器上下文
        const editorContext = {
            noteId: this.activeNoteId,
            fullText: this.editorInstance?.value || '',
            selectedText: '' // 暂不支持选中文本
        };

        // 调用知识库Agent
        await this.app.knowledgeAgentHandler.startReActLoop(message, editorContext);
    }

    /**
     * 保存当前笔记
     */
    async saveActiveNote() {
        if (!this.activeNoteId || !this.editorInstance) {
            this.app.uiManager.showNotification('没有活动的笔记', 'error');
            return;
        }

        const currentContent = this.editorInstance.value;

        // 手动编辑时直接保存，不显示diff
        await this.performActualSave(currentContent);
    }

    /**
     * 执行实际的保存操作
     */
    async performActualSave(content) {
        if (!this.activeNoteId) {
            this.app.uiManager.showNotification('没有活动的笔记', 'error');
            return;
        }

        try {
            const response = await fetch(`http://localhost:8080/api/notes/${this.activeNoteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content })
            });

            if (!response.ok) {
                throw new Error('保存失败');
            }

            this.app.uiManager.showNotification('笔记已保存', 'success');

            // 更新原始内容为当前保存的内容
            this.activeNoteOriginalContent = content;
        } catch (error) {
            console.error('保存笔记失败:', error);
            this.app.uiManager.showNotification('保存失败: ' + error.message, 'error');
        }
    }

    /**
     * 删除笔记或文件夹
     */
    async deleteNoteOrFolder(path, type) {
        const itemName = path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path;
        const confirmMsg = type === 'folder'
            ? `确定要删除文件夹"${itemName}"及其所有内容吗？此操作不可恢复！`
            : `确定要删除文件"${itemName}"吗？此操作不可恢复！`;

        if (!confirm(confirmMsg)) {
            return;
        }

        try {
            const response = await fetch('http://localhost:8080/api/notes/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: path,
                    type: type
                })
            });

            const result = await response.json();

            if (result.success) {
                this.app.uiManager.showNotification('删除成功', 'success');

                // 如果删除的是当前打开的笔记，关闭编辑器
                if (this.activeNoteId && path.includes(this.activeNoteId)) {
                    this.activeNoteId = null;
                    this.editorInstance = null;
                    // 切换回聊天模式
                    this.app.viewMode = 'chat';
                    document.body.classList.remove('view-mode-editor');
                    document.body.classList.add('view-mode-chat');
                    const chatContainer = document.getElementById('chatContainer');
                    const editorContainer = document.getElementById('editor-container');
                    if (chatContainer) chatContainer.classList.remove('hidden');
                    if (editorContainer) editorContainer.classList.add('hidden');
                }

                await this.loadNotes();
            } else {
                this.app.uiManager.showNotification(`删除失败: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('删除失败:', error);
            this.app.uiManager.showNotification('删除失败: ' + error.message, 'error');
        }
    }

    /**
     * 移动笔记或文件夹
     */
    async moveNoteOrFolder(sourcePath, targetFolderPath) {
        try {
            const response = await fetch('http://localhost:8080/api/notes/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    source: sourcePath,
                    destination: targetFolderPath
                })
            });

            const result = await response.json();

            if (result.success) {
                this.app.uiManager.showNotification('移动成功', 'success');
                await this.loadNotes();
            } else {
                this.app.uiManager.showNotification(`移动失败: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('移动文件失败:', error);
            this.app.uiManager.showNotification('移动文件失败: ' + error.message, 'error');
        }
    }

    /**
     * 处理Wiki链接点击
     */
    async handleWikiLinkClick(noteId) {

        // 检查笔记是否存在
        const note = this.notes.find(n => n.id === noteId);
        if (note) {
            // 切换到编辑器模式打开该笔记
            this.switchToEditorMode(noteId);
        } else {
            // 笔记不存在，提示用户
            const confirmed = confirm(`笔记 "${noteId}" 不存在。是否创建新笔记？`);
            if (confirmed) {
                // TODO: 创建新笔记
                this.app.uiManager.showNotification('创建新笔记功能待实现', 'info');
            }
        }
    }

    /**
     * 处理标签点击
     */
    async handleTagClick(tag) {

        // 切换到知识库面板并搜索该标签
        const rightSidebar = document.getElementById('right-sidebar');
        if (rightSidebar && rightSidebar.classList.contains('hidden')) {
            this.app.uiManager.toggleKnowledgeDrawer();
        }

        // 在笔记搜索框中输入 tag:标签名
        const noteSearch = document.getElementById('noteSearch');
        if (noteSearch) {
            noteSearch.value = `tag:${tag}`;
            // 触发搜索
            noteSearch.dispatchEvent(new Event('input'));
        }

        this.app.uiManager.showNotification(`搜索标签: ${tag}`, 'info');
    }

    /**
     * 添加Copilot上下文文件
     */
    addCopilotContextFile(noteId) {
        // 避免重复添加
        if (this.copilotContextFiles.includes(noteId)) {
            this.app.uiManager.showNotification('文件已在上下文中', 'info');
            return;
        }

        this.copilotContextFiles.push(noteId);
        this.renderCopilotContextTags();
        this.app.uiManager.showNotification(`已添加上下文: ${noteId}`, 'success');
    }

    /**
     * 移除Copilot上下文文件
     */
    removeCopilotContextFile(noteId) {
        const index = this.copilotContextFiles.indexOf(noteId);
        if (index > -1) {
            this.copilotContextFiles.splice(index, 1);
            this.renderCopilotContextTags();
            this.app.uiManager.showNotification(`已移除上下文: ${noteId}`, 'info');
        }
    }

    /**
     * 渲染Copilot上下文标签
     */
    renderCopilotContextTags() {
        const tagsContainer = document.getElementById('copilotContextTags');
        if (!tagsContainer) return;

        // 清空容器
        tagsContainer.innerHTML = '';

        if (this.copilotContextFiles.length === 0) {
            tagsContainer.classList.add('hidden');
            return;
        }

        tagsContainer.classList.remove('hidden');

        // 创建标签
        this.copilotContextFiles.forEach(noteId => {
            const tag = document.createElement('div');
            tag.className = 'inline-flex items-center gap-1 px-2 py-1 bg-purple-900 bg-opacity-50 border border-purple-600 rounded text-xs text-purple-300';

            // 提取文件名（最多8个字符）
            const fileName = noteId.includes('/') ? noteId.substring(noteId.lastIndexOf('/') + 1) : noteId;
            const displayName = fileName.length > 8 ? fileName.substring(0, 8) + '...' : fileName;

            tag.innerHTML = `
                <span>@${escapeHtml(displayName)}</span>
                <button class="hover:text-red-400 transition-colors" title="移除" data-note-id="${escapeHtml(noteId)}">
                    <i data-lucide="x" class="w-3 h-3"></i>
                </button>
            `;

            // 移除按钮点击事件
            const removeBtn = tag.querySelector('button');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const noteIdToRemove = removeBtn.dataset.noteId;
                this.removeCopilotContextFile(noteIdToRemove);
            });

            tagsContainer.appendChild(tag);
        });

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 切换编辑器预览模式
     */
    toggleEditorPreview() {
        this.isEditorPreview = !this.isEditorPreview;

        const togglePreviewBtn = document.getElementById('togglePreviewBtn');

        if (this.isEditorPreview) {
            this.notePreview?.show();
            togglePreviewBtn.classList.add('bg-blue-600');
            togglePreviewBtn.classList.remove('bg-gray-700');
            this.updateEditorPreview(); // 立即更新一次
        } else {
            this.notePreview?.hide();
            togglePreviewBtn.classList.remove('bg-blue-600');
            togglePreviewBtn.classList.add('bg-gray-700');
        }
    }

    /**
     * 更新编辑器预览
     */
    updateEditorPreview() {
        if (!this.isEditorPreview || !this.notePreview) return;

        const noteEditor = document.getElementById('noteEditor');
        if (!noteEditor) return;

        const content = noteEditor.value;
        this.notePreview.update(content);
    }

    /**
     * 创建新笔记
     */
    async createNewNote(parentPath = '') {
        const title = prompt('请输入笔记标题:');
        if (!title || !title.trim()) {
            return;
        }

        try {
            // 生成笔记ID（清理文件名）
            const cleanTitle = title.replace(/[\/\\:*?"<>|\s]/g, '_');

            // 如果有父路径，添加到笔记ID前面
            const noteId = parentPath ? `${parentPath}/${cleanTitle}` : cleanTitle;

            // 创建带有YAML Front Matter的初始内容
            const now = new Date().toISOString();
            const initialContent = `---
title: ${title}
created_at: ${now}
updated_at: ${now}
tags: []
---

# ${title}

开始编写你的笔记...
`;

            // 调用后端API创建笔记
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: initialContent })
            });

            if (!response.ok) {
                throw new Error('创建笔记失败');
            }

            this.app.uiManager.showNotification('笔记创建成功', 'success');

            // 重新加载笔记列表
            await this.loadNotes();

            // 打开新创建的笔记
            this.switchToEditorMode(noteId);
        } catch (error) {
            console.error('创建笔记失败:', error);
            this.app.uiManager.showNotification('创建失败: ' + error.message, 'error');
        }
    }

    /**
     * 创建新文件夹
     */
    async createNewFolder(parentPath = '') {
        const folderName = prompt('请输入文件夹名称:');
        if (!folderName || !folderName.trim()) {
            return;
        }

        try {
            // 清理文件夹名
            const cleanFolderName = folderName.replace(/[\/\\:*?"<>|]/g, '_');

            // 如果有父路径，添加到文件夹名前面
            const folderPath = parentPath ? `${parentPath}/${cleanFolderName}` : cleanFolderName;

            // 在文件夹中创建一个.gitkeep文件以确保文件夹被创建
            const placeholderPath = `${folderPath}/.gitkeep`;

            const response = await fetch(`http://localhost:8080/api/notes/${encodeURIComponent(placeholderPath)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: '' })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('服务器返回错误:', errorText);
                throw new Error('创建文件夹失败');
            }

            this.app.uiManager.showNotification('文件夹创建成功', 'success');

            // 重新加载笔记列表
            await this.loadNotes();
        } catch (error) {
            console.error('创建文件夹失败:', error);
            this.app.uiManager.showNotification('创建失败: ' + error.message, 'error');
        }
    }

    /**
     * 显示右键菜单
     */
    showContextMenu(event) {
        // 移除已存在的菜单
        this.hideContextMenu();

        // 获取右键点击的目标元素（文件夹或文件）
        let folderElement = event.target.closest('.folder-node');
        let fileElement = event.target.closest('.file-node');
        let parentPath = '';

        // 如果点击在文件夹上，使用文件夹路径作为父路径
        if (folderElement) {
            parentPath = folderElement.dataset.path || '';
            // 移除.md扩展名（如果有）
            parentPath = parentPath.replace(/\.md$/, '');
        }
        // 如果点击在文件上，使用文件所在目录作为父路径
        else if (fileElement) {
            const filePath = fileElement.dataset.path || '';
            // 移除文件名，保留目录部分
            const lastSlash = filePath.lastIndexOf('/');
            parentPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '';
        }

        // 创建菜单元素
        const menu = document.createElement('div');
        menu.id = 'contextMenu';
        menu.className = 'fixed bg-gray-800 border border-gray-600 rounded-lg shadow-lg py-2 z-[1002]';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;

        // 获取当前点击的目标路径（用于删除）
        let targetPath = '';
        let targetType = '';
        if (folderElement) {
            targetPath = folderElement.dataset.path || '';
            targetType = 'folder';
        } else if (fileElement) {
            targetPath = fileElement.dataset.path || '';
            targetType = 'file';
        }

        // 菜单项
        const menuItems = [
            {
                icon: 'file-plus',
                label: '新建文件',
                handler: () => {
                    this.hideContextMenu();
                    this.createNewNote(parentPath);
                }
            },
            {
                icon: 'folder-plus',
                label: '新建文件夹',
                handler: () => {
                    this.hideContextMenu();
                    this.createNewFolder(parentPath);
                }
            }
        ];

        // 如果点击了具体的文件或文件夹，添加删除选项
        if (targetPath) {
            menuItems.push({
                icon: 'trash-2',
                label: targetType === 'folder' ? '删除文件夹' : '删除文件',
                className: 'text-red-400 hover:bg-red-900',
                handler: () => {
                    this.hideContextMenu();
                    this.deleteNoteOrFolder(targetPath, targetType);
                }
            });
        }

        // 构建菜单HTML
        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            const baseClass = 'px-4 py-2 hover:bg-gray-700 cursor-pointer flex items-center gap-2 text-sm';
            menuItem.className = item.className ? `${baseClass} ${item.className}` : baseClass;
            menuItem.innerHTML = `
                <i data-lucide="${item.icon}" class="w-4 h-4"></i>
                <span>${item.label}</span>
            `;
            menuItem.addEventListener('click', item.handler);
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);

        // 初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }

        // 点击其他地方关闭菜单
        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 0);
    }

    /**
     * 隐藏右键菜单
     */
    hideContextMenu() {
        const menu = document.getElementById('contextMenu');
        if (menu) {
            menu.remove();
        }
    }

    /**
     * 处理编辑器粘贴事件 - 支持粘贴图片
     */
    async handleEditorPaste(event) {
        const items = event.clipboardData?.items;
        if (!items) return;

        // 查找图片类型的数据
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                event.preventDefault(); // 阻止默认粘贴行为

                const file = item.getAsFile();
                if (file) {
                    // 生成基于时间的文件名 MM_DD_HH_MM_SS
                    const now = new Date();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const seconds = String(now.getSeconds()).padStart(2, '0');

                    // 获取文件扩展名
                    const ext = file.name.split('.').pop() || 'png';
                    const newFileName = `${month}_${day}_${hours}_${minutes}_${seconds}.${ext}`;

                    // 创建新的File对象
                    const renamedFile = new File([file], newFileName, { type: file.type });

                    // 调用上传和插入方法
                    await this.uploadAndInsertImage(renamedFile);
                }
                break;
            }
        }
    }

    /**
     * 上传图片并插入到编辑器光标位置
     */
    async uploadAndInsertImage(file) {
        const noteEditor = document.getElementById('noteEditor');
        if (!noteEditor) return;

        // 获取图片存储配置
        const imageStorageMode = this.app.config?.knowledgeBase?.imageStorage?.mode || 'fixed';

        try {
            // 上传图片
            const formData = new FormData();
            formData.append('image', file);
            formData.append('storage_mode', imageStorageMode);
            if (imageStorageMode === 'relative' && this.activeNoteId) {
                formData.append('note_id', this.activeNoteId);
            }

            const response = await fetch('http://localhost:8080/api/notes/upload-image', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('上传失败');
            }

            const result = await response.json();

            // 获取光标位置
            const cursorPos = noteEditor.selectionStart;
            const textBefore = noteEditor.value.substring(0, cursorPos);
            const textAfter = noteEditor.value.substring(cursorPos);

            // 构造Markdown图片语法
            const imageMarkdown = `![${file.name}](${result.filePath})`;

            // 插入图片引用
            noteEditor.value = textBefore + imageMarkdown + textAfter;

            // 设置新的光标位置
            const newCursorPos = cursorPos + imageMarkdown.length;
            noteEditor.setSelectionRange(newCursorPos, newCursorPos);

            // 更新预览
            if (this.isEditorPreview) {
                this.updateEditorPreview();
            }

            this.app.uiManager.showNotification('图片上传成功', 'success');
        } catch (error) {
            console.error('图片上传失败:', error);
            this.app.uiManager.showNotification(`图片上传失败: ${error.message}`, 'error');
        }
    }

    /**
     * 处理编辑器中的图片拖拽上传
     */
    async handleEditorImageDrop(event) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;

        // 遍历所有文件
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // 检查是否是图片
            if (!file.type.startsWith('image/')) {
                this.app.uiManager.showNotification(`文件 ${file.name} 不是图片`, 'warning');
                continue;
            }

            // 调用上传和插入方法
            await this.uploadAndInsertImage(file);
        }
    }

    /**
     * 初始化知识库WebSocket连接
     */
    initNotesWebSocket() {
        const wsUrl = 'ws://localhost:8080/ws/notes';

        const connectWebSocket = () => {
            this.notesWebSocket = new WebSocket(wsUrl);

            this.notesWebSocket.onopen = () => {
            };

            this.notesWebSocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'refresh_notes') {
                        this.loadNotes();
                    }
                } catch (error) {
                    console.error('解析WebSocket消息失败:', error);
                }
            };

            this.notesWebSocket.onerror = (error) => {
                console.error('WebSocket错误:', error);
            };

            this.notesWebSocket.onclose = () => {
                setTimeout(connectWebSocket, 5000);
            };
        };

        connectWebSocket();
    }

    bindEditorEvents() {
        // 返回聊天按钮
        const backToChatBtn = document.getElementById('backToChatBtn');
        if (backToChatBtn) {
            backToChatBtn.addEventListener('click', () => {
                this.switchToChatMode();
            });
        }

        // 保存笔记按钮
        const saveNoteBtn = document.getElementById('saveNoteBtn');
        if (saveNoteBtn) {
            saveNoteBtn.addEventListener('click', () => {
                this.saveActiveNote();
            });
        }

        // 全部回退按钮
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        if (rejectAllChangesBtn) {
            rejectAllChangesBtn.addEventListener('click', () => {
                this.rejectAllChanges();
            });
        }

        // 完成审查按钮
        const finishDiffReviewBtn = document.getElementById('finishDiffReviewBtn');
        if (finishDiffReviewBtn) {
            finishDiffReviewBtn.addEventListener('click', () => {
                this.finishDiffReview();
            });
        }

        // 新建笔记按钮
        const newNoteBtn = document.getElementById('newNoteBtn');
        if (newNoteBtn) {
            newNoteBtn.addEventListener('click', () => {
                this.createNewNote();
            });
        }

        // 新建文件夹按钮
        const newFolderBtn = document.getElementById('newFolderBtn');
        if (newFolderBtn) {
            newFolderBtn.addEventListener('click', () => {
                this.createNewFolder();
            });
        }

        // 知识库抽屉折叠/展开按钮
        const toggleKnowledgeDrawerBtn = document.getElementById('toggleKnowledgeDrawerBtn');
        if (toggleKnowledgeDrawerBtn) {
            toggleKnowledgeDrawerBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.app.uiManager.toggleKnowledgeDrawer();
            });
        }

        const expandKnowledgeDrawerBtn = document.getElementById('expandKnowledgeDrawerBtn');
        if (expandKnowledgeDrawerBtn) {
            expandKnowledgeDrawerBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.app.uiManager.toggleKnowledgeDrawer();
            });
        }

        // Copilot输入框事件
        const copilotInput = document.getElementById('copilotInput');
        const copilotSendBtn = document.getElementById('copilotSendBtn');

        if (copilotSendBtn) {
            copilotSendBtn.addEventListener('click', () => {
                this.sendCopilotMessage();
            });
        }

        if (copilotInput) {
            copilotInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendCopilotMessage();
                }
            });
        }

        // 笔记搜索
        const noteSearch = document.getElementById('noteSearch');
        if (noteSearch) {
            noteSearch.addEventListener('input', (e) => {
                // TODO: 实现笔记搜索
            });
        }

        // 切换预览按钮
        const togglePreviewBtn = document.getElementById('togglePreviewBtn');
        if (togglePreviewBtn) {
            togglePreviewBtn.addEventListener('click', () => {
                this.toggleEditorPreview();
            });
        }

        // Diff视图关闭按钮
        const closeDiffViewBtn = document.getElementById('closeDiffViewBtn');
        if (closeDiffViewBtn) {
            closeDiffViewBtn.addEventListener('click', () => {
                this.closeDiffView();
            });
        }

        // Diff视图取消按钮
        const cancelDiffBtn = document.getElementById('cancelDiffBtn');
        if (cancelDiffBtn) {
            cancelDiffBtn.addEventListener('click', () => {
                this.closeDiffView();
            });
        }

        // Diff视图确认保存按钮
        const confirmSaveBtn = document.getElementById('confirmSaveBtn');
        if (confirmSaveBtn) {
            confirmSaveBtn.addEventListener('click', () => {
                this.finishDiffReview();
            });
        }

        // 笔记列表右键菜单事件
        const notesList = document.getElementById('notesList');
        if (notesList) {
            notesList.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e);
            });

            // 笔记列表拖拽放置事件（用于移动到根目录）
            notesList.addEventListener('dragover', (e) => {
                const targetFolder = e.target.closest('.folder-node');
                const targetFile = e.target.closest('.file-node');

                if (!targetFolder && !targetFile) {
                    e.preventDefault();
                    e.stopPropagation();
                    notesList.style.backgroundColor = 'rgba(139, 92, 246, 0.1)';
                }
            });

            notesList.addEventListener('dragleave', (e) => {
                notesList.style.backgroundColor = '';
            });

            notesList.addEventListener('drop', (e) => {
                const targetFolder = e.target.closest('.folder-node');
                const targetFile = e.target.closest('.file-node');

                if (!targetFolder && !targetFile) {
                    e.preventDefault();
                    e.stopPropagation();
                    notesList.style.backgroundColor = '';

                    const sourcePath = e.dataTransfer.getData('text/plain');
                    if (sourcePath) {
                        this.moveNoteOrFolder(sourcePath, '');
                    }
                }
            });
        }

        // 编辑器输入事件 - 实时更新预览 + 自动保存
        const noteEditor = document.getElementById('noteEditor');
        if (noteEditor) {
            noteEditor.addEventListener('input', () => {
                if (this.isEditorPreview) {
                    clearTimeout(this.previewDebounceTimeout);
                    this.previewDebounceTimeout = setTimeout(() => {
                        this.updateEditorPreview();
                    }, 500);
                }

                clearTimeout(this.autoSaveTimeout);
                this.autoSaveTimeout = setTimeout(() => {
                    this.saveActiveNote();
                }, 5000);
            });

            // 编辑器拖拽上传图片事件
            noteEditor.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                noteEditor.classList.add('drag-over');
            });

            noteEditor.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                noteEditor.classList.remove('drag-over');
            });

            noteEditor.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                noteEditor.classList.remove('drag-over');
                this.handleEditorImageDrop(e);
            });

            // 编辑器右键划词功能
            noteEditor.addEventListener('contextmenu', (e) => {
                const textarea = e.target;
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const selectedText = textarea.value.substring(start, end).trim();

                if (selectedText && selectedText.length > 0) {
                    e.preventDefault(); // 阻止默认右键菜单
                    this.handleEditorContextMenu(e, selectedText);
                }
            });

            // 编辑器粘贴事件 - 支持粘贴图片
            noteEditor.addEventListener('paste', (e) => {
                this.handleEditorPaste(e);
            });
        }

        // Wiki链接和标签点击事件委托
        document.addEventListener('click', (e) => {
            const wikiLink = e.target.closest('.internal-link');
            if (wikiLink) {
                e.preventDefault();
                const noteId = wikiLink.getAttribute('data-note-id');
                if (noteId) {
                    this.handleWikiLinkClick(noteId);
                }
                return;
            }

            const tagLink = e.target.closest('.tag-link');
            if (tagLink) {
                e.preventDefault();
                const tag = tagLink.getAttribute('data-tag');
                if (tag) {
                    this.handleTagClick(tag);
                }
                return;
            }
        });

        // notePreview右键菜单 - 支持图片缩放
        const notePreview = document.getElementById('notePreview');
        if (notePreview) {
            notePreview.addEventListener('contextmenu', (e) => {
                this.handlePreviewContextMenu(e);
            });
        }

        // Copilot输入区域拖拽事件
        const copilotInputArea = document.getElementById('copilotInputArea');
        if (copilotInputArea) {
            copilotInputArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copilotInputArea.style.backgroundColor = 'rgba(139, 92, 246, 0.2)';
            });

            copilotInputArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copilotInputArea.style.backgroundColor = '';
            });

            copilotInputArea.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copilotInputArea.style.backgroundColor = '';

                const filePath = e.dataTransfer.getData('text/plain');
                const itemType = e.dataTransfer.getData('item-type');
                const noteId = e.dataTransfer.getData('note-id');

                if (itemType === 'file' && (filePath || noteId)) {
                    const actualPath = noteId || filePath.replace(/\.md$/, '');
                    this.addCopilotContextFile(actualPath);
                } else if (itemType === 'folder' && filePath) {
                    // TODO: 处理文件夹拖拽
                }
            });
        }
    }

    handleEditorContextMenu(e, selectedText) {
        e.preventDefault();

        this.app.uiManager.showInstructionPrompt((instruction) => {
            if (instruction && this.streamingDiffService) {
                const textarea = this.editorInstance;
                const fullText = textarea.value;
                const selectionStart = textarea.selectionStart;
                const selectionEnd = textarea.selectionEnd;

                // Find the start of the line for selectionStart
                let lineStart = fullText.lastIndexOf('\n', selectionStart - 1) + 1;

                // Find the end of the line for selectionEnd
                let lineEnd = fullText.indexOf('\n', selectionEnd);
                if (lineEnd === -1) {
                    lineEnd = fullText.length;
                }

                const selectedLinesText = fullText.substring(lineStart, lineEnd);

                // 传递完整上下文到 StreamingDiffService
                this.streamingDiffService.startModification(
                    instruction,
                    selectedLinesText,
                    fullText,
                    lineStart,
                    lineEnd
                );
            }
        });
    }

    handlePreviewContextMenu(e) {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText && selectedText.length > 0) {
            e.preventDefault();

            if (!this.app.config || !this.app.config.commands) return;

            const notePreview = document.getElementById('notePreview');
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            this.app.uiManager.showTooltip(
                rect.left + rect.width / 2,
                rect.top - 10,
                selectedText,
                notePreview,
                this.app.config.commands,
                (text, command, element) => this.app.chatManager.handleFollowup(text, command, element)
            );
        }
    }
}

export { NoteManager };

