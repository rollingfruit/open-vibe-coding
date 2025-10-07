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
        console.log('FullCalendar initialized');
    }

    render(tasks) {
        if (!this.calendar) {
            console.error('Calendar not initialized');
            return;
        }

        this.tasks = tasks || [];

        // 预处理: 为子任务继承父任务的颜色
        const processedTasks = this.inheritParentColors(this.tasks);

        // 转换任务数据为 FullCalendar 事件格式
        const events = processedTasks.map(task => {
            const start = new Date(task.dtstart);
            const end = new Date(task.dtend);

            // 计算任务持续时间(小时)
            const durationHours = (end - start) / (1000 * 60 * 60);

            // 构建CSS类名
            const taskType = task.type || 'default';
            let classNames = [`task-type-${taskType}`];

            // 如果任务持续时间超过12小时，添加长任务类
            if (durationHours > 12) {
                classNames.push('task-long-duration');
            }

            // 如果是预览状态，添加预览类
            if (task.status === 'preview') {
                classNames.push('task-preview');
            }

            // 如果时间跨度超过18小时或没有具体时间,设置为全天事件
            const isAllDay = durationHours > 18 || (!task.dtstart && !task.dtend);

            return {
                id: task.id,
                title: task.title,
                start: task.dtstart,
                end: task.dtend,
                allDay: isAllDay,
                className: classNames,
                extendedProps: {
                    status: task.status,
                    project: task.project,
                    review: task.review,
                    taskData: task,
                    taskType: taskType
                }
            };
        });

        // 更新日历事件
        this.calendar.removeAllEvents();
        this.calendar.addEventSource(events);

        console.log('Calendar rendered with', events.length, 'events');
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

    getTaskColor(task) {
        switch (task.status) {
            case 'completed': return '#E8F5E9';
            case 'in_progress': return '#E3F2FD';
            case 'pending': return '#FFF9C4';
            default: return '#F5F5F5';
        }
    }

    getTaskBorderColor(task) {
        switch (task.status) {
            case 'completed': return '#4CAF50';
            case 'in_progress': return '#2196F3';
            case 'pending': return '#FFC107';
            default: return '#9E9E9E';
        }
    }

    // 拖拽移动事件
    handleEventDrop(info) {
        const taskId = info.event.id;
        const newStart = info.event.start.toISOString();
        const newEnd = info.event.end ? info.event.end.toISOString() : newStart;

        console.log('Event dropped:', taskId, newStart, newEnd);

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

        console.log('Event resized:', taskId, newStart, newEnd);

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
                this.workspaceView.updateTaskState(task.id, {
                    status: 'completed',
                    progress: 100
                });
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
            console.log('Deleting task:', taskId);
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

            console.log('Delete response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Delete failed:', errorText);
                throw new Error(`删除请求失败: ${response.status} ${errorText}`);
            }

            const result = await response.json();
            console.log('Delete result:', result);

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
                console.log(`成功删除 ${data.deleted_count} 个任务`);
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
