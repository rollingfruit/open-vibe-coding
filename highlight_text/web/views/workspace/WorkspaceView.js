/**
 * WorkspaceView - 工作台三栏布局总控制器
 * 负责协调 TaskAgentHandler, GanttView, CalendarView 之间的数据同步
 */
import { TaskAgentHandler } from '../../agent/tasks/TaskAgentHandler.js';
import { GanttView } from './GanttView.js';
import { CalendarView } from './CalendarView.js';
import { AnalyticsView } from './AnalyticsView.js';

export class WorkspaceView {
    constructor(containerSelector, app) {
        this.container = document.querySelector(containerSelector);
        this.app = app;

        // 共享任务数据
        this.tasks = [];

        // 自动保存防抖定时器
        this.autoSaveTimer = null;

        // 子视图
        this.taskAgent = null;
        this.ganttView = null;
        this.calendarView = null;
        this.analyticsView = null;

        // UI 元素
        this.leftColumn = null;
        this.middleColumn = null;
        this.rightColumn = null;
        this.analyticsContainer = null;
    }

    async init() {
        this.buildLayout();
        await this.initializeViews();
        await this.loadAndSyncTasks();
        this.setupScrollListener();
    }

    buildLayout() {
        this.container.innerHTML = `
            <div class="workspace-layout" style="display: flex; flex-direction: column; height: 100vh; background: #f5f5f5;">
                <!-- 顶部工具栏 -->
                <div class="workspace-toolbar" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e0e0e0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <button class="workspace-back-btn" style="padding: 8px 16px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                            <span>←</span>
                            <span>返回</span>
                        </button>
                        <h2 style="margin: 0; font-size: 18px; font-weight: 600;">📊 工作管理</h2>
                        <span class="auto-save-indicator" style="font-size: 12px; color: #666; display: none;">
                            ✓ 自动保存中...
                        </span>
                    </div>
                    <div>
                        <button id="show-analytics-btn" class="px-3 py-1 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded text-sm font-medium transition-all shadow-sm hover:shadow-md">
                            📊 数据分析
                        </button>
                    </div>
                </div>

                <!-- 三栏内容区 -->
                <div class="workspace-content" style="flex: 1; display: flex; overflow: hidden;">
                    <!-- 左侧: TaskAgent -->
                    <div class="workspace-left" style="width: 320px; border-right: 1px solid #e0e0e0; background: #fff; overflow-y: auto;">
                    </div>

                    <!-- 中间: Gantt Chart -->
                    <div class="workspace-middle" style="flex: 1; background: #fff; overflow: auto; padding: 16px;">
                    </div>

                    <!-- 右侧: Calendar -->
                    <div class="workspace-right" style="width: 380px; border-left: 1px solid #e0e0e0; background: #fff; overflow-y: auto;">
                    </div>
                </div>

                <!-- 统计分析区域(默认隐藏,向下滚动时加载) -->
                <div class="workspace-analytics" style="display: none; background: #fafafa; padding: 24px; border-top: 1px solid #e0e0e0;">
                </div>
            </div>
        `;

        this.leftColumn = this.container.querySelector('.workspace-left');
        this.middleColumn = this.container.querySelector('.workspace-middle');
        this.rightColumn = this.container.querySelector('.workspace-right');
        this.analyticsContainer = this.container.querySelector('.workspace-analytics');
        this.autoSaveIndicator = this.container.querySelector('.auto-save-indicator');

        // 绑定返回按钮
        this.container.querySelector('.workspace-back-btn').addEventListener('click', () => {
            this.app.exitWorkspaceMode();
        });

        // 绑定数据分析按钮
        this.container.querySelector('#show-analytics-btn').addEventListener('click', () => {
            // 检查分析区域是否已显示
            if (this.analyticsContainer.style.display === 'block') {
                // 如果已显示，则隐藏
                this.analyticsContainer.style.display = 'none';
            } else {
                // 如果未显示，则显示并滚动到该区域
                this.scrollToAnalytics();
            }
        });
    }

    /**
     * 平滑滚动到数据分析区域
     */
    async scrollToAnalytics() {
        // 如果分析视图还没初始化,先加载
        if (!this.analyticsView) {
            await this.loadAnalytics();
        }

        // 显示分析区域
        this.analyticsContainer.style.display = 'block';

        // 平滑滚动到分析视图
        this.analyticsContainer.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }

