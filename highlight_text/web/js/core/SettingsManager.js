/**
 * 设置管理器
 * 负责设置模态框、指令管理、快捷键管理等
 * 从 app.js 重构提取
 */

import { escapeHtml } from '../utils/helpers.js';

export class SettingsManager {
    constructor(config, settings, app) {
        this.config = config;
        this.settings = settings;
        this.app = app; // 保存app引用，用于调用其他方法
    }

    /**
     * 显示设置模态框
     */
    showSettings() {
        const modal = document.getElementById('settingsModal');

        // 加载LLM配置
        document.getElementById('apiKeyInput').value = this.settings.apiKey;
        document.getElementById('apiEndpointInput').value = this.settings.endpoint;
        document.getElementById('modelSelect').value = this.settings.model;

        // 加载知识库配置
        const imageStorageMode = this.config?.knowledgeBase?.imageStorage?.mode || 'fixed';
        document.getElementById('imageStorageModeSelect').value = imageStorageMode;

        // 加载划词指令配置
        this.renderCommandsList();

        // 加载快捷键配置
        this.renderShortcutsSettings();

        // 加载分类管理配置
        this.renderCategoriesSettings();

        // 绑定标签页切换事件
        this.bindSettingsTabEvents();

        modal.classList.remove('hidden');

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 隐藏设置模态框
     */
    hideSettings() {
        document.getElementById('settingsModal').classList.add('hidden');
    }

    /**
     * 绑定设置标签页切换事件
     */
    bindSettingsTabEvents() {
        const tabButtons = document.querySelectorAll('.settings-tab-btn');
        const panels = document.querySelectorAll('.settings-panel');

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // 移除所有激活状态
                tabButtons.forEach(b => b.classList.remove('bg-gray-700'));
                panels.forEach(p => p.classList.add('hidden'));

                // 激活当前标签
                btn.classList.add('bg-gray-700');
                const tabName = btn.dataset.tab;
                const panelId = `${tabName}SettingsPanel`;
                document.getElementById(panelId).classList.remove('hidden');
            });
        });
    }

    /**
     * 渲染指令列表
     */
    renderCommandsList() {
        const commandsList = document.getElementById('commandsList');
        commandsList.innerHTML = '';

        const commands = this.config?.commands || [];

        commands.forEach((cmd, index) => {
            const cmdItem = document.createElement('div');
            cmdItem.className = 'bg-gray-700 p-3 rounded border border-gray-600';
            cmdItem.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <input
                        type="text"
                        value="${escapeHtml(cmd.label)}"
                        class="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm mr-2 command-label"
                        placeholder="指令标签"
                        data-index="${index}"
                    >
                    <button class="delete-command-btn px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-sm" data-index="${index}">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
                <textarea
                    class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm command-prompt resize-none"
                    placeholder="提示词模板"
                    rows="2"
                    data-index="${index}"
                >${escapeHtml(cmd.prompt)}</textarea>
            `;
            commandsList.appendChild(cmdItem);
        });

        // 绑定删除按钮事件
        document.querySelectorAll('.delete-command-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                this.deleteCommand(index);
            });
        });

        // 绑定添加按钮事件
        const addBtn = document.getElementById('addCommandBtn');
        if (addBtn) {
            addBtn.replaceWith(addBtn.cloneNode(true)); // 移除旧事件
            document.getElementById('addCommandBtn').addEventListener('click', () => {
                this.addCommand();
            });
        }

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 添加指令
     */
    addCommand() {
        if (!this.config.commands) {
            this.config.commands = [];
        }
        this.config.commands.push({
            label: '新指令',
            prompt: ''
        });
        this.renderCommandsList();
    }

    /**
     * 删除指令
     */
    deleteCommand(index) {
        if (confirm('确定要删除这个指令吗？')) {
            this.config.commands.splice(index, 1);
            this.renderCommandsList();
        }
    }

    /**
     * 渲染快捷键设置
     */
    renderShortcutsSettings() {
        const shortcutsList = document.getElementById('shortcutsList');
        shortcutsList.innerHTML = '';

        const shortcuts = this.config?.shortcuts || [];

        shortcuts.forEach((shortcut, index) => {
            this.createShortcutItem(shortcut, index, shortcutsList);
        });

        // 绑定添加按钮
        const addBtn = document.getElementById('addShortcutBtn');
        if (addBtn) {
            addBtn.replaceWith(addBtn.cloneNode(true)); // 移除旧事件
            document.getElementById('addShortcutBtn').addEventListener('click', () => {
                this.addShortcut();
            });
        }

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 创建快捷键项
     */
    createShortcutItem(shortcut, index, container) {
        const shortcutItem = document.createElement('div');
        shortcutItem.className = 'shortcut-item bg-gray-700 p-4 rounded border border-gray-600 space-y-3';

        const typeOptions = `
            <option value="markdown" ${shortcut.type === 'markdown' ? 'selected' : ''}>Markdown模板</option>
            <option value="action" ${shortcut.type === 'action' ? 'selected' : ''}>执行动作</option>
        `;

        shortcutItem.innerHTML = `
            <div class="flex justify-between items-start gap-2">
                <div class="flex-1 grid grid-cols-2 gap-2">
                    <input
                        type="text"
                        value="${escapeHtml(shortcut.key)}"
                        class="shortcut-key bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
                        placeholder="例如: Ctrl+B"
                        readonly
                        data-index="${index}"
                    >
                    <input
                        type="text"
                        value="${escapeHtml(shortcut.description)}"
                        class="shortcut-description bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
                        placeholder="快捷键描述"
                        data-index="${index}"
                    >
                </div>
                <button class="delete-shortcut-btn px-2 py-2 bg-red-600 hover:bg-red-500 rounded text-sm" data-index="${index}">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
            <div>
                <select class="shortcut-type w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" data-index="${index}">
                    ${typeOptions}
                </select>
            </div>
            <div class="shortcut-template-container ${shortcut.type !== 'markdown' ? 'hidden' : ''}">
                <textarea
                    class="shortcut-template w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm resize-none"
                    placeholder="Markdown模板，使用 {{text}} 作为占位符"
                    rows="3"
                    data-index="${index}"
                >${escapeHtml(shortcut.template || '')}</textarea>
            </div>
            <div class="shortcut-action-container ${shortcut.type !== 'action' ? 'hidden' : ''}">
                <input
                    type="text"
                    value="${escapeHtml(shortcut.action || '')}"
                    class="shortcut-action w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
                    placeholder="动作名称，如: copy, paste"
                    data-index="${index}"
                >
            </div>
        `;

        container.appendChild(shortcutItem);

        // 绑定快捷键输入事件
        const keyInput = shortcutItem.querySelector('.shortcut-key');
        keyInput.addEventListener('click', () => {
            keyInput.value = '按下快捷键...';
            const handler = (e) => {
                e.preventDefault();
                const keyString = this.buildShortcutKeyString(e);

                // 检查冲突
                const conflict = this.checkShortcutConflict(keyString, index);
                if (conflict) {
                    alert(`快捷键冲突：${conflict.description} 已使用 ${keyString}`);
                    keyInput.value = shortcut.key;
                } else {
                    keyInput.value = keyString;
                }

                keyInput.removeEventListener('keydown', handler);
            };
            keyInput.addEventListener('keydown', handler);
        });

        // 绑定类型切换事件
        const typeSelect = shortcutItem.querySelector('.shortcut-type');
        typeSelect.addEventListener('change', (e) => {
            const type = e.target.value;
            const templateContainer = shortcutItem.querySelector('.shortcut-template-container');
            const actionContainer = shortcutItem.querySelector('.shortcut-action-container');

            if (type === 'markdown') {
                templateContainer.classList.remove('hidden');
                actionContainer.classList.add('hidden');
            } else {
                templateContainer.classList.add('hidden');
                actionContainer.classList.remove('hidden');
            }
        });

        // 绑定删除按钮
        const deleteBtn = shortcutItem.querySelector('.delete-shortcut-btn');
        deleteBtn.addEventListener('click', () => {
            this.deleteShortcut(index);
        });
    }

    /**
     * 构建快捷键字符串
     */
    buildShortcutKeyString(event) {
        const parts = [];

        // 修饰键
        if (event.ctrlKey || event.metaKey) {
            parts.push('Ctrl');
        }
        if (event.altKey) {
            parts.push('Alt');
        }
        if (event.shiftKey) {
            parts.push('Shift');
        }

        // 主键
        const key = event.key;

        // 特殊键处理
        if (key === ' ') {
            parts.push('Space');
        } else if (key === 'Enter') {
            parts.push('Enter');
        } else if (key === 'Tab') {
            parts.push('Tab');
        } else if (key === 'Escape') {
            parts.push('Esc');
        } else if (key === 'Backspace') {
            parts.push('Backspace');
        } else if (key === 'Delete') {
            parts.push('Delete');
        } else if (key.startsWith('Arrow')) {
            parts.push(key.replace('Arrow', ''));
        } else if (key.length === 1) {
            // 单个字符键
            parts.push(key.toUpperCase());
        } else if (key.startsWith('F') && key.length > 1) {
            // 功能键 F1-F12
            parts.push(key);
        }

        return parts.join('+');
    }

    /**
     * 检查快捷键冲突
     */
    checkShortcutConflict(keyString, currentIndex) {
        const shortcuts = this.config?.shortcuts || [];

        for (let i = 0; i < shortcuts.length; i++) {
            if (i === currentIndex) continue; // 跳过自己

            if (shortcuts[i].key === keyString) {
                return shortcuts[i];
            }
        }

        return null;
    }

    /**
     * 添加快捷键
     */
    addShortcut() {
        if (!this.config.shortcuts) {
            this.config.shortcuts = [];
        }
        this.config.shortcuts.push({
            key: 'Ctrl+',
            description: '新快捷键',
            type: 'markdown',
            template: ''
        });
        this.renderShortcutsSettings();
    }

    /**
     * 删除快捷键
     */
    deleteShortcut(index) {
        if (confirm('确定要删除这个快捷键吗？')) {
            this.config.shortcuts.splice(index, 1);
            this.renderShortcutsSettings();
        }
    }

    /**
     * 渲染分类管理
     */
    renderCategoriesSettings() {
        const categoriesList = document.getElementById('categoriesList');
        categoriesList.innerHTML = '';

        const categories = this.app.settings.categories || [];

        categories.forEach((category, index) => {
            const catItem = document.createElement('div');
            catItem.className = 'category-item flex items-center gap-3 bg-gray-700 p-3 rounded border border-gray-600';
            catItem.innerHTML = `
                <input type="color" value="${escapeHtml(category.color)}" class="category-color p-1 h-10 w-10 bg-gray-800 rounded cursor-pointer" data-index="${index}">
                <input type="text" value="${escapeHtml(category.name)}" class="category-name flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm" placeholder="分类名称" data-index="${index}">
                <input type="text" value="${escapeHtml(category.id)}" class="category-id w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm" placeholder="ID" data-index="${index}" ${category.id === 'default' ? 'readonly' : ''}>
                <button class="delete-category-btn px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-sm" data-index="${index}" ${category.id === 'default' ? 'disabled' : ''}>
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            `;
            categoriesList.appendChild(catItem);
        });

        // 绑定删除按钮事件
        document.querySelectorAll('.delete-category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                this.deleteCategory(index);
            });
        });

        // 绑定添加按钮事件
        const addBtn = document.getElementById('addCategoryBtn');
        addBtn.replaceWith(addBtn.cloneNode(true)); // 移除旧事件
        document.getElementById('addCategoryBtn').addEventListener('click', () => {
            this.addCategory();
        });

        // 重新初始化图标
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 添加分类
     */
    addCategory() {
        const newId = `cat_${Date.now()}`;
        this.app.settings.categories.push({
            id: newId,
            name: '新分类',
            color: '#808080'
        });
        this.renderCategoriesSettings();
    }

    /**
     * 删除分类
     */
    deleteCategory(index) {
        if (this.app.settings.categories[index].id === 'default') {
            alert('不能删除默认分类。');
            return;
        }
        if (confirm('确定要删除这个分类吗？')) {
            this.app.settings.categories.splice(index, 1);
            this.renderCategoriesSettings();
        }
    }

    /**
     * 从UI收集分类数据
     */
    collectCategoriesFromUI() {
        const categoryItems = document.querySelectorAll('#categoriesList .category-item');
        const newCategories = Array.from(categoryItems).map(item => {
            const name = item.querySelector('.category-name').value;
            const color = item.querySelector('.category-color').value;
            const id = item.querySelector('.category-id').value;
            return { id, name, color };
        });
        return newCategories;
    }

    /**
     * 从模态框保存设置
     */
    async saveSettingsFromModal() {
        // 保存LLM配置到localStorage
        this.settings.apiKey = document.getElementById('apiKeyInput').value;
        this.settings.endpoint = document.getElementById('apiEndpointInput').value;
        this.settings.model = document.getElementById('modelSelect').value;
        
        // 保存分类配置
        this.settings.categories = this.collectCategoriesFromUI();

        this.app.saveSettings();

        // 保存划词指令配置
        const commandLabels = document.querySelectorAll('.command-label');
        const commandPrompts = document.querySelectorAll('.command-prompt');

        this.config.commands = Array.from(commandLabels).map((label, index) => ({
            label: label.value,
            prompt: commandPrompts[index].value
        }));

        // 保存知识库配置
        if (!this.config.knowledgeBase) {
            this.config.knowledgeBase = {};
        }
        if (!this.config.knowledgeBase.imageStorage) {
            this.config.knowledgeBase.imageStorage = {};
        }
        this.config.knowledgeBase.imageStorage.mode = document.getElementById('imageStorageModeSelect').value;

        // 保存快捷键配置
        const shortcutItems = document.querySelectorAll('.shortcut-item');
        this.config.shortcuts = Array.from(shortcutItems).map(item => {
            const key = item.querySelector('.shortcut-key').value;
            const description = item.querySelector('.shortcut-description').value;
            const type = item.querySelector('.shortcut-type').value;
            const template = item.querySelector('.shortcut-template')?.value;
            const action = item.querySelector('.shortcut-action')?.value;

            return {
                key,
                description,
                type,
                template: type === 'markdown' ? template : undefined,
                action: type === 'action' ? action : undefined
            };
        }).filter(s => s.key && s.description); // 过滤掉空项

        // 将配置保存到config.json
        try {
            const response = await fetch('http://localhost:8080/api/save-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(this.config)
            });

            if (!response.ok) {
                throw new Error('保存配置失败');
            }

            // 更新快捷键管理器
            if (this.app.shortcutManager) {
                this.app.shortcutManager.loadSettings(this.config.shortcuts);
            }

            // 更新TaskAgentHandler中的分类
            if (this.app.workspace) {
                this.app.workspace.taskAgentHandler.updateCategories(this.settings.categories);
            }

            this.hideSettings();
            this.app.uiManager.showNotification('设置已保存', 'success');
        } catch (error) {
            console.error('保存配置失败:', error);
            this.app.uiManager.showNotification('保存配置失败: ' + error.message, 'error');
        }
    }
}
