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
    }

    init() {
        this.container.innerHTML = `
            <div class="gantt-header" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 16px; font-weight: 600;">📈 任务时间线 (甘特图)</h3>
                <div class="gantt-view-controls" style="display: flex; gap: 8px;">
                    <button class="view-mode-btn" data-mode="Day" style="padding: 4px 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 12px;">日</button>
                    <button class="view-mode-btn active" data-mode="Week" style="padding: 4px 12px; border: 1px solid #2196F3; background: #E3F2FD; color: #2196F3; border-radius: 4px; cursor: pointer; font-size: 12px;">周</button>
                    <button class="view-mode-btn" data-mode="Month" style="padding: 4px 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 12px;">月</button>
                </div>
            </div>
            <div class="gantt-chart-container">
                <svg id="gantt-chart"></svg>
            </div>
        `;

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

        // 转换数据为 Frappe Gantt 格式
        const ganttTasks = this.convertToGanttFormat(tasks);

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
                console.log('Gantt refreshed with', ganttTasks.length, 'tasks');
            } catch (error) {
                console.error('Failed to refresh Gantt:', error);
            }
        }
    }

    convertToGanttFormat(tasks) {
        return tasks.map(task => {
            const start = task.dtstart ? new Date(task.dtstart) : new Date();
            const end = task.dtend ? new Date(task.dtend) : new Date(start.getTime() + 3600000);

            // 计算进度
            let progress = 0;
            if (task.status === 'completed') progress = 100;
            else if (task.status === 'in_progress') progress = 50;

            return {
                id: task.id,
                name: task.title,
                start: this.formatDate(start),
                end: this.formatDate(end),
                progress: progress,
                custom_class: this.getTaskClass(task)
            };
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

        menu.innerHTML = `
            <div class="menu-item" data-action="review" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>📝</span><span>任务复盘</span>
            </div>
            <div class="menu-item" data-action="complete" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>✅</span><span>标记完成</span>
            </div>
            <div class="menu-item" data-action="delete" style="padding: 12px 16px; cursor: pointer; color: #F44336; display: flex; align-items: center; gap: 8px;">
                <span>🗑️</span><span>删除任务</span>
            </div>
        `;

        document.body.appendChild(menu);

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
