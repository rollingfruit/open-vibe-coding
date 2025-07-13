/**
 * Timeline Cheyne - 会议时间线工具
 * 作者: Cheyne
 * 功能: 显示会议进展的可视化时间线
 */

// 配置选项
const CONFIG = {
    meetingTitle: "项目进展汇报会议",
    autoAdvance: true,
    showTimeRemaining: true,
    alertBeforeEnd: 2,
    theme: 'default'
};

// 默认会议安排
const DEFAULT_MEETING_SCHEDULE = [
    {
        title: "开场介绍",
        duration: 5,
        description: "欢迎词和会议议程介绍",
        presenter: "会议主持人",
        type: "介绍"
    },
    {
        title: "项目进展汇报",
        duration: 25,
        description: "各项目团队汇报当前进展情况",
        presenter: "项目负责人",
        type: "汇报"
    },
    {
        title: "技术方案讨论",
        duration: 20,
        description: "讨论技术实现方案和技术难点",
        presenter: "技术负责人",
        type: "讨论"
    },
    {
        title: "问题与解决方案",
        duration: 15,
        description: "识别问题并讨论解决方案",
        presenter: "全体成员",
        type: "讨论"
    },
    {
        title: "下阶段计划",
        duration: 20,
        description: "制定下一阶段的工作计划和时间节点",
        presenter: "项目经理",
        type: "规划"
    },
    {
        title: "总结与结束",
        duration: 5,
        description: "会议总结和下次会议安排",
        presenter: "会议主持人",
        type: "总结"
    }
];

// 会议时间线管理器
class MeetingTimeline {
    constructor() {
        this.schedule = [...DEFAULT_MEETING_SCHEDULE];
        this.currentIndex = -1;
        this.isRunning = false;
        this.isPaused = false;
        this.startTime = null;
        this.elapsedTime = 0;
        this.sessionStartTime = null;
        this.sessionElapsed = 0;
        this.timer = null;
        this.alertShown = false;
        
        this.init();
    }

    init() {
        this.loadSettings();
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
        this.updateDisplay();
        this.updateCurrentTime();
        this.loadState();
    }

    // 加载设置
    loadSettings() {
        const settings = localStorage.getItem('timeline-settings');
        if (settings) {
            const parsed = JSON.parse(settings);
            Object.assign(CONFIG, parsed);
        }
        this.applySettings();
    }

    // 应用设置
    applySettings() {
        document.getElementById('meetingTitle').textContent = CONFIG.meetingTitle;
        document.getElementById('meetingTitleInput').value = CONFIG.meetingTitle;
        document.getElementById('autoAdvanceToggle').checked = CONFIG.autoAdvance;
        document.getElementById('themeSelect').value = CONFIG.theme;
        document.getElementById('alertTimeInput').value = CONFIG.alertBeforeEnd;
        
        // 应用主题
        document.documentElement.setAttribute('data-theme', CONFIG.theme);
        
        // 更新会议元数据
        this.updateMeetingMeta();
    }

    // 更新会议元数据
    updateMeetingMeta() {
        const totalDuration = this.schedule.reduce((sum, item) => sum + item.duration, 0);
        document.getElementById('meetingDate').textContent = new Date().toLocaleDateString('zh-CN');
        document.getElementById('meetingDuration').textContent = `总时长: ${totalDuration}分钟`;
        document.getElementById('timeRemaining').textContent = `剩余: ${totalDuration}分钟`;
    }

