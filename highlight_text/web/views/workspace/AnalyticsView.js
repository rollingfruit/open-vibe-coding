/**
 * AnalyticsView - 统计分析视图
 * 展示任务完成率、项目分布、复盘评分趋势等数据
 */
export class AnalyticsView {
    constructor(container, tasks) {
        this.container = container;
        this.tasks = tasks;
    }

    init() {
        this.container.innerHTML = `
            <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">📊 数据分析与复盘</h3>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                <!-- 任务完成率 -->
                <div class="analytics-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #666;">任务完成率</h4>
                    <div class="completion-chart"></div>
                </div>

                <!-- 项目分布 -->
                <div class="analytics-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #666;">项目分布</h4>
                    <div class="project-chart"></div>
                </div>

                <!-- 复盘评分 -->
                <div class="analytics-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #666;">平均复盘评分</h4>
                    <div class="review-chart"></div>
                </div>
            </div>
        `;

        this.renderCompletionChart();
        this.renderProjectChart();
        this.renderReviewChart();
    }

    renderCompletionChart() {
        const container = this.container.querySelector('.completion-chart');

        const completed = this.tasks.filter(t => t.status === 'completed').length;
        const inProgress = this.tasks.filter(t => t.status === 'in_progress').length;
        const pending = this.tasks.filter(t => t.status === 'pending').length;
        const total = this.tasks.length;

        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

        container.innerHTML = `
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 48px; font-weight: 700; color: #4CAF50;">${completionRate}%</div>
                <div style="font-size: 12px; color: #999;">完成率</div>
            </div>

            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <div style="flex: ${completed}; background: #4CAF50; height: 8px; border-radius: 4px;"></div>
                <div style="flex: ${inProgress}; background: #2196F3; height: 8px; border-radius: 4px;"></div>
                <div style="flex: ${pending}; background: #FFC107; height: 8px; border-radius: 4px;"></div>
            </div>

            <div style="display: flex; justify-content: space-around; font-size: 12px; color: #666;">
                <div><span style="color: #4CAF50;">●</span> 已完成 ${completed}</div>
                <div><span style="color: #2196F3;">●</span> 进行中 ${inProgress}</div>
                <div><span style="color: #FFC107;">●</span> 待处理 ${pending}</div>
            </div>
        `;
    }

    renderProjectChart() {
        const container = this.container.querySelector('.project-chart');

        // 按项目统计
        const projectStats = {};
        this.tasks.forEach(task => {
            const project = task.project || '未分类';
            if (!projectStats[project]) {
                projectStats[project] = 0;
            }
            projectStats[project]++;
        });

        const projects = Object.keys(projectStats);
        const colors = ['#2196F3', '#4CAF50', '#FFC107', '#F44336', '#9C27B0', '#00BCD4'];

        let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';

        projects.forEach((project, index) => {
            const count = projectStats[project];
            const percentage = Math.round((count / this.tasks.length) * 100);
            const color = colors[index % colors.length];

            html += `
                <div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px;">
                        <span>${project}</span>
                        <span style="color: #999;">${count} (${percentage}%)</span>
                    </div>
                    <div style="background: #f0f0f0; height: 6px; border-radius: 3px; overflow: hidden;">
                        <div style="background: ${color}; width: ${percentage}%; height: 100%;"></div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    renderReviewChart() {
        const container = this.container.querySelector('.review-chart');

        // 计算平均评分
        const reviewedTasks = this.tasks.filter(t => t.review && t.review.score);

        if (reviewedTasks.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #999;">
                    暂无复盘数据
                </div>
            `;
            return;
        }

        const totalScore = reviewedTasks.reduce((sum, t) => sum + (t.review.score || 0), 0);
        const avgScore = (totalScore / reviewedTasks.length).toFixed(1);

        const totalEfficiency = reviewedTasks.reduce((sum, t) => sum + (t.review.metrics?.efficiency || 0), 0);
        const avgEfficiency = (totalEfficiency / reviewedTasks.length).toFixed(1);

        const totalQuality = reviewedTasks.reduce((sum, t) => sum + (t.review.metrics?.quality || 0), 0);
        const avgQuality = (totalQuality / reviewedTasks.length).toFixed(1);

        container.innerHTML = `
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 48px; font-weight: 700; color: #FF9800;">${avgScore}</div>
                <div style="font-size: 12px; color: #999;">平均评分 (满分5分)</div>
            </div>

            <div style="display: flex; justify-content: space-around; font-size: 13px;">
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 600; color: #2196F3;">${avgEfficiency}</div>
                    <div style="color: #666; margin-top: 4px;">效率</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 600; color: #4CAF50;">${avgQuality}</div>
                    <div style="color: #666; margin-top: 4px;">质量</div>
                </div>
            </div>

            <div style="margin-top: 16px; padding: 12px; background: #f9f9f9; border-radius: 4px; font-size: 12px; color: #666;">
                已复盘任务: ${reviewedTasks.length} / ${this.tasks.length}
            </div>
        `;
    }
}
