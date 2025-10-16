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
        this.isFocusMode = false;
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

    /**
     * 渲染会话列表
     * @param {Array} sessions - 会话列表
     * @param {string} activeSessionId - 当前活动会话ID
     * @param {Function} switchSessionCallback - 切换会话的回调函数
     * @param {Function} deleteSessionCallback - 删除会话的回调函数
     */
    renderSessionList(sessions, activeSessionId, switchSessionCallback, deleteSessionCallback) {
        if (this.isDrawerCollapsed) {
            this.renderCollapsedSessionList(sessions, activeSessionId, switchSessionCallback, deleteSessionCallback);
            return;
        }

        const sessionList = document.getElementById('sessionList');
        sessionList.innerHTML = '';

        sessions.slice().reverse().forEach(session => {
            const listItem = document.createElement('li');
            listItem.className = `session-item cursor-pointer p-3 rounded hover:bg-gray-700 transition-colors ${
                session.id === activeSessionId ? 'bg-blue-600' : ''
            }`;

            listItem.innerHTML = `
                <div class="flex justify-between items-start">
                    <div class="flex-1 min-w-0">
                        <div class="session-title font-medium text-sm truncate">${escapeHtml(session.title)}</div>
                        <div class="session-info text-xs text-gray-400 mt-1 flex items-center gap-2">
                            <span class="flex items-center gap-1">
                                <i data-lucide="message-circle" class="w-3 h-3"></i>
                                <span>${session.messages.length}</span>
                            </span>
                            <span class="flex items-center gap-1">
                                <i data-lucide="clock" class="w-3 h-3"></i>
                                <span>${new Date(session.updatedAt).toLocaleDateString()}</span>
                            </span>
                        </div>
                    </div>
                    <button class="delete-session-btn opacity-0 transition-opacity duration-200 text-gray-400 hover:text-red-400 p-1"
                            data-session-id="${session.id}"
                            title="删除会话">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            `;

            // 点击会话项切换会话
            listItem.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，不执行切换
                if (e.target.classList.contains('delete-session-btn')) {
                    return;
                }
                if (switchSessionCallback) {
                    switchSessionCallback(session.id);
                }
            });

            // 悬浮显示删除按钮
            listItem.addEventListener('mouseenter', () => {
                const deleteBtn = listItem.querySelector('.delete-session-btn');
                deleteBtn.classList.remove('opacity-0');
                deleteBtn.classList.add('opacity-100');
            });

            listItem.addEventListener('mouseleave', () => {
                const deleteBtn = listItem.querySelector('.delete-session-btn');
                deleteBtn.classList.remove('opacity-100');
                deleteBtn.classList.add('opacity-0');
            });

            // 删除按钮事件
            const deleteBtn = listItem.querySelector('.delete-session-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (deleteSessionCallback) {
                    deleteSessionCallback(session.id);
                }
            });

            sessionList.appendChild(listItem);
        });

        // Reinitialize icons for session list
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    /**
     * 更新Token使用情况UI
     * @param {Object} tokenData - Token数据 {currentTokens, maxTokens, hasSummary}
     */
    updateTokenUsage(tokenData) {
        const { currentTokens, maxTokens, hasSummary } = tokenData;

        // 计算百分比
        const percentage = Math.min(100, Math.round((currentTokens / maxTokens) * 100));

        // 更新UI
        const tokenPercentage = document.getElementById('tokenPercentage');
        const tokenProgressCircle = document.getElementById('tokenProgressCircle');
        const tokenIndicator = document.getElementById('tokenIndicator');
        const compressBtn = document.getElementById('compressContextBtn');

        if (tokenPercentage && tokenProgressCircle && tokenIndicator && compressBtn) {
            tokenPercentage.textContent = `${percentage}%`;

            // 计算圆形进度条的stroke-dashoffset
            const circumference = 2 * Math.PI * 16; // 半径为16
            const offset = circumference - (percentage / 100) * circumference;
            tokenProgressCircle.style.strokeDashoffset = offset;

            // 根据百分比改变颜色
            tokenIndicator.classList.remove('warning', 'danger');
            if (percentage >= 80) {
                tokenIndicator.classList.add('danger');
                // 显示压缩按钮（仅当未压缩过）
                if (!hasSummary) {
                    compressBtn.classList.remove('hidden');
                } else {
                    compressBtn.classList.add('hidden');
                }
            } else if (percentage >= 60) {
                tokenIndicator.classList.add('warning');
                compressBtn.classList.add('hidden');
            } else {
                compressBtn.classList.add('hidden');
            }
        }
    }

    /**
     * 显示上下文摘要
     * @param {string} summary - 摘要内容
     */
    showSummary(summary) {
        const summaryContainer = document.getElementById('summaryContainer');
        const summaryContent = document.getElementById('summaryContent');

        if (summaryContainer && summaryContent) {
            summaryContent.innerHTML = escapeHtml(summary).replace(/\n/g, '<br>');
            summaryContainer.classList.remove('hidden');
        }
    }

    /**
     * 隐藏上下文摘要
     */
    hideSummary() {
        const summaryContainer = document.getElementById('summaryContainer');
        if (summaryContainer) {
            summaryContainer.classList.add('hidden');
        }
    }

    /**
     * 显示划词工具提示
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {string} selectedText - 选中的文本
     * @param {Element} messageElement - 消息元素
     * @param {Array} commands - 命令列表
     * @param {Function} handleFollowupCallback - 处理追问的回调函数
     */
    showTooltip(x, y, selectedText, messageElement, commands, handleFollowupCallback) {
        this.hideTooltip();

        if (!commands) {
            return;
        }

        const template = document.getElementById('tooltipTemplate');
        if (!template) {
            return;
        }

        // 保存当前选区，用于后续恢复
        const selection = window.getSelection();
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

        const tooltip = template.content.cloneNode(true).querySelector('.tooltip');
        const buttonsContainer = tooltip.querySelector('div.flex.flex-wrap');
        const customInput = tooltip.querySelector('.custom-prompt-input');
        const customButton = tooltip.querySelector('.custom-prompt-btn');

        // 根据配置生成快捷按钮
        commands.forEach(command => {
            const button = document.createElement('button');
            button.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm whitespace-nowrap';
            button.textContent = command.label;
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                if (handleFollowupCallback) {
                    handleFollowupCallback(selectedText, command, messageElement);
                }
                this.hideTooltip();
            });
            buttonsContainer.appendChild(button);
        });

        // 处理自定义输入框
        const handleCustomPrompt = () => {
            const customPrompt = customInput.value.trim();
            if (customPrompt) {
                const customCommand = {
                    label: '自定义',
                    prompt: customPrompt + '\n'
                };
                if (handleFollowupCallback) {
                    handleFollowupCallback(selectedText, customCommand, messageElement);
                }
                this.hideTooltip();
            }
        };

        customButton.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCustomPrompt();
        });

        customInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                handleCustomPrompt();
            }
        });

        // 阻止输入框点击事件冒泡
        customInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 计算tooltip位置，确保在视窗内
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const tooltipWidth = 300; // 预估宽度
        const tooltipHeight = 50; // 预估高度

        let finalX = Math.min(x, viewportWidth - tooltipWidth);
        let finalY = Math.max(y - tooltipHeight - 10, 10);

        // 如果在顶部空间不够，显示在下方
        if (finalY < 10) {
            finalY = y + 20;
        }

        // 定位tooltip
        tooltip.style.position = 'fixed';
        tooltip.style.left = finalX + 'px';
        tooltip.style.top = finalY + 'px';
        tooltip.style.zIndex = '1000';
        tooltip.id = 'activeTooltip';

        document.body.appendChild(tooltip);

        // 自动聚焦到输入框，同时恢复文本选中状态
        setTimeout(() => {
            // 恢复notePreview的文本选中状态
            if (range) {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }

            // 聚焦到输入框
            const activeInput = document.querySelector('#activeTooltip .custom-prompt-input');
            if (activeInput) {
                activeInput.focus();
            }
        }, 50);

    }

    /**
     * 隐藏工具提示
     */
    hideTooltip() {
        const tooltip = document.getElementById('activeTooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }

    /**
     * 创建追问模态框
     * @returns {Element} 模态框元素
     */
    createFollowupModal() {
        const template = document.getElementById('followupModalTemplate');
        const modal = template.content.cloneNode(true).querySelector('.followup-modal');

        modal.querySelector('.close-followup').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        return modal;
    }

    /**
     * 渲染节点轴
     * @param {Array} messages - 消息列表
     */
    renderNodeAxis(messages) {
        const svg = document.getElementById('nodeAxisSvg');

        if (!svg) return;

        // 如果没有消息，清空SVG
        if (!messages || messages.length === 0) {
            svg.innerHTML = '';
            svg.setAttribute('height', '0');
            return;
        }

        const nodeSpacing = 40; // 节点间距
        const userNodeRadius = 7; // 用户节点半径（大圆）
        const aiNodeRadius = 5; // AI节点半径（小圆）
        const clickAreaRadius = 12; // 点击区域半径
        const startX = 30; // 起始X位置
        const startY = 20; // 起始Y位置
        const branchLength = 20; // 分叉长度

        // 计算SVG高度
        const svgHeight = startY + (messages.length * nodeSpacing) + 20;
        svg.setAttribute('height', svgHeight);

        // 清空SVG内容
        svg.innerHTML = '';

        // 绘制节点和连线
        messages.forEach((message, index) => {
            const y = startY + (index * nodeSpacing);
            const isUser = message.role === 'user';
            const nodeRadius = isUser ? userNodeRadius : aiNodeRadius;

            // 绘制连线（除了第一个节点）
            if (index > 0) {
                const prevY = startY + ((index - 1) * nodeSpacing);
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', startX);
                line.setAttribute('y1', prevY);
                line.setAttribute('x2', startX);
                line.setAttribute('y2', y);
                line.setAttribute('class', 'node-axis-line');
                svg.appendChild(line);
            }

            // 判断是否有追问
            const hasFollowups = message.followups && message.followups.length > 0;

            // 创建节点组
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('data-message-index', index);
            group.setAttribute('data-message-id', message.messageId || '');

            // 绘制透明的大点击区域
            const clickArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            clickArea.setAttribute('cx', startX);
            clickArea.setAttribute('cy', y);
            clickArea.setAttribute('r', clickAreaRadius);
            clickArea.setAttribute('class', 'node-axis-clickarea');
            group.appendChild(clickArea);

            // 绘制主节点
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', startX);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', nodeRadius);

            // 设置样式类
            let circleClass = `node-axis-circle ${isUser ? 'user' : 'ai'}`;
            if (hasFollowups) {
                circleClass += ' has-followup';
            }
            circle.setAttribute('class', circleClass);

            group.appendChild(circle);
            svg.appendChild(group);

            // 如果有追问，绘制分叉
            if (hasFollowups) {
                // 绘制分叉横线
                const branchLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                branchLine.setAttribute('x1', startX + nodeRadius);
                branchLine.setAttribute('y1', y);
                branchLine.setAttribute('x2', startX + nodeRadius + branchLength);
                branchLine.setAttribute('y2', y);
                branchLine.setAttribute('class', 'node-axis-line');
                svg.appendChild(branchLine);

                // 创建分支节点组
                const branchGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                branchGroup.setAttribute('data-message-index', index);
                branchGroup.setAttribute('data-message-id', message.messageId || '');
                branchGroup.setAttribute('data-is-branch', 'true');

                // 分支节点的点击区域
                const branchClickArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                branchClickArea.setAttribute('cx', startX + nodeRadius + branchLength);
                branchClickArea.setAttribute('cy', y);
                branchClickArea.setAttribute('r', clickAreaRadius * 0.8);
                branchClickArea.setAttribute('class', 'node-axis-clickarea');
                branchGroup.appendChild(branchClickArea);

                // 绘制分叉节点
                const branchCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                branchCircle.setAttribute('cx', startX + nodeRadius + branchLength);
                branchCircle.setAttribute('cy', y);
                branchCircle.setAttribute('r', 4); // 分叉节点最小
                branchCircle.setAttribute('class', 'node-axis-circle branch');
                branchGroup.appendChild(branchCircle);

                svg.appendChild(branchGroup);
            }
        });
    }

    /**
     * 切换节点轴折叠状态
     * @param {boolean} isCollapsed - 是否折叠
     */
    toggleNodeAxis(isCollapsed) {
        const content = document.getElementById('nodeAxisContent');
        const icon = document.getElementById('nodeAxisToggleIcon');

        if (isCollapsed) {
            content.style.display = 'none';
            icon.style.transform = 'rotate(-90deg)';
        } else {
            content.style.display = 'block';
            icon.style.transform = 'rotate(0deg)';
        }
    }

    /**
     * 添加消息到聊天容器
     * @param {string} content - 消息内容
     * @param {string} type - 消息类型 ('user' 或 'ai')
     * @param {boolean} isStreaming - 是否为流式输出
     * @param {string} imageUrl - 图片URL（可选）
     * @param {Function} formatMessageCallback - 格式化消息的回调函数
     * @returns {Element} 消息元素
     */
    addMessage(content, type, isStreaming = false, imageUrl = null, formatMessageCallback = null) {
        const messagesContainer = document.getElementById('messages');
        const timestamp = new Date().toLocaleTimeString();

        const messageElement = document.createElement('div');
        messageElement.className = `message-bubble ${type}-message animate__animated animate__fadeInUp`;

        if (type === 'user') {
            let imageHtml = '';
            if (imageUrl) {
                imageHtml = `<img src="${imageUrl}" class="message-image" onclick="window.open('${imageUrl}', '_blank')">`;
            }
            const userAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E`;
            messageElement.innerHTML = `
                <div class="mb-2 flex items-center gap-2">
                    <img src="${userAvatar}" class="w-6 h-6" alt="User">
                    <span class="text-blue-400 font-semibold">你</span>
                    <span class="text-gray-400 text-sm ml-2">${timestamp}</span>
                </div>
                <div class="message-content">
                    ${content ? `<p>${escapeHtml(content)}</p>` : ''}
                    ${imageHtml}
                </div>
            `;
        } else {
            const aiAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 8V4H8'/%3E%3Crect width='16' height='12' x='4' y='8' rx='2'/%3E%3Cpath d='M2 14h2'/%3E%3Cpath d='M20 14h2'/%3E%3Cpath d='M15 13v2'/%3E%3Cpath d='M9 13v2'/%3E%3C/svg%3E`;
            const formattedContent = formatMessageCallback ? formatMessageCallback(content) : escapeHtml(content);
            messageElement.innerHTML = `
                <div class="mb-2 flex items-center gap-2">
                    <img src="${aiAvatar}" class="w-6 h-6" alt="AI">
                    <span class="text-green-400 font-semibold">AI助手</span>
                    <span class="text-gray-400 text-sm ml-2">${timestamp}</span>
                </div>
                <div class="message-content ${isStreaming ? 'typewriter' : ''}">
                    ${content ? formattedContent : '<span class="text-gray-400">正在思考...</span>'}
                </div>
            `;
        }

        messagesContainer.appendChild(messageElement);
        this.scrollToBottom();

        return messageElement;
    }

    /**
     * 滚动到底部
     */
    scrollToBottom() {
        const container = document.getElementById('chatContainer');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    /**
     * 切换到聊天模式UI
     */
    switchToChatMode() {
        // 切换body类
        document.body.classList.remove('view-mode-editor');
        document.body.classList.add('view-mode-chat');

        // 显示聊天容器，隐藏编辑器
        const chatContainer = document.getElementById('chatContainer');
        const editorContainer = document.getElementById('editor-container');

        if (chatContainer) chatContainer.classList.remove('hidden');
        if (editorContainer) editorContainer.classList.add('hidden');

        // 切换工具栏：显示聊天按钮组，隐藏编辑器按钮组
        const chatActions = document.getElementById('chatActions');
        const editorActions = document.getElementById('editorActions');

        if (chatActions) {
            chatActions.classList.remove('hidden');
            chatActions.classList.add('flex');
        }
        if (editorActions) {
            editorActions.classList.remove('flex');
            editorActions.classList.add('hidden');
        }

        // 更新标题
        const headerTitle = document.querySelector('header h1 span');
        if (headerTitle) {
            headerTitle.textContent = 'AI助手';
        }

        // 清空消息输入框
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
        }
    }

    /**
     * 切换到编辑模式UI
     * @param {string} noteTitle - 笔记标题（可选）
     */
    switchToEditorMode(noteTitle = '') {
        // 切换body类
        document.body.classList.remove('view-mode-chat');
        document.body.classList.add('view-mode-editor');

        // 隐藏聊天容器，显示编辑器
        const chatContainer = document.getElementById('chatContainer');
        const editorContainer = document.getElementById('editor-container');

        if (chatContainer) chatContainer.classList.add('hidden');
        if (editorContainer) editorContainer.classList.remove('hidden');

        // 切换工具栏：隐藏聊天按钮组，显示编辑器按钮组
        const chatActions = document.getElementById('chatActions');
        const editorActions = document.getElementById('editorActions');

        if (chatActions) {
            chatActions.classList.remove('flex');
            chatActions.classList.add('hidden');
        }
        if (editorActions) {
            editorActions.classList.remove('hidden');
            editorActions.classList.add('flex');
        }

        // 更新标题为笔记名称
        const headerTitle = document.querySelector('header h1 span');
        if (headerTitle && noteTitle) {
            headerTitle.textContent = noteTitle;
        }
    }

    /**
     * 切换专注模式
     */
    toggleFocusMode() {
        this.isFocusMode = !this.isFocusMode;
        const app = document.getElementById('app');
        const focusBtn = document.getElementById('focusModeBtn');

        if (this.isFocusMode) {
            app.classList.add('focus-mode');
            if (focusBtn) {
                focusBtn.classList.add('active');
                focusBtn.setAttribute('title', '退出专注模式');
            }
            this.showNotification('已进入专注模式', 'info');
        } else {
            app.classList.remove('focus-mode');
            if (focusBtn) {
                focusBtn.classList.remove('active');
                focusBtn.setAttribute('title', '专注模式');
            }
            this.showNotification('已退出专注模式', 'info');
        }

        // 持久化专注模式状态
        localStorage.setItem('focusMode', this.isFocusMode);
    }

    /**
     * 加载专注模式偏好设置
     */
    loadFocusModePreference() {
        const savedFocusMode = localStorage.getItem('focusMode') === 'true';
        if (savedFocusMode) {
            this.isFocusMode = true;
            const app = document.getElementById('app');
            const focusBtn = document.getElementById('focusModeBtn');

            if (app) app.classList.add('focus-mode');
            if (focusBtn) {
                focusBtn.classList.add('active');
                focusBtn.setAttribute('title', '退出专注模式');
            }
        }
    }

    /**
     * Shows a modal for the user to enter an instruction.
     * @param {function(string): void} callback - Called with the instruction when the user confirms.
     */
    showInstructionPrompt(callback) {
        // Remove any existing prompt
        const existingPrompt = document.getElementById('instruction-prompt-modal');
        if (existingPrompt) {
            existingPrompt.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'instruction-prompt-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-lg p-6 shadow-xl w-full max-w-md">
                <h3 class="text-lg font-bold mb-4 text-white">修改指令</h3>
                <p class="text-sm text-gray-400 mb-2">请输入你想要如何修改选中内容的指令：</p>
                <textarea id="instruction-input" class="w-full h-24 p-2 bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500"></textarea>
                <div class="flex justify-end gap-4 mt-4">
                    <button id="cancel-instruction-btn" class="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-white">取消</button>
                    <button id="confirm-instruction-btn" class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-white">确认</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const input = document.getElementById('instruction-input');
        input.focus();

        const confirmBtn = document.getElementById('confirm-instruction-btn');
        const cancelBtn = document.getElementById('cancel-instruction-btn');
        const modalContainer = document.getElementById('instruction-prompt-modal');

        const close = () => modal.remove();

        confirmBtn.addEventListener('click', () => {
            const instruction = input.value.trim();
            if (instruction) {
                callback(instruction);
            }
            close();
        });

        cancelBtn.addEventListener('click', close);
        modalContainer.addEventListener('click', (e) => {
            if (e.target === modalContainer) {
                close();
            }
        });
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                confirmBtn.click();
            }
        });
    }
}
