# Timeline Cheyne - 会议时间线显示工具

一个用于显示在线会议进展阶段的可视化工具。支持预录入会议安排，实时显示当前进展，让参会者清楚了解会议进度。

## 🎯 功能特性

- ✅ 可视化时间线显示
- ⏱️ 实时进度跟踪
- 📅 预录入会议安排
- 🎨 现代化UI设计
- 📱 响应式布局
- 🚀 即开即用，无需安装
- 💻 支持后期编译为Windows桌面应用

## 🖥️ 截图演示

工具界面包含：
- 顶部的会议标题和总体进度
- 中间的时间线展示区域
- 底部的控制按钮

## 🚀 快速开始

### 直接使用

1. 下载或克隆项目
2. 打开 `src/index.html` 文件
3. 在浏览器中查看效果

### 本地开发

```bash
# 进入项目目录
cd weeks/week_02/timeline-cheyne

# 启动本地服务器（可选）
python -m http.server 8000

# 或者使用 Node.js
npx http-server src
```

## 📝 使用方法

### 基本使用

1. **开始会议**: 点击"开始会议"按钮启动时间线
2. **查看进度**: 实时查看当前进行的会议环节
3. **手动控制**: 使用"上一个"/"下一个"按钮手动切换环节
4. **暂停/继续**: 随时暂停或继续会议进程

### 自定义会议安排

在 `script.js` 中修改 `meetingSchedule` 数组：

```javascript
const meetingSchedule = [
    {
        title: "开场介绍",
        duration: 5,
        description: "欢迎词和会议议程介绍"
    },
    {
        title: "项目汇报",
        duration: 20,
        description: "各项目进展汇报和讨论"
    },
    // 添加更多环节...
];
```

### 配置选项

在 `script.js` 顶部可以修改以下配置：

```javascript
const CONFIG = {
    meetingTitle: "你的会议标题",
    autoAdvance: true,          // 是否自动切换环节
    showTimeRemaining: true,    // 是否显示剩余时间
    alertBeforeEnd: 2,          // 结束前几分钟提醒
    theme: 'default'            // 主题：default, dark, light
};
```

## 🎨 主题定制

### 预设主题

工具提供三种预设主题：
- `default`: 默认蓝色主题
- `dark`: 深色主题
- `light`: 浅色主题

### 自定义主题

在 `style.css` 中修改 CSS 变量：

```css
:root {
    --primary-color: #3498db;
    --secondary-color: #2ecc71;
    --background-color: #f8f9fa;
    --text-color: #2c3e50;
    --border-color: #e0e0e0;
}
```

## 📋 会议环节配置

每个会议环节包含以下属性：

```javascript
{
    title: "环节标题",           // 必需：环节名称
    duration: 15,               // 必需：持续时间（分钟）
    description: "详细描述",     // 可选：环节描述
    presenter: "主讲人",        // 可选：主讲人姓名
    type: "presentation",       // 可选：环节类型
    materials: ["文件1.pdf"]    // 可选：相关材料
}
```

## 🔧 技术栈

- **前端**: HTML5, CSS3, JavaScript (ES6+)
- **样式**: CSS Grid, Flexbox, CSS Variables
- **特性**: 响应式设计, 现代化UI
- **兼容**: Chrome 60+, Firefox 55+, Safari 12+

## 🚀 进阶功能

### 数据持久化

工具支持将会议数据保存到浏览器本地存储：

```javascript
// 保存会议状态
timeline.saveState();

// 恢复会议状态
timeline.loadState();
```

### 快捷键支持

- `Space`: 暂停/继续
- `←`: 上一个环节
- `→`: 下一个环节
- `R`: 重置会议
- `F`: 全屏模式

### 导出功能

- 导出会议记录为JSON格式
- 生成会议进度报告
- 打印友好的时间线视图

## 📦 打包为Windows应用

### 使用 Electron

1. 安装 Electron：
```bash
npm install -g electron
```

2. 创建 `package.json`：
```json
{
    "name": "timeline-cheyne",
    "version": "1.0.0",
    "main": "electron-main.js",
    "scripts": {
        "start": "electron ."
    }
}
```

3. 创建 `electron-main.js`：
```javascript
const { app, BrowserWindow } = require('electron');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true
        }
    });

    win.loadFile('src/index.html');
}

app.whenReady().then(createWindow);
```

4. 打包：
```bash
npm run build
```

### 使用 Tauri (推荐)

更轻量的打包方案，详见项目根目录的打包说明。

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 发起 Pull Request

## 📄 许可证

本项目采用 [MIT License](../../../LICENSE) 许可证。

## 👤 贡献者

- [@cheyne](https://github.com/cheyne) - 项目创建者和维护者

## 📞 反馈与支持

如果你在使用过程中遇到问题或有改进建议：

1. 查看 [Issues](https://github.com/yourusername/open-vibe-coding/issues)
2. 创建新的 Issue
3. 联系维护者

---

**让会议进展一目了然！** 🎉 