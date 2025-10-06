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

        // 脏任务集合(被用户修改过的任务ID)
        this.dirtyTasks = new Set();

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
        this.saveButton = null;
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
                    </div>
                    <button class="workspace-save-btn" style="padding: 8px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; display: none;">
                        💾 保存更改
                    </button>
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
        this.saveButton = this.container.querySelector('.workspace-save-btn');

        // 绑定返回按钮
        this.container.querySelector('.workspace-back-btn').addEventListener('click', () => {
            this.app.exitWorkspaceMode();
        });

        // 绑定保存按钮
        this.saveButton.addEventListener('click', () => this.saveAllChanges());
    }

    async initializeViews() {
        // 获取 API 配置
        const apiSettings = this.app.apiSettings || {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey: '',
            model: 'gpt-4'
        };

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

            this.tasks = tasks;

            // 同步到 Gantt 和 Calendar
            this.ganttView.render(this.tasks);
            this.calendarView.render(this.tasks);

            console.log('Tasks loaded and synced:', this.tasks);
        } catch (error) {
            console.error('Failed to load tasks:', error);
        }
    }

    // 由子视图调用,更新任务状态并标记为脏
    updateTaskState(taskId, updatedData) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;

        // 更新任务数据
        Object.assign(this.tasks[taskIndex], updatedData);

        // 标记为脏
        this.dirtyTasks.add(taskId);

        // 显示保存按钮
        this.saveButton.style.display = 'block';

        console.log('Task state updated:', taskId, updatedData);
    }

    async saveAllChanges() {
        if (this.dirtyTasks.size === 0) {
            alert('没有需要保存的更改');
            return;
        }

        const savePromises = [];

        for (const taskId of this.dirtyTasks) {
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) continue;

            // 构建更新数据
            const updates = {
                title: task.title,
                status: task.status,
                project: task.project,
                dtstart: task.dtstart,
                dtend: task.dtend,
                content: task.content
            };

            if (task.review) {
                updates.review = task.review;
            }

            // 调用更新 API
            const promise = fetch('/agent/tasks/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tool: 'update_task',
                    args: {
                        task_id: taskId,
                        updates: updates
                    }
                })
            });

            savePromises.push(promise);
        }

        try {
            await Promise.all(savePromises);

            // 清空脏任务集合
            this.dirtyTasks.clear();

            // 隐藏保存按钮
            this.saveButton.style.display = 'none';

            alert('✅ 所有更改已成功保存!');

            // 重新加载任务
            await this.loadAndSyncTasks();
        } catch (error) {
            console.error('Failed to save changes:', error);
            alert('❌ 保存失败: ' + error.message);
        }
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
}
