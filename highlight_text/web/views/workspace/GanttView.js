/**
 * GanttView - 甘特图视图 (集成 Frappe Gantt)
 * 使用 Frappe Gantt 库提供完整的交互功能
 */
export class GanttView {
    constructor(container, workspaceView) {
        this.container = container;
        this.workspaceView = workspaceView;
        this.gantt = null;
        this.tasks = [];
        this.isSorted = false; // 排序状态

        // 拖拽创建任务的状态
        this.dragState = {
            isDragging: false,
            startX: 0,
            startDate: null,
            selectionRect: null
        };
    }

    init() {
        this.container.innerHTML = `
            <div class="gantt-header" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 16px; font-weight: 600;">📈 任务时间线 (甘特图)</h3>
                <div class="gantt-view-controls" style="display: flex; gap: 8px;">
                    <button id="gantt-sort-btn" style="padding: 4px 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 12px;">排序</button>
                    <button class="view-mode-btn" data-mode="Day" style="padding: 4px 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 12px;">日</button>
                    <button class="view-mode-btn active" data-mode="Week" style="padding: 4px 12px; border: 1px solid #2196F3; background: #E3F2FD; color: #2196F3; border-radius: 4px; cursor: pointer; font-size: 12px;">周</button>
                    <button class="view-mode-btn" data-mode="Month" style="padding: 4px 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 12px;">月</button>
                </div>
            </div>
            <div class="gantt-chart-container" style="position: relative;">
                <svg id="gantt-chart"></svg>
            </div>
        `;

        // 绑定排序按钮
        const sortBtn = this.container.querySelector('#gantt-sort-btn');
        sortBtn.addEventListener('click', () => this.toggleSort());

        // 绑定视图切换按钮
        this.container.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode');
                this.changeViewMode(mode);

                // 更新按钮样式
                this.container.querySelectorAll('.view-mode-btn').forEach(b => {
                    b.style.border = '1px solid #ddd';
                    b.style.background = 'white';
                    b.style.color = 'inherit';
                });
                btn.style.border = '1px solid #2196F3';
                btn.style.background = '#E3F2FD';
                btn.style.color = '#2196F3';
            });
        });

        // 绑定拖拽创建任务的事件
        this.setupDragToCreate();
    }

    /**
     * 设置拖拽创建任务功能
     */
    setupDragToCreate() {
        const ganttContainer = this.container.querySelector('.gantt-chart-container');

        ganttContainer.addEventListener('mousedown', (e) => {
            // 只在空白区域响应（不在任务条上）
            if (e.target.closest('.bar-wrapper') || e.target.closest('.bar')) {
                return;
            }

            this.dragState.isDragging = true;
            this.dragState.startX = e.clientX;

            // 创建选择矩形
            this.dragState.selectionRect = document.createElement('div');
            this.dragState.selectionRect.style.cssText = `
                position: absolute;
                background: rgba(33, 150, 243, 0.2);
                border: 2px solid #2196F3;
                pointer-events: none;
                z-index: 1000;
            `;
            ganttContainer.appendChild(this.dragState.selectionRect);
        });

        ganttContainer.addEventListener('mousemove', (e) => {
            if (!this.dragState.isDragging || !this.dragState.selectionRect) return;

            const currentX = e.clientX;
            const startX = this.dragState.startX;
            const rect = ganttContainer.getBoundingClientRect();

            const left = Math.min(startX, currentX) - rect.left;
            const width = Math.abs(currentX - startX);

            this.dragState.selectionRect.style.left = `${left}px`;
            this.dragState.selectionRect.style.top = '0';
            this.dragState.selectionRect.style.width = `${width}px`;
            this.dragState.selectionRect.style.height = '100%';
        });

        ganttContainer.addEventListener('mouseup', (e) => {
            if (!this.dragState.isDragging) return;

            const currentX = e.clientX;
            const startX = this.dragState.startX;

            // 清理选择矩形
            if (this.dragState.selectionRect) {
                this.dragState.selectionRect.remove();
                this.dragState.selectionRect = null;
            }

            this.dragState.isDragging = false;

            // 如果拖拽距离太小，忽略
            if (Math.abs(currentX - startX) < 20) {
                return;
            }

            // 计算起止日期（这里简化处理，基于当前视图模式）
            const now = new Date();
            const start = new Date(now);
            const end = new Date(now);
            end.setHours(end.getHours() + 2); // 默认2小时

            // 显示创建任务弹窗
            this.workspaceView.showCreateTaskModal({ start, end });
        });

        ganttContainer.addEventListener('mouseleave', () => {
            if (this.dragState.isDragging && this.dragState.selectionRect) {
                this.dragState.selectionRect.remove();
                this.dragState.selectionRect = null;
                this.dragState.isDragging = false;
            }
        });
    }

    /**
     * 切换排序状态
     */
    toggleSort() {
        this.isSorted = !this.isSorted;

        // 更新按钮样式
        const sortBtn = this.container.querySelector('#gantt-sort-btn');
        if (this.isSorted) {
            sortBtn.style.border = '1px solid #2196F3';
            sortBtn.style.background = '#E3F2FD';
            sortBtn.style.color = '#2196F3';
        } else {
            sortBtn.style.border = '1px solid #ddd';
            sortBtn.style.background = 'white';
            sortBtn.style.color = 'inherit';
        }

        // 重新渲染
        this.render(this.tasks);
    }

    render(tasks) {
        this.tasks = tasks;

        if (tasks.length === 0) {
            this.container.querySelector('.gantt-chart-container').innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: #999;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                    <div style="font-size: 16px;">暂无任务</div>
                    <div style="font-size: 14px; margin-top: 8px;">请通过左侧 Copilot 创建任务</div>
                </div>
            `;
            return;
        }

        // 根据排序状态处理任务列表
        let displayTasks = [...tasks];
        if (this.isSorted) {
            // 按持续时间降序排序（跨日程长的在上方）
            displayTasks.sort((a, b) => {
                const durationA = new Date(a.dtend) - new Date(a.dtstart);
                const durationB = new Date(b.dtend) - new Date(b.dtstart);
                return durationB - durationA; // 降序
            });
        }

        // 预处理: 为子任务继承父任务的颜色
        const processedTasks = this.inheritParentColors(displayTasks);

        // 转换数据为 Frappe Gantt 格式
        const ganttTasks = this.convertToGanttFormat(processedTasks);

        // 初始化或更新 Gantt 图
        if (!this.gantt) {
            try {
                this.gantt = new Gantt('#gantt-chart', ganttTasks, {
                    view_mode: 'Week',
                    date_format: 'YYYY-MM-DD',
                    language: 'zh',
                    popup_trigger: 'click',
                    custom_popup_html: (task) => {
                        const originalTask = this.tasks.find(t => t.id === task.id);
                        return `
                            <div class="gantt-popup" style="padding: 12px;">
                                <div style="font-weight: 600; margin-bottom: 8px;">${task.name}</div>
                                <div style="font-size: 12px; color: #666;">
                                    <div>项目: ${originalTask?.project || '未分类'}</div>
                                    <div>状态: ${this.getStatusLabel(originalTask?.status)}</div>
                                    <div>开始: ${task.start.toLocaleDateString('zh-CN')}</div>
                                    <div>结束: ${task.end.toLocaleDateString('zh-CN')}</div>
                                    <div style="margin-top: 8px;">右键打开更多选项</div>
                                </div>
                            </div>
                        `;
                    },
                    on_date_change: (task, start, end) => {
                        this.handleDateChange(task, start, end);
                    },
                    on_progress_change: (task, progress) => {
                        console.log('Progress changed:', task.id, progress);
                    },
                    on_click: (task) => {
                        console.log('Task clicked:', task.id);
                    }
                });

                // 绑定右键菜单
                this.setupContextMenu();

                // 应用自定义颜色
                this.applyTaskColors(ganttTasks);

                console.log('Frappe Gantt initialized with', ganttTasks.length, 'tasks');
            } catch (error) {
                console.error('Failed to initialize Gantt:', error);
                this.container.querySelector('.gantt-chart-container').innerHTML = `
                    <div style="color: red; padding: 20px;">
                        甘特图初始化失败: ${error.message}
                    </div>
                `;
            }
        } else {
            // 更新现有 Gantt 图
            try {
                this.gantt.refresh(ganttTasks);
                this.setupContextMenu();

                // 应用自定义颜色
                this.applyTaskColors(ganttTasks);

                console.log('Gantt refreshed with', ganttTasks.length, 'tasks');
            } catch (error) {
                console.error('Failed to refresh Gantt:', error);
            }
        }
    }

    /**
     * 为甘特图任务条应用自定义颜色
     */
    applyTaskColors(ganttTasks) {
        setTimeout(() => {
            ganttTasks.forEach(ganttTask => {
                if (ganttTask._color) {
                    const bar = this.container.querySelector(`.bar-wrapper[data-id="${ganttTask.id}"] .bar`);
                    if (bar) {
                        bar.style.fill = ganttTask._color;
                    }
                    const progressBar = this.container.querySelector(`.bar-wrapper[data-id="${ganttTask.id}"] .bar-progress`);
                    if (progressBar) {
                        progressBar.style.fill = this.darkenColor(ganttTask._color, 20);
                    }
                }
            });
        }, 100);
    }

    /**
     * 加深颜色
     */
    darkenColor(color, percent) {
        const num = parseInt(color.replace("#",""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 +
            (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255))
            .toString(16).slice(1);
    }

    convertToGanttFormat(tasks) {
        return tasks.map(task => {
            const start = task.dtstart ? new Date(task.dtstart) : new Date();
            const end = task.dtend ? new Date(task.dtend) : new Date(start.getTime() + 3600000);

            // 使用任务的progress字段，如果没有则根据状态计算
            let progress = task.progress || 0;
            if (progress === 0) {
                if (task.status === 'completed') progress = 100;
                else if (task.status === 'in_progress') progress = 50;
            }

            return {
                id: task.id,
                name: task.title,
                start: this.formatDate(start),
                end: this.formatDate(end),
                progress: progress,
                custom_class: this.getTaskClass(task),
                // 存储颜色信息用于后续渲染
                _color: task.color
            };
        });
    }

    /**
     * 为子任务继承父任务的颜色和类型
     */
    inheritParentColors(tasks) {
        const taskMap = new Map();
        tasks.forEach(task => taskMap.set(task.id, task));

        return tasks.map(task => {
            if (task.parent_id && taskMap.has(task.parent_id)) {
                const parentTask = taskMap.get(task.parent_id);
                return {
                    ...task,
                    color: task.color || parentTask.color,
                    type: task.type || parentTask.type
                };
            }
            return task;
        });
    }

    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getTaskClass(task) {
        const now = new Date();
        const taskEnd = task.dtend ? new Date(task.dtend) : null;

        if (task.status === 'completed') return 'task-completed';
        if (taskEnd && taskEnd < now) return 'task-overdue';
        if (taskEnd && taskEnd > now) return 'task-future';
        return 'task-normal';
    }

    getStatusLabel(status) {
        const labels = {
            'pending': '待处理',
            'in_progress': '进行中',
            'completed': '已完成',
            'archived': '已归档'
        };
        return labels[status] || status;
    }

    handleDateChange(ganttTask, start, end) {
        console.log('Date changed:', ganttTask.id, start, end);

        // 更新任务状态
        this.workspaceView.updateTaskState(ganttTask.id, {
            dtstart: new Date(start).toISOString(),
            dtend: new Date(end).toISOString()
        });
    }

    changeViewMode(mode) {
        if (this.gantt) {
            this.gantt.change_view_mode(mode);
            console.log('View mode changed to:', mode);
        }
    }

    setupContextMenu() {
        // 为所有任务条添加右键菜单
        const taskBars = this.container.querySelectorAll('.bar-wrapper');

        taskBars.forEach(bar => {
            // 移除旧的监听器(如果存在)
            bar.removeEventListener('contextmenu', this.contextMenuHandler);

            // 添加新的监听器
            this.contextMenuHandler = (e) => {
                e.preventDefault();
                const taskId = bar.getAttribute('data-id');
                const task = this.tasks.find(t => t.id === taskId);
                if (task) {
                    this.showContextMenu(e, task);
                }
            };

            bar.addEventListener('contextmenu', this.contextMenuHandler);
        });
    }

    showContextMenu(event, task) {
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.gantt-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'gantt-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            min-width: 160px;
            overflow: hidden;
        `;

        // 生成进度条HTML
        const currentProgress = task.progress || 0;
        const progressLevel = Math.floor(currentProgress / 10); // 0-10

        let batteryIcons = '';
        for (let i = 1; i <= 10; i++) {
            const isFilled = i <= progressLevel;
            const iconStyle = `
                display: inline-block;
                width: 16px;
                height: 20px;
                margin: 0 2px;
                border: 2px solid ${isFilled ? '#4CAF50' : '#ddd'};
                border-radius: 2px;
                background: ${isFilled ? '#4CAF50' : 'white'};
                cursor: pointer;
                transition: all 0.2s;
                position: relative;
            `;
            batteryIcons += `<span class="battery-icon" data-level="${i}" style="${iconStyle}"></span>`;
        }

        menu.innerHTML = `
            <div id="progress-selector" style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0;">
                <div style="font-size: 12px; margin-bottom: 8px; color: #666;">
                    设置进度: <span id="progress-value" style="font-weight: 600; color: #4CAF50;">${currentProgress}%</span>
                </div>
                <div style="display: flex; gap: 2px; justify-content: space-between;">
                    ${batteryIcons}
                </div>
            </div>
            <div class="menu-item" data-action="review" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>📝</span><span>任务复盘</span>
            </div>
            <div class="menu-item" data-action="set_parent" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>🔗</span><span>设置父项目</span>
            </div>
            <div class="menu-item" data-action="add_subtask" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>➕</span><span>添加子任务</span>
            </div>
            <div class="menu-item" data-action="complete" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>✅</span><span>标记完成</span>
            </div>
            <div class="menu-item" data-action="delete" style="padding: 12px 16px; cursor: pointer; color: #F44336; display: flex; align-items: center; gap: 8px;">
                <span>🗑️</span><span>删除任务</span>
            </div>
        `;

        document.body.appendChild(menu);

        // 绑定进度条点击事件
        const progressSelector = menu.querySelector('#progress-selector');
        progressSelector.addEventListener('click', (e) => {
            const batteryIcon = e.target.closest('.battery-icon');
            if (batteryIcon) {
                const level = parseInt(batteryIcon.getAttribute('data-level'));
                const newProgress = level * 10;

                // 更新任务进度
                this.workspaceView.updateTaskState(task.id, { progress: newProgress });

                // 更新进度值显示
                const progressValue = menu.querySelector('#progress-value');
                progressValue.textContent = `${newProgress}%`;

                // 更新电量图标显示
                const icons = menu.querySelectorAll('.battery-icon');
                icons.forEach((icon, index) => {
                    const iconLevel = index + 1;
                    const isFilled = iconLevel <= level;
                    icon.style.border = `2px solid ${isFilled ? '#4CAF50' : '#ddd'}`;
                    icon.style.background = isFilled ? '#4CAF50' : 'white';
                });
            }
        });

        // 鼠标悬停效果
        const batteryIconElements = menu.querySelectorAll('.battery-icon');
        batteryIconElements.forEach(icon => {
            icon.addEventListener('mouseenter', () => {
                icon.style.transform = 'scale(1.1)';
                icon.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            });
            icon.addEventListener('mouseleave', () => {
                icon.style.transform = 'scale(1)';
                icon.style.boxShadow = 'none';
            });
        });

        // 绑定菜单项事件
        menu.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                item.style.background = '#f5f5f5';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = 'white';
            });
            item.addEventListener('click', () => {
                const action = item.getAttribute('data-action');
                this.handleMenuAction(action, task);
                menu.remove();
            });
        });

        // 点击其他地方关闭菜单
        setTimeout(() => {
            const closeMenu = () => {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            };
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    handleMenuAction(action, task) {
        switch (action) {
            case 'review':
                this.workspaceView.showReviewModal(task);
                break;
            case 'set_parent':
                this.showSetParentDialog(task);
                break;
            case 'add_subtask':
                this.showAddSubtaskDialog(task);
                break;
            case 'complete':
                this.workspaceView.updateTaskState(task.id, { status: 'completed' });
                break;
            case 'delete':
                if (confirm(`确定要删除任务 "${task.title}" 吗?`)) {
                    this.deleteTask(task.id);
                }
                break;
        }
    }

    showSetParentDialog(task) {
        // 获取所有可能的父任务(不包括自己和自己的子任务)
        const availableParents = this.tasks.filter(t =>
            t.id !== task.id && t.parent_id !== task.id
        );

        if (availableParents.length === 0) {
            alert('没有可用的父项目');
            return;
        }

        // 创建选择列表
        const options = availableParents.map((t, index) =>
            `${index + 1}. ${t.title}`
        ).join('\n');

        const selection = prompt(`请选择父项目:\n${options}\n\n输入序号 (输入0取消父项目关联):`);

        if (selection === null) return;

        const index = parseInt(selection) - 1;

        if (selection === '0') {
            // 取消父项目关联
            this.workspaceView.updateTaskState(task.id, { parent_id: '' });
        } else if (index >= 0 && index < availableParents.length) {
            const parentTask = availableParents[index];
            this.workspaceView.updateTaskState(task.id, {
                parent_id: parentTask.id,
                // 继承父任务的颜色和类型
                color: parentTask.color,
                type: parentTask.type
            });
        } else {
            alert('无效的选择');
        }
    }

    showAddSubtaskDialog(task) {
        const title = prompt('请输入子任务标题:');
        if (!title) return;

        // 使用 TaskAgent 创建子任务
        const startTime = task.dtstart || new Date().toISOString();
        const endTime = task.dtend || new Date(Date.now() + 3600000).toISOString();

        this.workspaceView.taskAgent.executeTool('create_task', {
            title: title,
            parent_id: task.id,
            type: task.type,
            dtstart: startTime,
            dtend: endTime
        }).then(async (result) => {
            const data = JSON.parse(result);
            if (data.success) {
                await this.workspaceView.loadAndSyncTasks();
            } else {
                alert('创建子任务失败: ' + (data.error || '未知错误'));
            }
        }).catch(error => {
            alert('创建子任务失败: ' + error.message);
        });
    }

    async deleteTask(taskId) {
        try {
            await fetch('/agent/tasks/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tool: 'delete_task',
                    args: { task_id: taskId }
                })
            });

            // 重新加载任务
            await this.workspaceView.loadAndSyncTasks();
        } catch (error) {
            alert('删除失败: ' + error.message);
        }
    }
}