    async initializeViews() {
        // 获取 API 配置
        const apiSettings = this.app.apiSettings

        // 初始化 TaskAgent
        this.taskAgent = new TaskAgentHandler(this.leftColumn, this, apiSettings);
        await this.taskAgent.init();

        // 初始化 GanttView
        this.ganttView = new GanttView(this.middleColumn, this);
        this.ganttView.init();

        // 初始化 CalendarView
        this.calendarView = new CalendarView(this.rightColumn, this);
        await this.calendarView.init();
    }

    async loadAndSyncTasks() {
        try {
            const response = await fetch('/api/tasks');
            const tasks = await response.json();

            this.tasks = Array.isArray(tasks) ? tasks : [];

            // 同步到 Gantt 和 Calendar
            this.ganttView.render(this.tasks);
            this.calendarView.render(this.tasks);

            console.log('Tasks loaded and synced:', this.tasks);
        } catch (error) {
            console.error('Failed to load tasks:', error);
            this.tasks = []; // 确保即使出错也是空数组
            this.ganttView.render(this.tasks);
            this.calendarView.render(this.tasks);
        }
    }

    // 由子视图调用,更新任务状态并自动保存(带防抖)
    updateTaskState(taskId, updatedData) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;

        const task = this.tasks[taskIndex];

        // 检查是否是目标(无parent_id)且进度达到100%
        const isGoal = !task.parent_id;
        const wasIncomplete = task.progress !== 100;
        const isNowComplete = updatedData.progress === 100;

        // 更新本地任务数据
        Object.assign(this.tasks[taskIndex], updatedData);

        console.log('Task state updated:', taskId, updatedData);

        // 如果是目标达成,触发庆祝动画
        if (isGoal && wasIncomplete && isNowComplete) {
            this.triggerGoalCompletionCelebration(this.tasks[taskIndex]);
        }

