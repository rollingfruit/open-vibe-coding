/**
 * UI管理器
 * 负责主题切换、通知显示、抽屉折叠等UI相关功能
 * 从 app.js 重构提取
 */

import { escapeHtml } from '../utils/helpers.js';

export class UIManager {
    constructor() {
        this.currentTheme = 'light';
        this.isDrawerCollapsed = false;
    }

    /**
     * 加载主题偏好设置
     */
    loadThemePreference() {
        const savedTheme = localStorage.getItem('theme') || 'light'; // 默认为白天模式
        this.setTheme(savedTheme);
    }

    /**
     * 切换主题
     */
    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    }

    /**
     * 设置主题
     * @param {string} theme - 主题名称 ('light' 或 'dark')
     */
    setTheme(theme) {
        this.currentTheme = theme;

        // 更新 body 类
        if (theme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }

        // 更新按钮图标
        const sunIcon = document.getElementById('sunIcon');
        const moonIcon = document.getElementById('moonIcon');

        if (sunIcon && moonIcon) {
            if (theme === 'light') {
                sunIcon.classList.add('hidden');
                moonIcon.classList.remove('hidden');
            } else {
                sunIcon.classList.remove('hidden');
                moonIcon.classList.add('hidden');
            }
        }

        // 切换代码高亮主题
        const hljsTheme = document.getElementById('hljs-theme');
        if (hljsTheme) {
            if (theme === 'light') {
                hljsTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css';
            } else {
                hljsTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
            }
        }

        // 重新应用代码高亮
        setTimeout(() => {
            if (typeof hljs !== 'undefined') {
                document.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
        }, 100);

        // 持久化存储
        localStorage.setItem('theme', theme);
    }

    /**
     * 显示通知
     * @param {string} message - 通知消息
     * @param {string} type - 通知类型 ('success', 'error', 'info')
     */
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg text-white z-50 animate__animated animate__fadeInRight flex items-center gap-2 ${
            type === 'success' ? 'bg-green-600' :
            type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`;

        const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
        notification.innerHTML = `
            <i data-lucide="${iconName}" class="w-5 h-5"></i>
            <span>${message}</span>
        `;

        document.body.appendChild(notification);

        // Initialize icons for notification
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        setTimeout(() => {
            notification.classList.remove('animate__fadeInRight');
            notification.classList.add('animate__fadeOutRight');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * 切换知识库抽屉
     */
    toggleKnowledgeDrawer() {
        const rightSidebar = document.getElementById('right-sidebar');
        const expandBtn = document.getElementById('expandKnowledgeDrawerBtn');

        if (!rightSidebar) return;

        if (rightSidebar.classList.contains('collapsed')) {
            // 展开
            rightSidebar.classList.remove('collapsed');
            if (expandBtn) expandBtn.classList.add('hidden');
        } else {
            // 折叠
            rightSidebar.classList.add('collapsed');
            if (expandBtn) expandBtn.classList.remove('hidden');
        }

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    /**
     * 切换会话抽屉折叠状态
     * @param {Function} renderCollapsedCallback - 渲染折叠列表的回调函数
     * @param {Function} exitSearchCallback - 退出搜索模式的回调函数
     * @param {Function} renderSessionListCallback - 渲染会话列表的回调函数
     */
    toggleDrawerCollapse(renderCollapsedCallback, exitSearchCallback, renderSessionListCallback) {
        this.isDrawerCollapsed = !this.isDrawerCollapsed;
        const drawer = document.getElementById('sessionDrawer');

        if (this.isDrawerCollapsed) {
            drawer.classList.add('collapsed');
            if (renderCollapsedCallback) {
                renderCollapsedCallback();
            }
        } else {
            drawer.classList.remove('collapsed');
            // 退出搜索模式并重新渲染正常列表
            if (exitSearchCallback) {
                exitSearchCallback();
            }
            if (renderSessionListCallback) {
                renderSessionListCallback();
            }
        }
    }

    /**
     * 渲染折叠状态下的会话图标列表
     * @param {Array} sessions - 会话列表
     * @param {string} activeSessionId - 当前活动会话ID
     * @param {Function} switchSessionCallback - 切换会话的回调函数
     * @param {Function} deleteSessionCallback - 删除会话的回调函数
     */
    renderCollapsedSessionList(sessions, activeSessionId, switchSessionCallback, deleteSessionCallback) {
        const collapsedList = document.getElementById('collapsedSessionList');
        collapsedList.innerHTML = '';

        sessions.slice().reverse().forEach((session, index) => {
            const iconItem = document.createElement('div');
            iconItem.className = `collapsed-session-item ${
                session.id === activeSessionId ? 'active' : ''
            }`;

            // 生成会话图标（取标题首字符或默认图标）
            const iconText = session.title === '新对话' ? '💬' :
                            (session.title.charAt(0) || '💬');

            iconItem.innerHTML = `
                <span class="session-icon">${iconText}</span>
                <div class="delete-btn-collapsed" data-session-id="${session.id}">
                    <i data-lucide="x" class="w-3 h-3"></i>
                </div>
                <div class="tooltip-collapsed">${escapeHtml(session.title)}</div>
            `;

            // 点击切换会话
            iconItem.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-btn-collapsed')) {
                    return;
                }
                if (switchSessionCallback) {
                    switchSessionCallback(session.id);
                }
            });

            // 删除按钮事件
            const deleteBtn = iconItem.querySelector('.delete-btn-collapsed');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (deleteSessionCallback) {
                    deleteSessionCallback(session.id);
                }
            });

            collapsedList.appendChild(iconItem);
        });

        // Reinitialize icons for collapsed list
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
}
