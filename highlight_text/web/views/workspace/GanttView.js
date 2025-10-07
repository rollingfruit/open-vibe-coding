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

        // 项目层级展示状态
        this.projects = []; // 结构化的项目数据
        this.expandedProjects = new Set(); // 跟踪展开的项目

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
                    <button class="view-mode-btn active" data-mode="Day" style="padding: 4px 12px; border: 1px solid #2196F3; background: #E3F2FD; color: #2196F3; border-radius: 4px; cursor: pointer; font-size: 12px;">日</button>
                    <button class="view-mode-btn" data-mode="Week" style="padding: 4px 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 12px;">周</button>
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

        // 使用事件委托绑定右键菜单和双击编辑(只绑定一次)
        this.setupEventDelegation();
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

            // 显示创建项目弹窗
            this.workspaceView.showCreateProjectModal({ start, end });
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
        this.tasks = tasks || [];

        // 步骤1: 构建树状结构
        const { projects, taskMap } = this.buildTreeStructure(this.tasks);
        this.projects = projects;
        this.taskMap = taskMap;

        console.log('Tree structure built:', {
            totalTasks: this.tasks.length,
            topLevelProjects: projects.length,
            expandedProjects: Array.from(this.expandedProjects)
        });

        // 步骤2: 生成用于渲染的扁平列表(根据展开状态)
        let displayTasks = this.generateDisplayList(projects);

        console.log('Display tasks:', displayTasks.length, 'tasks will be shown');

        // 步骤3: 将任务分为活跃任务和已完成任务
        const activeTasks = displayTasks.filter(task => task.status !== 'completed');
        const completedTasks = displayTasks.filter(task => task.status === 'completed');

        console.log('Task split:', {
            active: activeTasks.length,
            completed: completedTasks.length
        });

        // 根据排序状态处理活跃任务列表
        if (this.isSorted) {
            // 按持续时间降序排序（跨日程长的在上方）
            activeTasks.sort((a, b) => {
                const durationA = new Date(a.dtend) - new Date(a.dtstart);
                const durationB = new Date(b.dtend) - new Date(b.dtstart);
                return durationB - durationA; // 降序
            });
        }

        // 预处理: 为子任务继承父任务的颜色
        const processedActiveTasks = this.inheritParentColors(activeTasks);
        const processedCompletedTasks = this.inheritParentColors(completedTasks);

        // 转换数据为 Frappe Gantt 格式
        const activeGanttTasks = this.convertToGanttFormat(processedActiveTasks);
        const completedGanttTasks = this.convertToGanttFormat(processedCompletedTasks);

        // 步骤4: 渲染活跃任务和已完成任务的分离视图
        this.renderSplitGanttView(activeGanttTasks, completedGanttTasks);
    }

    /**
     * 渲染分离的甘特图视图(活跃任务 + 已完成任务)
     */
    renderSplitGanttView(activeGanttTasks, completedGanttTasks) {
        const ganttContainer = this.container.querySelector('.gantt-chart-container');

        // 清空容器
        ganttContainer.innerHTML = '';

        // 创建活跃任务容器
        const activeContainer = document.createElement('div');
        activeContainer.id = 'active-gantt-container';
        ganttContainer.appendChild(activeContainer);

        // 准备要渲染的任务数据
        const tasksToRender = activeGanttTasks.length > 0 ? activeGanttTasks : this.createPlaceholderTask();

        // 初始化或更新活跃任务的甘特图
        if (!this.gantt) {
            // 第一次初始化甘特图
            try {
                this.gantt = new Gantt('#active-gantt-container', tasksToRender, {
                    view_mode: 'Day',
                    date_format: 'YYYY-MM-DD',
                    language: 'zh',
                    popup_trigger: 'click',
                    custom_popup_html: (task) => {
                        const originalTask = this.tasks.find(t => t.id === task.id);
                        // task.start 和 task.end 是字符串格式 (YYYY-MM-DD)
                        const startDate = task._start ? new Date(task._start).toLocaleDateString('zh-CN') : task.start;
                        const endDate = task._end ? new Date(task._end).toLocaleDateString('zh-CN') : task.end;
                        return `
                            <div class="gantt-popup" style="padding: 12px;">
                                <div style="font-weight: 600; margin-bottom: 8px;">${task.name}</div>
                                <div style="font-size: 12px; color: #666;">
                                    <div>项目: ${originalTask?.project || '未分类'}</div>
                                    <div>状态: ${this.getStatusLabel(originalTask?.status)}</div>
                                    <div>开始: ${startDate}</div>
                                    <div>结束: ${endDate}</div>
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
                        // 单击事件：不做任何操作，避免与双击编辑冲突
                        console.log('Task clicked:', task.id);
                    }
                });

                console.log('Active Gantt initialized with', activeGanttTasks.length, 'tasks');
            } catch (error) {
                console.error('Failed to initialize Active Gantt:', error);
                ganttContainer.innerHTML = `
                    <div style="color: red; padding: 20px;">
                        甘特图初始化失败: ${error.message}
                    </div>
                `;
                return;
            }
        } else {
            // 更新现有活跃任务甘特图
            // 注意: 由于上面已经清空并重新创建了容器，需要重新初始化甘特图实例
            try {
                this.gantt = new Gantt('#active-gantt-container', tasksToRender, {
                    view_mode: 'Day',
                    date_format: 'YYYY-MM-DD',
                    language: 'zh',
                    popup_trigger: 'click',
                    custom_popup_html: (task) => {
                        const originalTask = this.tasks.find(t => t.id === task.id);
                        const startDate = task._start ? new Date(task._start).toLocaleDateString('zh-CN') : task.start;
                        const endDate = task._end ? new Date(task._end).toLocaleDateString('zh-CN') : task.end;
                        return `
                            <div class="gantt-popup" style="padding: 12px;">
                                <div style="font-weight: 600; margin-bottom: 8px;">${task.name}</div>
                                <div style="font-size: 12px; color: #666;">
                                    <div>项目: ${originalTask?.project || '未分类'}</div>
                                    <div>状态: ${this.getStatusLabel(originalTask?.status)}</div>
                                    <div>开始: ${startDate}</div>
                                    <div>结束: ${endDate}</div>
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
                        // 单击事件：不做任何操作，避免与双击编辑冲突
                        console.log('Task clicked:', task.id);
                    }
                });
                console.log('Active Gantt re-initialized with', activeGanttTasks.length, 'tasks');
            } catch (error) {
                console.error('Failed to re-initialize Active Gantt:', error);
            }
        }

        // 如果有已完成任务，创建分隔符和已完成任务区域
        if (completedGanttTasks.length > 0) {
            // 创建分隔符
            const separator = document.createElement('div');
            separator.id = 'completed-separator';
            separator.className = 'gantt-completed-separator';
            separator.innerHTML = `
                <span class="chevron">▶</span>
                <span>已完成的任务 (${completedGanttTasks.length})</span>
            `;
            ganttContainer.appendChild(separator);

            // 创建已完成任务容器(默认隐藏)
            const completedContainer = document.createElement('div');
            completedContainer.id = 'completed-gantt-container';
            completedContainer.style.display = 'none';
            ganttContainer.appendChild(completedContainer);

            // 绑定分隔符点击事件(使用事件委托已在init中设置,这里添加具体逻辑)
            separator.addEventListener('click', () => {
                this.toggleCompletedSection(completedGanttTasks);
            });
        }
    }

    /**
     * 切换已完成任务区域的显示/隐藏
     */
    toggleCompletedSection(completedGanttTasks) {
        const separator = document.getElementById('completed-separator');
        const completedContainer = document.getElementById('completed-gantt-container');

        if (completedContainer.style.display === 'none') {
            // 展开已完成任务区域
            completedContainer.style.display = 'block';
            separator.classList.add('expanded');

            // 懒加载: 如果还没有渲染甘特图,现在渲染
            if (!this.completedGantt) {
                try {
                    this.completedGantt = new Gantt('#completed-gantt-container', completedGanttTasks, {
                        view_mode: 'Week',
                        date_format: 'YYYY-MM-DD',
                        language: 'zh',
                        popup_trigger: 'click',
                        custom_popup_html: (task) => {
                            const originalTask = this.tasks.find(t => t.id === task.id);
                            const startDate = task._start ? new Date(task._start).toLocaleDateString('zh-CN') : task.start;
                            const endDate = task._end ? new Date(task._end).toLocaleDateString('zh-CN') : task.end;
                            return `
                                <div class="gantt-popup" style="padding: 12px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">${task.name}</div>
                                    <div style="font-size: 12px; color: #666;">
                                        <div>项目: ${originalTask?.project || '未分类'}</div>
                                        <div>状态: ${this.getStatusLabel(originalTask?.status)}</div>
                                        <div>开始: ${startDate}</div>
                                        <div>结束: ${endDate}</div>
                                        <div style="margin-top: 8px; color: #28a745;">✓ 已完成</div>
                                    </div>
                                </div>
                            `;
                        },
                        on_click: (task) => {
                            const taskData = this.taskMap?.get(task.id);
                            if (taskData && taskData.children && taskData.children.length > 0) {
                                this.showProjectDetailPopup(taskData);
                            }
                        }
                    });
                    console.log('Completed Gantt initialized with', completedGanttTasks.length, 'tasks');
                } catch (error) {
                    console.error('Failed to initialize Completed Gantt:', error);
                }
            } else {
                // 更新已完成任务甘特图
                this.completedGantt.refresh(completedGanttTasks);
            }
        } else {
            // 折叠已完成任务区域
            completedContainer.style.display = 'none';
            separator.classList.remove('expanded');
        }
    }

    convertToGanttFormat(tasks) {
        // 如果没有任务，返回空数组
        if (!tasks || tasks.length === 0) {
            return [];
        }

        return tasks.map(task => {
            // 确保任务有有效的时间信息
            let start, end;

            if (task.dtstart && task.dtend) {
                start = new Date(task.dtstart);
                end = new Date(task.dtend);
                console.log('Task time info:', task.id, {
                    dtstart: task.dtstart,
                    dtend: task.dtend,
                    parsedStart: start,
                    parsedEnd: end
                });
            } else {
                // 如果没有时间信息，使用当前时间
                console.warn('Task missing time info:', task.id, task);
                start = new Date();
                end = new Date(start.getTime() + 3600000); // 默认1小时
            }

            // 验证日期有效性
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.warn('Invalid date for task:', task.id, task);
                start = new Date();
                end = new Date(start.getTime() + 3600000);
            }

            // 使用任务的progress字段，如果没有则根据状态计算
            let progress = task.progress || 0;
            if (progress === 0) {
                if (task.status === 'completed') progress = 100;
                else if (task.status === 'in_progress') progress = 50;
            }

            // 计算任务持续时间(小时)
            const durationHours = (end - start) / (1000 * 60 * 60);

            // 构建CSS类名
            let customClass = this.getTaskClass(task);

            // 添加任务类型类
            const taskType = task.type || 'default';
            customClass += ` task-type-${taskType}`;

            // 判断是否为项目(有子任务)
            const isProject = task.children && task.children.length > 0;
            if (isProject) {
                customClass += ' task-is-project';
            }

            // 如果任务持续时间超过8小时，添加长任务类
            if (durationHours > 8) {
                customClass += ' task-all-day';
            }

            // 如果是预览状态，添加预览类
            if (task.status === 'preview') {
                customClass += ' task-preview';
            }

            // 为项目添加图标提示
            let displayName = task.title || '未命名任务';
            if (isProject) {
                displayName = `📁 ${displayName}`;
            }

            const ganttTask = {
                id: task.id,
                name: displayName,
                start: this.formatDate(start),
                end: this.formatDate(end),
                progress: progress,
                custom_class: customClass.trim()
            };

            console.log('Converted to Gantt format:', ganttTask);
            return ganttTask;
        });
    }

    /**
     * 构建树状结构
     * 将扁平的任务列表转换为父子关系的树结构
     */
    buildTreeStructure(tasks) {
        const taskMap = new Map();
        const projects = [];

        // 第一遍: 建立ID到任务的映射，并初始化children数组
        tasks.forEach(task => {
            taskMap.set(task.id, { ...task, children: [] });
        });

        // 第二遍: 建立父子关系
        tasks.forEach(task => {
            const taskWithChildren = taskMap.get(task.id);
            if (task.parent_id && taskMap.has(task.parent_id)) {
                // 有父任务，添加到父任务的children中
                const parent = taskMap.get(task.parent_id);
                parent.children.push(taskWithChildren);
            } else {
                // 没有父任务，是顶层项目
                projects.push(taskWithChildren);
            }
        });

        // 第三遍: 动态计算项目属性(起止时间、进度)
        this.processProjectData(projects);

        return { projects, taskMap };
    }

    /**
     * 动态计算项目属性
     * 递归遍历项目及其子任务,计算项目的起止时间和平均进度
     */
    processProjectData(projects) {
        projects.forEach(project => {
            if (project.children && project.children.length > 0) {
                // 递归处理子项目
                this.processProjectData(project.children);

                // 收集所有子任务的时间和进度
                const childTimes = [];
                const childProgresses = [];

                const collectChildData = (children) => {
                    children.forEach(child => {
                        if (child.dtstart) childTimes.push(new Date(child.dtstart));
                        if (child.dtend) childTimes.push(new Date(child.dtend));
                        if (typeof child.progress === 'number') {
                            childProgresses.push(child.progress);
                        }
                        // 递归收集子任务的子任务
                        if (child.children && child.children.length > 0) {
                            collectChildData(child.children);
                        }
                    });
                };

                collectChildData(project.children);

                // 计算项目的起止时间(只在有子任务时间时才覆盖)
                if (childTimes.length > 0) {
                    const minTime = new Date(Math.min(...childTimes));
                    const maxTime = new Date(Math.max(...childTimes));
                    project.dtstart = minTime.toISOString();
                    project.dtend = maxTime.toISOString();
                }
                // 如果项目有子任务但子任务都没有时间，保留项目原有的时间
                // (不做任何操作，保持 project.dtstart 和 project.dtend 不变)

                // 计算项目的平均进度
                if (childProgresses.length > 0) {
                    const avgProgress = childProgresses.reduce((sum, p) => sum + p, 0) / childProgresses.length;
                    project.progress = Math.round(avgProgress);
                }
            }
            // 如果项目没有子任务，保留其原始时间信息
            // (不做任何操作，直接使用创建时填写的 dtstart 和 dtend)
        });
    }

    /**
     * 根据展开状态生成用于显示的扁平列表
     * 注意：由于现在使用弹窗显示项目详情，主甘特图中默认只显示顶层项目
     */
    generateDisplayList(projects) {
        const displayTasks = [];

        // 只添加顶层项目，不展开子任务（子任务在弹窗中查看）
        projects.forEach(project => {
            displayTasks.push({ ...project, _level: 0 });
        });

        return displayTasks;
    }






    /**
     * 显示项目详情弹窗（带内部任务甘特图）
     */
    showProjectDetailPopup(projectTask) {
        // 创建模态窗口
        const modal = document.createElement('div');
        modal.className = 'project-detail-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // 创建弹窗内容容器
        const modalContent = document.createElement('div');
        modalContent.className = 'project-detail-content';
        modalContent.style.cssText = `
            background: white;
            border-radius: 8px;
            width: 90%;
            max-width: 1200px;
            height: 80%;
            max-height: 800px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        `;

        // 创建标题栏
        const header = document.createElement('div');
        header.className = 'project-detail-header';
        header.style.cssText = `
            padding: 20px 24px;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f5f5f5;
            border-radius: 8px 8px 0 0;
        `;
        header.innerHTML = `
            <div>
                <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #333;">${projectTask.title}</h2>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #666;">项目内部任务视图 (${projectTask.children.length} 个任务)</p>
            </div>
            <button class="close-modal-btn" style="background: none; border: none; font-size: 28px; cursor: pointer; color: #999; line-height: 1; padding: 0; width: 32px; height: 32px;">&times;</button>
        `;

        // 创建甘特图容器
        const ganttContainer = document.createElement('div');
        ganttContainer.className = 'project-detail-gantt-container';
        ganttContainer.style.cssText = `
            flex: 1;
            overflow: auto;
            padding: 16px;
        `;
        ganttContainer.innerHTML = '<div id="project-detail-gantt"></div>';

        // 组装弹窗
        modalContent.appendChild(header);
        modalContent.appendChild(ganttContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // 绑定关闭事件
        const closeBtn = header.querySelector('.close-modal-btn');
        const closeModal = () => {
            modal.remove();
        };
        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // 准备数据并渲染甘特图
        const childTasks = projectTask.children || [];
        if (childTasks.length === 0) {
            ganttContainer.innerHTML = '<div style="text-align: center; padding: 60px; color: #999;">该项目暂无子任务</div>';
            return;
        }

        // 转换为甘特图格式
        const ganttTasks = this.convertToGanttFormat(childTasks);

        // 实例化甘特图
        try {
            new Gantt('#project-detail-gantt', ganttTasks, {
                view_mode: 'Week',
                date_format: 'YYYY-MM-DD',
                language: 'zh',
                popup_trigger: 'click',
                custom_popup_html: (task) => {
                    const originalTask = childTasks.find(t => t.id === task.id);
                    const startDate = task._start ? new Date(task._start).toLocaleDateString('zh-CN') : task.start;
                    const endDate = task._end ? new Date(task._end).toLocaleDateString('zh-CN') : task.end;
                    return `
                        <div class="gantt-popup" style="padding: 12px;">
                            <div style="font-weight: 600; margin-bottom: 8px;">${task.name}</div>
                            <div style="font-size: 12px; color: #666;">
                                <div>状态: ${this.getStatusLabel(originalTask?.status)}</div>
                                <div>开始: ${startDate}</div>
                                <div>结束: ${endDate}</div>
                            </div>
                        </div>
                    `;
                },
                on_date_change: (task, start, end) => {
                    this.handleDateChange(task, start, end);
                },
                on_click: (task) => {
                    console.log('Subtask clicked:', task.id);
                }
            });
        } catch (error) {
            console.error('Failed to initialize project detail gantt:', error);
            ganttContainer.innerHTML = `<div style="color: red; padding: 20px;">甘特图初始化失败: ${error.message}</div>`;
        }
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

    /**
     * 使用事件委托模式设置右键菜单和双击编辑
     * 只在 init() 中调用一次,避免重复绑定
     */
    setupEventDelegation() {
        const ganttContainer = this.container.querySelector('.gantt-chart-container');

        // 右键菜单事件委托
        ganttContainer.addEventListener('contextmenu', (e) => {
            // 查找最近的任务条元素
            const barWrapper = e.target.closest('.bar-wrapper');

            if (barWrapper) {
                e.preventDefault();
                e.stopPropagation();

                const taskId = barWrapper.getAttribute('data-id');
                const task = this.taskMap?.get(taskId) || this.tasks.find(t => t.id === taskId);

                if (task) {
                    this.showContextMenu(e, task);
                }

                return false;
            }
        }, true); // 使用捕获模式确保优先执行

        // 双击编辑事件委托
        ganttContainer.addEventListener('dblclick', (e) => {
            // 查找最近的任务条元素
            const barWrapper = e.target.closest('.bar-wrapper');

            if (barWrapper) {
                e.preventDefault();
                e.stopPropagation();

                const taskId = barWrapper.getAttribute('data-id');

                // 检查是否是占位任务
                if (taskId === 'placeholder-task') {
                    console.log('Double-clicked placeholder task, opening create project modal');
                    this.workspaceView.showCreateProjectModal({ start: new Date(), end: new Date() });
                    return;
                }

                const task = this.taskMap?.get(taskId) || this.tasks.find(t => t.id === taskId);

                if (task) {
                    // 检查是否是项目（有子任务）
                    const isProject = task.children && task.children.length > 0;

                    if (isProject) {
                        console.log('Double-clicked project, opening edit modal');
                    } else {
                        console.log('Double-clicked task, opening edit modal');
                    }

                    this.workspaceView.showEditTaskModal(task);
                }
            }
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

        // 判断是否为项目(有子任务)
        const isProject = task.children && task.children.length > 0;

        // 根据任务类型动态生成菜单项
        let menuItems = `
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
        `;

        // 项目显示"查看子任务"，任务显示"添加子任务"
        if (isProject) {
            menuItems += `
            <div class="menu-item" data-action="view_subtasks" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>📋</span><span>查看子任务 (${task.children.length})</span>
            </div>
            <div class="menu-item" data-action="add_subtask" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>➕</span><span>添加子任务</span>
            </div>
            `;
        } else {
            menuItems += `
            <div class="menu-item" data-action="add_subtask" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px;">
                <span>➕</span><span>添加子任务</span>
            </div>
            `;
        }

        // 删除按钮
        menuItems += `
            <div class="menu-item" data-action="delete" style="padding: 12px 16px; cursor: pointer; color: #F44336; display: flex; align-items: center; gap: 8px;">
                <span>🗑️</span><span>删除${isProject ? '项目' : '任务'}</span>
            </div>
        `;

        menu.innerHTML = menuItems;

        document.body.appendChild(menu);

        // 绑定进度条点击事件
        const progressSelector = menu.querySelector('#progress-selector');
        progressSelector.addEventListener('click', (e) => {
            const batteryIcon = e.target.closest('.battery-icon');
            if (batteryIcon) {
                const level = parseInt(batteryIcon.getAttribute('data-level'));
                const newProgress = level * 10;

                // 如果进度达到100%,自动标记为完成
                if (newProgress === 100) {
                    this.workspaceView.updateTaskState(task.id, {
                        progress: 100,
                        status: 'completed'
                    });
                } else {
                    // 否则只更新进度
                    this.workspaceView.updateTaskState(task.id, { progress: newProgress });
                }

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

                // 如果达到100%,关闭菜单并刷新视图
                if (newProgress === 100) {
                    setTimeout(() => {
                        menu.remove();
                    }, 300);
                }
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
            case 'view_subtasks':
                this.showProjectDetailPopup(task);
                break;
            case 'add_subtask':
                this.showAddSubtaskDialog(task);
                break;
            case 'delete':
                const isProject = task.children && task.children.length > 0;
                const itemType = isProject ? '项目' : '任务';
                const warningMsg = isProject
                    ? `确定要删除项目 "${task.title}" 及其所有子任务吗?`
                    : `确定要删除任务 "${task.title}" 吗?`;

                if (confirm(warningMsg)) {
                    this.deleteTask(task.id);
                }
                break;
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

    /**
     * 创建占位任务，用于在没有真实任务时显示空甘特图
     */
    createPlaceholderTask() {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        return [{
            id: 'placeholder-task',
            name: '暂无任务 - 请使用左侧 Copilot 创建任务',
            start: this.formatDate(today),
            end: this.formatDate(tomorrow),
            progress: 0,
            custom_class: 'task-placeholder'
        }];
    }
}
