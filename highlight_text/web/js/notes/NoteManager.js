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
        this.diffViewer = null;
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

        // UI操作：调用UIManager
        this.app.uiManager.switchToEditorMode();

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

        const notePreview = document.getElementById('notePreview');
        const togglePreviewBtn = document.getElementById('togglePreviewBtn');

        if (this.isEditorPreview) {
            // 显示预览
            notePreview.classList.remove('hidden');
            togglePreviewBtn.classList.add('bg-blue-600');
            togglePreviewBtn.classList.remove('bg-gray-700');

            // 立即更新预览内容
            this.updateEditorPreview();
        } else {
            // 隐藏预览
            notePreview.classList.add('hidden');
            togglePreviewBtn.classList.remove('bg-blue-600');
            togglePreviewBtn.classList.add('bg-gray-700');
        }
    }

    /**
     * 更新编辑器预览
     */
    updateEditorPreview() {
        if (!this.isEditorPreview) return;

        const noteEditor = document.getElementById('noteEditor');
        const notePreview = document.getElementById('notePreview');

        if (!noteEditor || !notePreview) return;

        const content = noteEditor.value;

        // 使用formatMessage渲染Markdown
        const html = this.app.formatMessage(content);
        notePreview.innerHTML = html;

        // 为预览中的图片设置宽度（从URL的#zoom参数读取，或使用默认60%）
        notePreview.querySelectorAll('img').forEach(img => {
            // 检查图片src是否包含#zoom参数
            const src = img.src;
            const zoomMatch = src.match(/#zoom=(\d+)/);

            if (zoomMatch) {
                // 如果有zoom参数，使用该值
                img.style.width = `${zoomMatch[1]}%`;
            } else if (!img.style.width) {
                // 否则使用默认值
                img.style.width = '60%';
            }
        });

        // 重新添加复制按钮和代码高亮
        this.app.addCopyButtons();

        // 重新初始化代码高亮
        if (typeof hljs !== 'undefined') {
            notePreview.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
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
     * 准备流式Diff渲染（隐藏编辑器，显示Diff容器）
     * @param {string} originalContent - 原始内容
     */
    async prepareForStreaming(originalContent) {

        const noteEditor = document.getElementById('noteEditor');
        const notePreview = document.getElementById('notePreview');

        if (!noteEditor) {
            console.error('编辑器未找到');
            return;
        }

        // ✨ 保存原始内容作为Diff基准（如果还没保存的话）
        if (this.contentBeforeLLMUpdate === null || this.contentBeforeLLMUpdate === undefined) {
            this.contentBeforeLLMUpdate = originalContent;
        }

        // 隐藏编辑器和预览
        noteEditor.classList.add('hidden');
        if (notePreview) {
            notePreview.classList.add('hidden');
        }

        // 查找或创建流式Diff容器
        let streamingDiffContainer = document.getElementById('streamingDiffContainer');
        if (!streamingDiffContainer) {
            streamingDiffContainer = document.createElement('div');
            streamingDiffContainer.id = 'streamingDiffContainer';
            streamingDiffContainer.className = noteEditor.className.replace('hidden', ''); // 继承编辑器样式
            streamingDiffContainer.style.overflowY = 'auto';
            streamingDiffContainer.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
            streamingDiffContainer.style.fontSize = '13px';
            noteEditor.parentNode.insertBefore(streamingDiffContainer, noteEditor.nextSibling);
        }

        streamingDiffContainer.classList.remove('hidden');
        streamingDiffContainer.innerHTML = '<div class="p-4 text-gray-400">🌊 正在流式生成内容...</div>';

    }

    /**
     * 完成流式Diff渲染（更新编辑器，隐藏Diff容器）
     * @param {string} noteId - 笔记ID
     * @param {string} finalContent - 最终内容
     * @param {string} originalContent - 原始内容
     */
    async finalizeStreaming(noteId, finalContent, originalContent) {

        const noteEditor = document.getElementById('noteEditor');
        const streamingDiffContainer = document.getElementById('streamingDiffContainer');

        if (!noteEditor) {
            console.error('编辑器未找到');
            return;
        }

        // 更新编辑器内容
        noteEditor.value = finalContent;
        this.activeNoteOriginalContent = finalContent;

        // 保存到后端
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${noteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: finalContent })
            });

            if (!response.ok) {
                throw new Error('保存失败');
            }

        } catch (error) {
            console.error('保存失败:', error);
            this.app.uiManager.showNotification('保存失败: ' + error.message, 'error');
        }

        // 隐藏Diff容器，显示编辑器
        if (streamingDiffContainer) {
            streamingDiffContainer.classList.add('hidden');
        }
        noteEditor.classList.remove('hidden');

        // 如果在预览模式，更新预览
        if (this.isEditorPreview) {
            this.updateEditorPreview();
            const notePreview = document.getElementById('notePreview');
            if (notePreview) {
                notePreview.classList.remove('hidden');
            }
        }

        // 显示回退按钮
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        if (rejectAllChangesBtn) {
            rejectAllChangesBtn.classList.remove('hidden');
        }

        this.app.uiManager.showNotification('内容改写完成', 'success');
    }

    /**
     * 直接更新编辑器内容（在 noteEditor 位置内联显示 Diff）
     * @param {string} noteId - 笔记ID
     * @param {string} newContent - 新内容
     * @param {Array} diffData - Diff数据（用于回退功能）
     */
    async updateEditorContentDirectly(noteId, newContent, diffData) {

        // 确保在编辑器模式
        if (this.app.viewMode !== 'editor' || this.activeNoteId !== noteId) {
            await this.switchToEditorMode(noteId);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const noteEditor = document.getElementById('noteEditor');
        if (!noteEditor) {
            console.error('❌ 编辑器未找到');
            return;
        }

        // ✨ 关键：如果这是 Agent 的第一次修改，保存初始内容
        if (this.contentBeforeLLMUpdate === null || this.contentBeforeLLMUpdate === undefined) {
            this.contentBeforeLLMUpdate = noteEditor.value;
            console.log('📌 保存初始内容作为 Diff 基准', {
                length: this.contentBeforeLLMUpdate.length
            });
        }

        // ✨ 使用 DiffViewer 显示累积 Diff
        this.diffViewer.show({
            originalContent: this.contentBeforeLLMUpdate,
            newContent: newContent,
            onUpdate: (updatedContent) => {
                noteEditor.value = updatedContent;
                this.activeNoteOriginalContent = updatedContent;
                this.saveActiveNote();
            },
            onClose: () => {
            }
        });

        // 直接应用更改（不阻塞）
        noteEditor.value = newContent;
        this.activeNoteOriginalContent = newContent;

        // 如果在预览模式，更新预览
        if (this.isEditorPreview) {
            this.updateEditorPreview();
        }

        // 显示"全部回退"按钮
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        if (rejectAllChangesBtn) {
            rejectAllChangesBtn.classList.remove('hidden');
        }

        // 隐藏"完成审查"按钮（不再需要）
        const finishDiffReviewBtn = document.getElementById('finishDiffReviewBtn');
        if (finishDiffReviewBtn) {
            finishDiffReviewBtn.classList.add('hidden');
        }

    }

    /**
     * 在编辑器位置显示内联 Diff 视图（带手动应用按钮）
     * @param {HTMLElement} noteEditor - 编辑器元素
     * @param {Array} diffData - Diff 数据
     * @param {string} newContent - 新内容
     * @returns {Promise<boolean>} - 是否应用更改
     */
    async showInlineDiffInEditor(noteEditor, diffData, newContent) {

        return new Promise((resolve) => {
            // 隐藏编辑器
            noteEditor.classList.add('hidden');

            // 查找或创建内联 Diff 容器
            let inlineDiffContainer = document.getElementById('inlineDiffContainer');
            if (!inlineDiffContainer) {
                inlineDiffContainer = document.createElement('div');
                inlineDiffContainer.id = 'inlineDiffContainer';
                inlineDiffContainer.className = noteEditor.className.replace('hidden', '');
                noteEditor.parentNode.insertBefore(inlineDiffContainer, noteEditor.nextSibling);
            }

            inlineDiffContainer.classList.remove('hidden');
            inlineDiffContainer.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
            inlineDiffContainer.style.fontSize = '13px';
            inlineDiffContainer.style.position = 'relative';
            inlineDiffContainer.innerHTML = '';

            // 添加顶部操作栏
            const actionBar = document.createElement('div');
            actionBar.className = 'sticky top-0 z-10 bg-gray-800 border-b border-gray-700 p-3 flex items-center justify-between';
            actionBar.innerHTML = `
                <div class="flex items-center gap-2">
                    <i data-lucide="git-compare" class="w-5 h-5 text-blue-400"></i>
                    <span class="text-sm font-semibold text-blue-400">正在查看更改</span>
                    <span class="text-xs text-gray-400">(${diffData.filter(l => l.type !== 'unchanged').length} 处修改)</span>
                </div>
                <div class="flex items-center gap-2">
                    <button id="applyDiffBtn" class="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition">
                        <i data-lucide="check" class="w-4 h-4 inline mr-1"></i>
                        应用更改
                    </button>
                    <button id="cancelDiffBtn" class="px-4 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded transition">
                        <i data-lucide="x" class="w-4 h-4 inline mr-1"></i>
                        取消
                    </button>
                </div>
            `;
            inlineDiffContainer.appendChild(actionBar);

            // 创建滚动容器
            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'overflow-y-auto';
            scrollContainer.style.maxHeight = 'calc(100vh - 200px)';

            // 渲染 Diff 内容
            diffData.forEach(line => {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'leading-6 py-1 px-3';

                if (line.type === 'removed') {
                    lineDiv.classList.add('bg-red-900', 'bg-opacity-20', 'border-l-4', 'border-red-500');
                    lineDiv.innerHTML = `<span class="text-red-300 line-through opacity-80">${escapeHtml(line.content)}</span>`;
                } else if (line.type === 'added') {
                    lineDiv.classList.add('bg-green-900', 'bg-opacity-20', 'border-l-4', 'border-green-500');
                    lineDiv.innerHTML = `<span class="text-green-300">${escapeHtml(line.content)}</span>`;
                } else if (line.type === 'modified') {
                    // 修改的行显示为旧内容（红色）+ 新内容（绿色），并高亮字符级差异
                    const oldContent = line.oldContent || '';
                    const newContent = line.content || '';

                    const oldLineDiv = document.createElement('div');
                    oldLineDiv.className = 'leading-6 py-1 px-3 bg-red-900 bg-opacity-20 border-l-4 border-red-500';
                    // 使用字符级diff，只显示删除部分
                    const oldDiff = this.computeInlineDiffWithDeepHighlight(oldContent, newContent, 'old');
                    oldLineDiv.innerHTML = oldDiff;
                    scrollContainer.appendChild(oldLineDiv);

                    const newLineDiv = document.createElement('div');
                    newLineDiv.className = 'leading-6 py-1 px-3 bg-green-900 bg-opacity-20 border-l-4 border-green-500';
                    // 使用字符级diff，只显示新增部分
                    const newDiff = this.computeInlineDiffWithDeepHighlight(oldContent, newContent, 'new');
                    newLineDiv.innerHTML = newDiff;
                    scrollContainer.appendChild(newLineDiv);
                    return; // 已经添加了两行，跳过后面的 appendChild
                } else {
                    lineDiv.classList.add('bg-gray-800', 'bg-opacity-10');
                    lineDiv.innerHTML = `<span class="text-gray-300">${escapeHtml(line.content)}</span>`;
                }

                scrollContainer.appendChild(lineDiv);
            });

            inlineDiffContainer.appendChild(scrollContainer);

            // 初始化图标
            if (window.lucide) {
                lucide.createIcons();
            }

            // 绑定按钮事件
            const applyBtn = document.getElementById('applyDiffBtn');
            const cancelBtn = document.getElementById('cancelDiffBtn');

            const cleanupAndResolve = (shouldApply) => {
                // 隐藏 Diff 容器，显示编辑器
                inlineDiffContainer.classList.add('hidden');
                noteEditor.classList.remove('hidden');

                if (shouldApply) {
                    // 应用更改
                    noteEditor.value = newContent;
                    this.activeNoteOriginalContent = newContent;
                }

                resolve(shouldApply);
            };

            applyBtn.addEventListener('click', () => cleanupAndResolve(true));
            cancelBtn.addEventListener('click', () => cleanupAndResolve(false));

        });
    }

    /**
     * 完成diff审查
     */
    async finishDiffReview() {
        this.closeDiffView();
        this.app.uiManager.showNotification('审查完成', 'success');
    }

    /**
     * 全部回退变更
     */
    async rejectAllChanges() {
        if (!confirm('确定要回退所有变更吗？这将恢复到修改前的状态。')) {
            return;
        }


        // 优先使用保存的修改前内容
        let originalContent = this.contentBeforeLLMUpdate;

        // 如果没有保存的内容，从diffData中提取原始内容
        if (!originalContent && this.currentDiffData) {
            const originalLines = [];
            this.currentDiffData.forEach(line => {
                if (line.type === 'removed' || line.type === 'unchanged') {
                    originalLines.push(line.content);
                } else if (line.type === 'modified') {
                    originalLines.push(line.oldContent);
                }
                // added类型的行不包含在原始内容中
            });
            originalContent = originalLines.join('\n');
        }

        if (!originalContent) {
            this.app.uiManager.showNotification('无法找到原始内容', 'error');
            return;
        }

        // 保存回后端
        try {
            const response = await fetch(`http://localhost:8080/api/notes/${this.activeNoteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: originalContent })
            });

            if (!response.ok) {
                throw new Error('回退失败');
            }

            // 更新编辑器
            const noteEditor = document.getElementById('noteEditor');
            if (noteEditor) {
                noteEditor.value = originalContent;
                this.activeNoteOriginalContent = originalContent;
            }

            // 隐藏回退按钮
            const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
            if (rejectAllChangesBtn) {
                rejectAllChangesBtn.classList.add('hidden');
            }

            // 清除保存的状态
            this.contentBeforeLLMUpdate = null;
            this.currentDiffData = null;

            this.app.uiManager.showNotification('已回退所有变更', 'success');
            this.closeDiffView();
        } catch (error) {
            console.error('回退失败:', error);
            this.app.uiManager.showNotification('回退失败: ' + error.message, 'error');
        }
    }

    /**
     * 关闭Diff视图
     */
    closeDiffView() {
        const noteEditor = document.getElementById('noteEditor');
        const notePreview = document.getElementById('notePreview');
        const noteDiffViewer = document.getElementById('noteDiffViewer');
        const inlineDiffContainer = document.getElementById('inlineDiffContainer');

        // 隐藏旧的diff视图
        if (noteDiffViewer) noteDiffViewer.classList.add('hidden');

        // 隐藏内联diff容器
        if (inlineDiffContainer) inlineDiffContainer.classList.add('hidden');

        // 显示编辑器
        if (noteEditor) noteEditor.classList.remove('hidden');

        // 恢复预览状态
        if (this.isEditorPreview && notePreview) {
            notePreview.classList.remove('hidden');
        }

        // 恢复顶部按钮状态
        const rejectAllChangesBtn = document.getElementById('rejectAllChangesBtn');
        const finishDiffReviewBtn = document.getElementById('finishDiffReviewBtn');
        const saveNoteBtn = document.getElementById('saveNoteBtn');
        const togglePreviewBtn = document.getElementById('togglePreviewBtn');

        if (rejectAllChangesBtn) rejectAllChangesBtn.classList.add('hidden');
        if (finishDiffReviewBtn) finishDiffReviewBtn.classList.add('hidden');
        if (saveNoteBtn) saveNoteBtn.classList.remove('hidden');
        if (togglePreviewBtn) togglePreviewBtn.classList.remove('hidden');
    }

    /**
     * 计算字符级diff，使用更深的颜色高亮差异部分
     * @param {string} oldText - 旧文本
     * @param {string} newText - 新文本
     * @param {string} mode - 'old' 显示旧版本（红色行），'new' 显示新版本（绿色行）
     */
    computeInlineDiffWithDeepHighlight(oldText, newText, mode = 'new') {
        // 防御性编程：确保输入不为 null 或 undefined
        const safeOldText = oldText || '';
        const safeNewText = newText || '';

        if (typeof diff_match_patch === 'undefined') {
            console.warn('diff_match_patch未加载，使用简单显示');
            const text = mode === 'old' ? safeOldText : safeNewText;
            const color = mode === 'old' ? 'text-red-300' : 'text-green-300';
            return `<span class="${color}">${escapeHtml(text)}</span>`;
        }

        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(safeOldText, safeNewText);
        dmp.diff_cleanupSemantic(diffs);

        let html = '';

        if (mode === 'old') {
            // 红色行：显示旧内容，用深红色背景高亮被删除的字符
            diffs.forEach(([type, text]) => {
                const escaped = escapeHtml(text);
                if (type === -1) {
                    // 被删除的字符：深红色背景 + 删除线 + 更亮的文字
                    html += `<span class="line-through" style="background-color: rgba(239, 68, 68, 0.5); color: #fecaca; font-weight: 700; text-shadow: 0 0 1px rgba(254, 202, 202, 0.5);">${escaped}</span>`;
                } else if (type === 0) {
                    // 不变的字符：更亮的红色
                    html += `<span style="color: #fca5a5;">${escaped}</span>`;
                }
                // type === 1 (新增) 在旧版本行中不显示
            });
        } else {
            // 绿色行：显示新内容，用深绿色背景高亮新增的字符
            diffs.forEach(([type, text]) => {
                const escaped = escapeHtml(text);
                if (type === 1) {
                    // 新增的字符：深绿色背景 + 加粗 + 更亮的文字
                    html += `<span style="background-color: rgba(34, 197, 94, 0.5); color: #bbf7d0; font-weight: 700; text-shadow: 0 0 1px rgba(187, 247, 208, 0.5);">${escaped}</span>`;
                } else if (type === 0) {
                    // 不变的字符：更亮的绿色
                    html += `<span style="color: #86efac;">${escaped}</span>`;
                }
                // type === -1 (删除) 在新版本行中不显示
            });
        }

        return html;
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
}

export { NoteManager };