    // 设置事件监听器
    setupEventListeners() {
        // 主控制按钮
        document.getElementById('playPauseBtn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('prevBtn').addEventListener('click', () => this.previousSession());
        document.getElementById('nextBtn').addEventListener('click', () => this.nextSession());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetMeeting());

        // 底部控制按钮
        document.getElementById('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportData());

        // 设置模态框
        document.getElementById('closeSettings').addEventListener('click', () => this.hideSettings());
        document.getElementById('cancelSettings').addEventListener('click', () => this.hideSettings());
        document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());

        // 点击模态框外部关闭
        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('settingsModal')) {
                this.hideSettings();
            }
        });
    }

    // 设置键盘快捷键
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.previousSession();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.nextSession();
                    break;
                case 'r':
                case 'R':
                    if (e.ctrlKey || e.metaKey) return;
                    e.preventDefault();
                    this.resetMeeting();
                    break;
                case 'f':
                case 'F':
                    if (e.ctrlKey || e.metaKey) return;
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'Escape':
                    this.hideSettings();
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    }
                    break;
            }
        });
    }

    // 开始/暂停会议
    togglePlayPause() {
        if (!this.isRunning) {
            this.startMeeting();
        } else {
            this.togglePause();
        }
    }

    // 开始会议
    startMeeting() {
        if (this.currentIndex === -1) {
            this.currentIndex = 0;
        }
        
        this.isRunning = true;
        this.isPaused = false;
        this.startTime = Date.now() - this.elapsedTime;
        this.sessionStartTime = Date.now() - this.sessionElapsed;
        
        this.updatePlayPauseButton();
        this.updateStatus('会议进行中');
        this.startTimer();
        this.updateDisplay();
        this.saveState();
        
        this.showNotification('会议已开始', 'success');
    }

    // 暂停/继续
    togglePause() {
        this.isPaused = !this.isPaused;
        
        if (this.isPaused) {
            this.stopTimer();
            this.updateStatus('会议已暂停');
            this.showNotification('会议已暂停', 'warning');
        } else {
            this.startTime = Date.now() - this.elapsedTime;
            this.sessionStartTime = Date.now() - this.sessionElapsed;
            this.startTimer();
            this.updateStatus('会议进行中');
            this.showNotification('会议已继续', 'success');
        }
        
        this.updatePlayPauseButton();
        this.saveState();
    }

    // 上一个环节
    previousSession() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.sessionElapsed = 0;
            this.sessionStartTime = Date.now();
            this.alertShown = false;
            this.updateDisplay();
            this.saveState();
            this.showNotification(`切换到: ${this.schedule[this.currentIndex].title}`, 'success');
        }
    }

    // 下一个环节
    nextSession() {
        if (this.currentIndex < this.schedule.length - 1) {
            this.currentIndex++;
            this.sessionElapsed = 0;
            this.sessionStartTime = Date.now();
            this.alertShown = false;
            this.updateDisplay();
            this.saveState();
            this.showNotification(`切换到: ${this.schedule[this.currentIndex].title}`, 'success');
        } else if (this.currentIndex === this.schedule.length - 1) {
            this.completeMeeting();
        }
    }

    // 重置会议
    resetMeeting() {
        this.stopTimer();
        this.currentIndex = -1;
        this.isRunning = false;
        this.isPaused = false;
        this.startTime = null;
        this.elapsedTime = 0;
        this.sessionStartTime = null;
        this.sessionElapsed = 0;
        this.alertShown = false;
        
        this.updatePlayPauseButton();
        this.updateStatus('等待开始');
        this.updateDisplay();
        this.saveState();
        
        this.showNotification('会议已重置', 'success');
    }

    // 完成会议
    completeMeeting() {
        this.stopTimer();
        this.isRunning = false;
        this.updateStatus('会议已结束');
        this.updatePlayPauseButton();
        this.saveState();
        
        this.showNotification('会议已完成！', 'success');
    }

    // 启动计时器
    startTimer() {
        this.timer = setInterval(() => {
            if (!this.isPaused) {
                this.elapsedTime = Date.now() - this.startTime;
                this.sessionElapsed = Date.now() - this.sessionStartTime;
                this.updateDisplay();
                this.checkForAlerts();
                this.checkAutoAdvance();
            }
        }, 1000);
    }

    // 停止计时器
    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    // 检查提醒
    checkForAlerts() {
        if (this.currentIndex >= 0 && !this.alertShown) {
            const currentSession = this.schedule[this.currentIndex];
            const remainingTime = (currentSession.duration * 60 * 1000) - this.sessionElapsed;
            
            if (remainingTime <= CONFIG.alertBeforeEnd * 60 * 1000) {
                this.alertShown = true;
                this.showNotification(`${currentSession.title} 将在 ${CONFIG.alertBeforeEnd} 分钟后结束`, 'warning');
            }
        }
    }

    // 检查自动切换
    checkAutoAdvance() {
        if (CONFIG.autoAdvance && this.currentIndex >= 0) {
            const currentSession = this.schedule[this.currentIndex];
            const sessionDuration = currentSession.duration * 60 * 1000;
            
            if (this.sessionElapsed >= sessionDuration) {
                this.nextSession();
            }
        }
    }

    // 更新显示
    updateDisplay() {
        this.updateTimelineTrack();
        this.updateCurrentSession();
        this.updateOverallProgress();
        this.updateControlButtons();
    }

    // 更新时间线轨道
    updateTimelineTrack() {
        const track = document.getElementById('timelineTrack');
        track.innerHTML = '';

        this.schedule.forEach((session, index) => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            
            if (index < this.currentIndex) {
                item.classList.add('completed');
            } else if (index === this.currentIndex) {
                item.classList.add('active');
            } else {
                item.classList.add('upcoming');
            }

            item.innerHTML = `
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                    <div class="timeline-title">${session.title}</div>
                    <div class="timeline-description">${session.description}</div>
                </div>
                <div class="timeline-duration">${session.duration}分钟</div>
            `;

            track.appendChild(item);
        });
    }

    // 更新当前环节
    updateCurrentSession() {
        const titleEl = document.getElementById('currentSessionTitle');
        const durationEl = document.getElementById('currentSessionDuration');
        const elapsedEl = document.getElementById('currentSessionElapsed');
        const descriptionEl = document.getElementById('currentSessionDescription');
        const presenterEl = document.getElementById('sessionPresenter');
        const typeEl = document.getElementById('sessionType');
        const progressFillEl = document.getElementById('sessionProgressFill');
        const progressTextEl = document.getElementById('sessionProgressText');

        if (this.currentIndex >= 0) {
            const session = this.schedule[this.currentIndex];
            const elapsedMinutes = Math.floor(this.sessionElapsed / (60 * 1000));
            const progressPercent = Math.min((this.sessionElapsed / (session.duration * 60 * 1000)) * 100, 100);

            titleEl.textContent = session.title;
            durationEl.textContent = `${session.duration}分钟`;
            elapsedEl.textContent = `已用时: ${elapsedMinutes}分钟`;
            descriptionEl.textContent = session.description;
            presenterEl.textContent = session.presenter || '-';
            typeEl.textContent = session.type || '-';
            progressFillEl.style.width = `${progressPercent}%`;
            progressTextEl.textContent = `${Math.round(progressPercent)}%`;
        } else {
            titleEl.textContent = '准备开始...';
            durationEl.textContent = '0分钟';
            elapsedEl.textContent = '已用时: 0分钟';
            descriptionEl.textContent = '请点击开始按钮开始会议';
            presenterEl.textContent = '-';
            typeEl.textContent = '-';
            progressFillEl.style.width = '0%';
            progressTextEl.textContent = '0%';
        }
    }

    // 更新总体进度
    updateOverallProgress() {
        const totalDuration = this.schedule.reduce((sum, session) => sum + session.duration, 0);
        const completedTime = this.schedule.slice(0, this.currentIndex).reduce((sum, session) => sum + session.duration, 0);
        const currentSessionTime = this.currentIndex >= 0 ? Math.min(this.sessionElapsed / (60 * 1000), this.schedule[this.currentIndex].duration) : 0;
        
        const totalElapsed = completedTime + currentSessionTime;
        const progressPercent = Math.min((totalElapsed / totalDuration) * 100, 100);
        const remainingTime = Math.max(totalDuration - totalElapsed, 0);

        document.getElementById('progressText').textContent = `${Math.round(progressPercent)}% 完成`;
        document.getElementById('timeRemaining').textContent = `剩余: ${Math.round(remainingTime)}分钟`;
        document.getElementById('progressFill').style.width = `${progressPercent}%`;
    }

    // 更新控制按钮
    updateControlButtons() {
        const playPauseBtn = document.getElementById('playPauseBtn');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');

        prevBtn.disabled = this.currentIndex <= 0;
        nextBtn.disabled = this.currentIndex >= this.schedule.length - 1;
    }

    // 更新播放/暂停按钮
    updatePlayPauseButton() {
        const btn = document.getElementById('playPauseBtn');
        const svg = btn.querySelector('svg');

        if (!this.isRunning) {
            // 播放图标
            svg.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
            btn.title = '开始会议';
        } else if (this.isPaused) {
            // 播放图标
            svg.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
            btn.title = '继续会议';
        } else {
            // 暂停图标
            svg.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
            btn.title = '暂停会议';
        }
    }

    // 更新状态
    updateStatus(status) {
        document.getElementById('statusText').textContent = status;
    }

    // 更新当前时间
    updateCurrentTime() {
        const updateTime = () => {
            const now = new Date();
            document.getElementById('currentTime').textContent = now.toLocaleTimeString('zh-CN');
        };
        
        updateTime();
        setInterval(updateTime, 1000);
    }

    // 显示设置
    showSettings() {
        document.getElementById('settingsModal').classList.add('active');
    }

    // 隐藏设置
    hideSettings() {
        document.getElementById('settingsModal').classList.remove('active');
    }

    // 保存设置
    saveSettings() {
        CONFIG.meetingTitle = document.getElementById('meetingTitleInput').value;
        CONFIG.autoAdvance = document.getElementById('autoAdvanceToggle').checked;
        CONFIG.theme = document.getElementById('themeSelect').value;
        CONFIG.alertBeforeEnd = parseInt(document.getElementById('alertTimeInput').value);

        localStorage.setItem('timeline-settings', JSON.stringify(CONFIG));
        this.applySettings();
        this.hideSettings();
        this.showNotification('设置已保存', 'success');
    }

    // 切换全屏
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log('无法进入全屏模式:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    // 导出数据
    exportData() {
        const data = {
            meetingTitle: CONFIG.meetingTitle,
            schedule: this.schedule,
            currentIndex: this.currentIndex,
            elapsedTime: this.elapsedTime,
            sessionElapsed: this.sessionElapsed,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            exportTime: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `会议记录_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showNotification('数据已导出', 'success');
    }

    // 保存状态
    saveState() {
        const state = {
            currentIndex: this.currentIndex,
            elapsedTime: this.elapsedTime,
            sessionElapsed: this.sessionElapsed,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            startTime: this.startTime,
            sessionStartTime: this.sessionStartTime,
            alertShown: this.alertShown
        };

        localStorage.setItem('timeline-state', JSON.stringify(state));
    }

    // 加载状态
    loadState() {
        const state = localStorage.getItem('timeline-state');
        if (state) {
            const parsed = JSON.parse(state);
            
            this.currentIndex = parsed.currentIndex || -1;
            this.elapsedTime = parsed.elapsedTime || 0;
            this.sessionElapsed = parsed.sessionElapsed || 0;
            this.isRunning = parsed.isRunning || false;
            this.isPaused = parsed.isPaused || false;
            this.alertShown = parsed.alertShown || false;

            if (this.isRunning && !this.isPaused) {
                this.startTime = Date.now() - this.elapsedTime;
                this.sessionStartTime = Date.now() - this.sessionElapsed;
                this.startTimer();
                this.updateStatus('会议进行中');
            } else if (this.isPaused) {
                this.updateStatus('会议已暂停');
            }

            this.updatePlayPauseButton();
            this.updateDisplay();
        }
    }

    // 显示通知
    showNotification(message, type = 'info') {
        const container = document.getElementById('notificationContainer');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        container.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.timeline = new MeetingTimeline();
    
    // 页面卸载时保存状态
    window.addEventListener('beforeunload', () => {
        window.timeline.saveState();
    });
});

// 导出供外部使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MeetingTimeline;
} 