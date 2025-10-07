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

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; margin-bottom: 24px;">
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

            <!-- 新增图表区域 -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px;">
                <!-- 任务完成趋势 -->
                <div class="analytics-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #666;">📈 任务完成趋势 (最近4周)</h4>
                    <div class="trend-chart"></div>
                </div>

                <!-- 时间分布 -->
                <div class="analytics-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #666;">⏱️ 时间分布 (按任务类型)</h4>
                    <div class="time-distribution-chart"></div>
                </div>
            </div>
        `;

        this.renderCompletionChart();
        this.renderProjectChart();
        this.renderReviewChart();
        this.renderTrendChart();
        this.renderTimeDistributionChart();
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

    /**
     * 渲染任务完成趋势图 (最近4周)
     */
    renderTrendChart() {
        const container = this.container.querySelector('.trend-chart');

        // 按周分组统计已完成任务
        const completedTasks = this.tasks.filter(t => t.status === 'completed' && t.completed_at);

        if (completedTasks.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #999;">
                    暂无已完成任务数据
                </div>
            `;
            return;
        }

        // 获取最近4周的数据
        const now = new Date();
        const weeks = [];
        for (let i = 3; i >= 0; i--) {
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - (i * 7 + now.getDay()));
            weekStart.setHours(0, 0, 0, 0);

            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

            weeks.push({
                start: weekStart,
                end: weekEnd,
                label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`,
                count: 0,
                avgScore: 0,
                scores: []
            });
        }

        // 统计每周的任务数和平均评分
        completedTasks.forEach(task => {
            const completedDate = new Date(task.completed_at);
            const week = weeks.find(w => completedDate >= w.start && completedDate <= w.end);
            if (week) {
                week.count++;
                if (task.review && task.review.score) {
                    week.scores.push(task.review.score);
                }
            }
        });

        // 计算平均分
        weeks.forEach(week => {
            if (week.scores.length > 0) {
                week.avgScore = week.scores.reduce((sum, s) => sum + s, 0) / week.scores.length;
            }
        });

        const maxCount = Math.max(...weeks.map(w => w.count), 1);

        // 渲染条形图
        let html = '<div style="display: flex; align-items: flex-end; justify-content: space-around; height: 200px; padding: 0 10px;">';

        weeks.forEach(week => {
            const heightPercent = (week.count / maxCount) * 100;
            const barColor = week.avgScore > 0 ? '#4CAF50' : '#2196F3';

            html += `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <div style="font-size: 18px; font-weight: 600; color: ${barColor};">${week.count}</div>
                        ${week.avgScore > 0 ? `<div style="font-size: 11px; color: #FF9800;">⭐${week.avgScore.toFixed(1)}</div>` : ''}
                    </div>
                    <div style="width: 40px; background: ${barColor}; height: ${heightPercent}%; min-height: ${week.count > 0 ? '8px' : '0'}; border-radius: 4px 4px 0 0; transition: all 0.3s;"></div>
                    <div style="font-size: 11px; color: #666; white-space: nowrap;">${week.label}</div>
                </div>
            `;
        });

        html += '</div>';
        html += '<div style="margin-top: 16px; text-align: center; font-size: 12px; color: #999;">最近4周完成 ' + completedTasks.length + ' 个任务</div>';

        container.innerHTML = html;
    }

    /**
     * 渲染时间分布图 (按任务类型)
     */
    renderTimeDistributionChart() {
        const container = this.container.querySelector('.time-distribution-chart');

        // 按任务类型分组并计算总时长
        const typeStats = {
            work: { duration: 0, count: 0, color: '#3B82F6', label: '工作' },
            personal: { duration: 0, count: 0, color: '#10B981', label: '个人' },
            study: { duration: 0, count: 0, color: '#F97316', label: '学习' },
            default: { duration: 0, count: 0, color: '#FBBF24', label: '其他' }
        };

        this.tasks.forEach(task => {
            if (task.dtstart && task.dtend) {
                const duration = (new Date(task.dtend) - new Date(task.dtstart)) / (1000 * 60 * 60); // 小时
                const type = task.type || 'default';
                if (typeStats[type]) {
                    typeStats[type].duration += duration;
                    typeStats[type].count++;
                }
            }
        });

        const totalDuration = Object.values(typeStats).reduce((sum, stat) => sum + stat.duration, 0);

        if (totalDuration === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #999;">
                    暂无时间数据
                </div>
            `;
            return;
        }

        // 渲染堆叠条形图
        let html = '<div style="display: flex; height: 40px; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">';

        Object.entries(typeStats).forEach(([type, stat]) => {
            if (stat.duration > 0) {
                const percentage = (stat.duration / totalDuration) * 100;
                html += `
                    <div style="flex: ${stat.duration}; background: ${stat.color}; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 600;">
                        ${percentage.toFixed(0)}%
                    </div>
                `;
            }
        });

        html += '</div>';

        // 图例和详细信息
        html += '<div style="display: flex; flex-direction: column; gap: 12px;">';

        Object.entries(typeStats).forEach(([type, stat]) => {
            if (stat.duration > 0) {
                const hours = stat.duration.toFixed(1);
                const percentage = ((stat.duration / totalDuration) * 100).toFixed(1);

                html += `
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 12px; height: 12px; background: ${stat.color}; border-radius: 2px;"></div>
                            <span style="font-size: 13px; color: #333;">${stat.label}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="font-size: 12px; color: #666;">${stat.count} 个任务</span>
                            <span style="font-size: 13px; font-weight: 600; color: ${stat.color};">${hours}h</span>
                            <span style="font-size: 11px; color: #999;">${percentage}%</span>
                        </div>
                    </div>
                `;
            }
        });

        html += '</div>';
        html += `<div style="margin-top: 16px; padding: 12px; background: #f9f9f9; border-radius: 4px; text-align: center; font-size: 12px; color: #666;">
            总计: ${totalDuration.toFixed(1)} 小时
        </div>`;

        container.innerHTML = html;
    }
}