        // 清除之前的定时器
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }

        // 显示保存指示器
        if (this.autoSaveIndicator) {
            this.autoSaveIndicator.style.display = 'inline';
        }

        // 300ms 防抖,避免快速拖动时产生过多API调用
        this.autoSaveTimer = setTimeout(async () => {
            try {
                await this.saveTaskToBackend(taskId, updatedData);

                // 保存成功后隐藏指示器
                if (this.autoSaveIndicator) {
                    this.autoSaveIndicator.textContent = '✓ 已保存';
                    setTimeout(() => {
                        if (this.autoSaveIndicator) {
                            this.autoSaveIndicator.style.display = 'none';
                        }
                    }, 2000);
                }
            } catch (error) {
                console.error('Auto-save failed:', error);
                if (this.autoSaveIndicator) {
                    this.autoSaveIndicator.textContent = '✗ 保存失败';
                    this.autoSaveIndicator.style.color = '#F44336';
                }
            }
        }, 300);
    }

    async saveTaskToBackend(taskId, updatedData) {
        const response = await fetch('/agent/tasks/execute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tool: 'update_task',
                args: {
                    task_id: taskId,
                    updates: updatedData
                }
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save task');
        }

        const result = await response.json();
        console.log('Task saved to backend:', result);
        return result;
    }

    setupScrollListener() {
        const contentArea = this.container.querySelector('.workspace-content');
        const threshold = 100; // 距离底部100px时加载

        contentArea.addEventListener('scroll', () => {
            const scrollHeight = contentArea.scrollHeight;
            const scrollTop = contentArea.scrollTop;
            const clientHeight = contentArea.clientHeight;

            if (scrollHeight - scrollTop - clientHeight < threshold) {
                this.loadAnalytics();
            }
        });
    }

    async loadAnalytics() {
        if (this.analyticsView) return; // 已加载

        this.analyticsContainer.style.display = 'block';

        this.analyticsView = new AnalyticsView(this.analyticsContainer, this.tasks);
        this.analyticsView.init();
    }

    // 显示复盘弹窗
    showReviewModal(task) {
        const modal = document.createElement('div');
        modal.className = 'review-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="background: white; border-radius: 8px; padding: 24px; width: 500px; max-width: 90%;">
                <h3 style="margin: 0 0 16px 0;">📝 任务复盘: ${task.title}</h3>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">整体评分 (1-5):</label>
                    <input type="number" class="review-score" min="1" max="5" value="${task.review?.score || 3}"
                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">效率 (1-5):</label>
                    <input type="number" class="review-efficiency" min="1" max="5" value="${task.review?.metrics?.efficiency || 3}"
                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">质量 (1-5):</label>
                    <input type="number" class="review-quality" min="1" max="5" value="${task.review?.metrics?.quality || 3}"
                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">复盘笔记:</label>
                    <textarea class="review-notes" rows="4"
                              style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: inherit;">${task.review?.notes || ''}</textarea>
                </div>

                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button class="review-cancel" style="padding: 8px 16px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer;">
                        取消
                    </button>
                    <button class="review-save" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
                        保存复盘
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 绑定事件
        modal.querySelector('.review-cancel').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('.review-save').addEventListener('click', () => {
            const score = parseInt(modal.querySelector('.review-score').value);
            const efficiency = parseInt(modal.querySelector('.review-efficiency').value);
            const quality = parseInt(modal.querySelector('.review-quality').value);
            const notes = modal.querySelector('.review-notes').value;

            // 更新任务的复盘数据
            this.updateTaskState(task.id, {
                review: {
                    score: score,
                    metrics: {
                        efficiency: efficiency,
                        quality: quality
                    },
                    notes: notes
                },
                status: 'completed' // 复盘后标记为已完成
            });

            modal.remove();
        });
    }

    /**
     * 显示编辑任务的弹窗
     * @param {Object} taskToEdit - 要编辑的任务对象
     */
    showEditTaskModal(taskToEdit) {
        // 移除已存在的弹窗
        const existingModal = document.querySelector('.task-edit-modal');
        if (existingModal) existingModal.remove();

        // 格式化时间为本地字符串
        const formatDateTime = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };

        // 获取所有可能的父项目
        const availableParents = this.tasks.filter(t => !t.parent_id && t.id !== taskToEdit.id);

        // 创建弹窗
        const modal = document.createElement('div');
        modal.className = 'task-edit-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div class="modal-content" style="background: white; border-radius: 8px; padding: 24px; width: 90%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); max-height: 80vh; overflow-y: auto;">
                <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">编辑任务</h3>

                <form id="edit-task-form">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">任务名称 *</label>
                        <input type="text" id="task-title" required value="${taskToEdit.title || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">任务分类</label>
                        <select id="task-type" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                            <option value="" ${!taskToEdit.type ? 'selected' : ''}>默认</option>
                            <option value="work" ${taskToEdit.type === 'work' ? 'selected' : ''}>工作 (蓝色)</option>
                            <option value="personal" ${taskToEdit.type === 'personal' ? 'selected' : ''}>个人 (绿色)</option>
                            <option value="study" ${taskToEdit.type === 'study' ? 'selected' : ''}>学习 (橙色)</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">所属项目</label>
                        <select id="task-parent" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                            <option value="" ${!taskToEdit.parent_id ? 'selected' : ''}>无 (独立任务)</option>
                            ${availableParents.map(p => `<option value="${p.id}" ${taskToEdit.parent_id === p.id ? 'selected' : ''}>${p.title}</option>`).join('')}
                        </select>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">开始时间 *</label>
                        <input type="datetime-local" id="task-start" required value="${formatDateTime(taskToEdit.dtstart)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">结束时间 *</label>
                        <input type="datetime-local" id="task-end" required value="${formatDateTime(taskToEdit.dtend)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">任务描述</label>
                        <textarea id="task-content" rows="4" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; font-family: inherit;">${taskToEdit.content || ''}</textarea>
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" id="cancel-btn" style="padding: 8px 20px; background: #f5f5f5; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">取消</button>
                        <button type="submit" style="padding: 8px 20px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">保存</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // 绑定取消按钮
        modal.querySelector('#cancel-btn').addEventListener('click', () => {
            modal.remove();
        });

        // 绑定表单提交
        modal.querySelector('#edit-task-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = modal.querySelector('#task-title').value.trim();
            const type = modal.querySelector('#task-type').value;
            const parentIdValue = modal.querySelector('#task-parent').value;
            const startTime = new Date(modal.querySelector('#task-start').value).toISOString();
            const endTime = new Date(modal.querySelector('#task-end').value).toISOString();
            const content = modal.querySelector('#task-content').value.trim();

            if (!title) {
                alert('请输入任务名称');
                return;
            }

            // 构建更新参数
            const updates = {
                title: title,
                dtstart: startTime,
                dtend: endTime
            };

            if (type) updates.type = type;
            if (parentIdValue) updates.parent_id = parentIdValue;
            if (content) updates.content = content;

            try {
                await this.saveTaskToBackend(taskToEdit.id, updates);
                modal.remove();
                await this.loadAndSyncTasks();
            } catch (error) {
                alert('更新任务失败: ' + error.message);
            }
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    /**
     * 显示创建项目的弹窗(不包含parent_id字段)
     * @param {Object} options - {start: Date, end: Date}
     */
    showCreateProjectModal({ start, end }) {
        // 移除已存在的弹窗
        const existingModal = document.querySelector('.project-create-modal');
        if (existingModal) existingModal.remove();

        // 格式化时间为本地字符串
        const formatDateTime = (date) => {
            const d = new Date(date);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };

        // 创建弹窗
        const modal = document.createElement('div');
        modal.className = 'project-create-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div class="modal-content" style="background: white; border-radius: 8px; padding: 24px; width: 90%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">🎯 设定一个新目标</h3>

                <form id="create-project-form">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">目标描述 *</label>
                        <input type="text" id="project-title" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" placeholder="我想要实现... (例如:上线V2.0产品)">
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">项目分类</label>
                        <select id="project-type" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                            <option value="">默认</option>
                            <option value="work">工作 (蓝色)</option>
                            <option value="personal">个人 (绿色)</option>
                            <option value="study">学习 (橙色)</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">开始时间 *</label>
                        <input type="datetime-local" id="project-start" required value="${formatDateTime(start)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">结束时间 *</label>
                        <input type="datetime-local" id="project-end" required value="${formatDateTime(end)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" id="cancel-btn" style="padding: 8px 20px; background: #f5f5f5; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">取消</button>
                        <button type="submit" style="padding: 8px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">设定目标</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // 绑定取消按钮
        modal.querySelector('#cancel-btn').addEventListener('click', () => {
            modal.remove();
        });

        // 绑定表单提交
        modal.querySelector('#create-project-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = modal.querySelector('#project-title').value.trim();
            const type = modal.querySelector('#project-type').value;
            const startTime = new Date(modal.querySelector('#project-start').value).toISOString();
            const endTime = new Date(modal.querySelector('#project-end').value).toISOString();

            if (!title) {
                alert('请输入项目名称');
                return;
            }

            // 构建项目参数(不包含parent_id,使其成为顶层项目)
            const projectArgs = {
                title: title,
                dtstart: startTime,
                dtend: endTime
            };

            // 如果用户选择了类型，传递给后端；否则传递 "default"
            projectArgs.type = type || "default";

            try {
                const result = await this.taskAgent.executeTool('create_task', projectArgs);
                const data = JSON.parse(result);

                if (data.success) {
                    modal.remove();
                    await this.loadAndSyncTasks();
                } else {
                    alert('创建项目失败: ' + (data.error || '未知错误'));
                }
            } catch (error) {
                alert('创建项目失败: ' + error.message);
            }
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    /**
     * 显示创建任务的弹窗
     * @param {Object} options - {start: Date, end: Date, parentId?: string}
     */
    showCreateTaskModal({ start, end, parentId = null}) {
        // 移除已存在的弹窗
        const existingModal = document.querySelector('.task-create-modal');
        if (existingModal) existingModal.remove();

        // 格式化时间为本地字符串
        const formatDateTime = (date) => {
            const d = new Date(date);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };

        // 获取所有可能的父项目
        const availableParents = (this.tasks || []).filter(t => !t.parent_id);

        // 创建弹窗
        const modal = document.createElement('div');
        modal.className = 'task-create-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div class="modal-content" style="background: white; border-radius: 8px; padding: 24px; width: 90%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">创建新任务</h3>

                <form id="create-task-form">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">任务名称 *</label>
                        <input type="text" id="task-title" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" placeholder="输入任务名称">
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">任务分类</label>
                        <select id="task-type" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                            <option value="">默认</option>
                            <option value="work">工作 (蓝色)</option>
                            <option value="personal">个人 (绿色)</option>
                            <option value="study">学习 (橙色)</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">关联目标/关键结果</label>
                        <select id="task-parent" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                            <option value="">无 (独立任务)</option>
                            ${availableParents.map(p => `<option value="${p.id}">${p.title}</option>`).join('')}
                        </select>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">开始时间 *</label>
                        <input type="datetime-local" id="task-start" required value="${formatDateTime(start)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">结束时间 *</label>
                        <input type="datetime-local" id="task-end" required value="${formatDateTime(end)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" id="cancel-btn" style="padding: 8px 20px; background: #f5f5f5; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">取消</button>
                        <button type="submit" style="padding: 8px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">创建</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // 如果有预设的父项目，选中它
        if (parentId) {
            const parentSelect = modal.querySelector('#task-parent');
            parentSelect.value = parentId;
            parentSelect.disabled = true;
        }

        // 绑定取消按钮
        modal.querySelector('#cancel-btn').addEventListener('click', () => {
            modal.remove();
        });

        // 绑定表单提交
        modal.querySelector('#create-task-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = modal.querySelector('#task-title').value.trim();
            const type = modal.querySelector('#task-type').value;
            const parentIdValue = modal.querySelector('#task-parent').value;
            const startTime = new Date(modal.querySelector('#task-start').value).toISOString();
            const endTime = new Date(modal.querySelector('#task-end').value).toISOString();

            if (!title) {
                alert('请输入任务名称');
                return;
            }

            // 构建任务参数
            const taskArgs = {
                title: title,
                dtstart: startTime,
                dtend: endTime
            };

            if (type) taskArgs.type = type;
            if (parentIdValue) taskArgs.parent_id = parentIdValue;

            try {
                const result = await this.taskAgent.executeTool('create_task', taskArgs);
                const data = JSON.parse(result);

                if (data.success) {
                    modal.remove();
                    await this.loadAndSyncTasks();
                } else {
                    alert('创建任务失败: ' + (data.error || '未知错误'));
                }
            } catch (error) {
                alert('创建任务失败: ' + error.message);
            }
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    /**
     * 触发目标达成庆祝动画
     */
    triggerGoalCompletionCelebration(task) {
        // 创建庆祝覆盖层
        const overlay = document.createElement('div');
        overlay.className = 'celebration-overlay';

        // 添加彩带效果
        for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}%`;
            confetti.style.background = `hsl(${Math.random() * 360}, 70%, 60%)`;
            confetti.style.animationDelay = `${Math.random() * 0.5}s`;
            overlay.appendChild(confetti);
        }

        // 添加星星效果
        for (let i = 0; i < 30; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 100}%`;
            star.style.animationDelay = `${Math.random() * 2}s`;
            overlay.appendChild(star);
        }

        // 计算任务统计数据
        const childTasks = this.tasks.filter(t => t.parent_id === task.id);
        const completedCount = childTasks.filter(t => t.status === 'completed').length;
        const duration = task.dtstart && task.dtend
            ? Math.ceil((new Date(task.dtend) - new Date(task.dtstart)) / (1000 * 60 * 60 * 24))
            : 0;

        // 计算平均复盘得分
        const reviewedTasks = childTasks.filter(t => t.review && t.review.score);
        const avgScore = reviewedTasks.length > 0
            ? (reviewedTasks.reduce((sum, t) => sum + t.review.score, 0) / reviewedTasks.length).toFixed(1)
            : '未评分';

        // 创建成就卡片
        const achievementCard = document.createElement('div');
        achievementCard.className = 'achievement-card';
        achievementCard.innerHTML = `
            <div class="achievement-icon">🎉</div>
            <div class="achievement-title">目标达成!</div>
            <div class="achievement-subtitle">${task.title}</div>
            <div class="achievement-stats">
                <div class="achievement-stat">
                    <span class="achievement-stat-value">${completedCount}</span>
                    <span class="achievement-stat-label">完成任务</span>
                </div>
                <div class="achievement-stat">
                    <span class="achievement-stat-value">${duration}天</span>
                    <span class="achievement-stat-label">历时</span>
                </div>
                <div class="achievement-stat">
                    <span class="achievement-stat-value">${avgScore}</span>
                    <span class="achievement-stat-label">平均评分</span>
                </div>
            </div>
            <div class="achievement-actions">
                <button class="achievement-btn achievement-btn-primary next-goal-btn">
                    设定下一个目标
                </button>
                <button class="achievement-btn achievement-btn-secondary close-celebration-btn">
                    关闭
                </button>
            </div>
        `;

        overlay.appendChild(achievementCard);
        document.body.appendChild(overlay);

        // 绑定按钮事件
        const nextGoalBtn = achievementCard.querySelector('.next-goal-btn');
        const closeBtn = achievementCard.querySelector('.close-celebration-btn');

        nextGoalBtn.addEventListener('click', () => {
            overlay.classList.add('celebration-fade-out');
            setTimeout(() => {
                overlay.remove();
                // 打开创建目标弹窗
                this.showCreateProjectModal({
                    start: new Date(),
                    end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 默认一周后
                });
            }, 500);
        });

        closeBtn.addEventListener('click', () => {
            overlay.classList.add('celebration-fade-out');
            setTimeout(() => overlay.remove(), 500);
        });

        // 3秒后自动淡出
        setTimeout(() => {
            if (overlay.parentElement) {
                overlay.classList.add('celebration-fade-out');
                setTimeout(() => {
                    if (overlay.parentElement) overlay.remove();
                }, 500);
            }
        }, 5000);
    }
}
