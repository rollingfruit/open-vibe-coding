/**
 * CalendarView - 日历视图 (集成 FullCalendar)
 * 使用 FullCalendar 库提供完整的交互功能
 */
export class CalendarView {
    constructor(container, workspaceView) {
        this.container = container;
        this.workspaceView = workspaceView;
        this.tasks = [];
        this.calendar = null;
    }

    async init() {
        // 创建日历容器
        this.container.innerHTML = `
            <div class="calendar-header" style="padding: 16px; border-bottom: 1px solidrgb(6, 6, 6);">
                <h3 style="margin: 0; font-size: 16px; font-weight: 600;">📅 日历视图</h3>
            </div>
            <div id="fullcalendar-container" style="flex: 1; padding: 16px; overflow: auto;"></div>
        `;

        // 初始化 FullCalendar
        const calendarEl = this.container.querySelector('#fullcalendar-container');

        this.calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'timeGridDay',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'timeGridDay,timeGridWeek'
            },
            slotMinTime: '08:00:00',
            slotMaxTime: '22:00:00',
            slotDuration: '00:30:00',
            allDaySlot: false,
            nowIndicator: true,
            editable: true,
            selectable: true,
            selectMirror: true,
            eventResizableFromStart: true,
            dragScroll: true,
            height: 'auto',

            // 事件处理器
            eventDrop: (info) => this.handleEventDrop(info),
            eventResize: (info) => this.handleEventResize(info),
            select: (info) => this.handleSelect(info),
            eventClick: (info) => this.handleEventClick(info),

            // 自定义右键菜单和双击编辑
            eventDidMount: (info) => {
                // 右键菜单
                info.el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showContextMenu(e, info.event);
                });

                // 双击编辑
                info.el.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    const task = info.event.extendedProps.taskData;
                    this.workspaceView.showEditTaskModal(task);
                });
            }
        });

        this.calendar.render();
    }

    render(tasks) {
        if (!this.calendar) {
            console.error('Calendar not initialized');
            return;
        }

        this.tasks = tasks || [];

        // 预处理: 为子任务继承父任务的颜色
        const processedTasks = this.inheritParentColors(this.tasks);

        // 建立任务ID映射表
        const taskMap = new Map();
        this.tasks.forEach(t => taskMap.set(t.id, t));

        // 转换任务数据为 FullCalendar 事件格式
        const events = processedTasks.map(task => {
            const start = new Date(task.dtstart);
            const end = new Date(task.dtend);

            // 计算任务持续时间(小时)
            const durationHours = (end - start) / (1000 * 60 * 60);

            const isPreview = task.status === 'preview';
            const color = task.color || '#FBBF24'; // Default to yellow if no color

            // 如果是预览状态，添加透明度
            const eventColor = isPreview ? `${color}80` : color;
            const eventBorderColor = color;

            // 如果时间跨度超过18小时或没有具体时间,设置为全天事件
            const isAllDay = durationHours > 18 || (!task.dtstart && !task.dtend);

            // 获取父目标的标题(如果有)
            let displayTitle = task.title;
            if (task.parent_id && taskMap.has(task.parent_id)) {
                const parentGoal = taskMap.get(task.parent_id);
                displayTitle = `[${parentGoal.title}] ${task.title}`;
            }

            return {
                id: task.id,
                title: displayTitle,
                start: task.dtstart,
                end: task.dtend,
                allDay: isAllDay,
                backgroundColor: eventColor,
                borderColor: eventBorderColor,
                classNames: isPreview ? ['task-preview'] : [],
                extendedProps: {
                    status: task.status,
                    project: task.project,
                    review: task.review,
                    taskData: task,
                    taskType: task.type,
                    parentGoalTitle: task.parent_id && taskMap.has(task.parent_id) ? taskMap.get(task.parent_id).title : null
                }
            };
        });

        // 更新日历事件
        this.calendar.removeAllEvents();
        this.calendar.addEventSource(events);

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

    

    // 拖拽移动事件
    handleEventDrop(info) {
        const taskId = info.event.id;
        const newStart = info.event.start.toISOString();
        const newEnd = info.event.end ? info.event.end.toISOString() : newStart;


        // 更新任务状态
        this.workspaceView.updateTaskState(taskId, {
            dtstart: newStart,
            dtend: newEnd
        });
    }

    // 调整时长事件
    handleEventResize(info) {
        const taskId = info.event.id;
        const newStart = info.event.start.toISOString();
        const newEnd = info.event.end ? info.event.end.toISOString() : newStart;


        // 更新任务状态
        this.workspaceView.updateTaskState(taskId, {
            dtstart: newStart,
            dtend: newEnd
        });
    }

    // 选择时间段创建任务
    handleSelect(info) {
        // 使用新的弹窗方式创建任务
        this.workspaceView.showCreateTaskModal({
            start: info.start,
            end: info.end
        });

        this.calendar.unselect();
    }

    // 单击事件
    handleEventClick(info) {
        const task = info.event.extendedProps.taskData;

        // 显示任务详情
        const details = `
任务: ${task.title}
状态: ${this.getStatusLabel(task.status)}
项目: ${task.project || '未分类'}
开始: ${new Date(task.dtstart).toLocaleString('zh-CN')}
结束: ${new Date(task.dtend).toLocaleString('zh-CN')}
        `.trim();

        alert(details);
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

    // 右键菜单
    showContextMenu(event, calEvent) {
        const task = calEvent.extendedProps.taskData;

        // 移除已存在的菜单
        const existingMenu = document.querySelector('.calendar-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'calendar-context-menu';
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
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = item.getAttribute('data-action');
                await this.handleMenuAction(action, task);
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

    async handleMenuAction(action, task) {
        switch (action) {
            case 'review':
                this.workspaceView.showReviewModal(task);
                break;
            case 'complete':
                this.workspaceView.updateTaskState(task.id, {
                    status: 'completed',
                    progress: 100
                });
                break;
            case 'delete':
                if (confirm(`确定要删除任务 "${task.title}" 吗?`)) {
                    await this.deleteTask(task.id);
                }
                break;
        }
    }

    async deleteTask(taskId) {
        try {
            const response = await fetch('/agent/tasks/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tool: 'delete_task',
                    args: { task_id: taskId }
                })
            });


            if (!response.ok) {
                const errorText = await response.text();
                console.error('Delete failed:', errorText);
                throw new Error(`删除请求失败: ${response.status} ${errorText}`);
            }

            const result = await response.json();

            // 检查返回的数据格式
            let data = result;
            if (typeof result === 'string') {
                try {
                    data = JSON.parse(result);
                } catch (e) {
                    console.error('Failed to parse result:', e);
                }
            }

            if (data.success) {
                // 重新加载任务
                await this.workspaceView.loadAndSyncTasks();
            } else {
                throw new Error(data.error || data.message || '删除失败');
            }
        } catch (error) {
            console.error('Delete task error:', error);
            alert('删除失败: ' + error.message);
        }
    }
}
