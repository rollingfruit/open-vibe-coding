# 贡献指南

感谢你对 Open Vibe Coding 项目的关注！我们欢迎所有形式的贡献，包括新工具、改进现有代码、文档更新或错误修复。

## 🚀 快速开始

### 1. 准备环境

```bash
# Fork 并克隆仓库
git clone https://github.com/yourusername/open-vibe-coding.git
cd open-vibe-coding

# 创建新分支
git checkout -b feature/your-tool-name
```

### 2. 选择周次目录

根据当前时间或项目进度，选择对应的 `week_XX` 目录。如果目录不存在，请创建：

```bash
mkdir -p weeks/week_XX
```

### 3. 创建工具目录

在选定的周次目录下，创建你的工具文件夹：

```bash
mkdir weeks/week_XX/你的工具名-你的用户名
```

## 📝 命名规范

### 必须遵循的命名规范

工具文件夹名必须严格遵循 `项目名-贡献者名` 的格式：

✅ **正确示例：**
- `timeline-cheyne`
- `data_processor-mary`
- `log_analyzer-john`
- `web_scraper-alice`

❌ **错误示例：**
- `timeline` （缺少贡献者名）
- `cheyne-timeline` （顺序错误）
- `timeline_tool_by_cheyne` （格式不正确）

### 命名建议

- **项目名**: 使用小写字母，单词间用下划线连接
- **贡献者名**: 使用你的 GitHub 用户名或常用昵称
- **保持简洁**: 项目名应简洁明了，体现工具的核心功能

## 📁 文件结构要求

每个工具文件夹必须包含以下文件：

```
your_tool-yourname/
├── src/                 # 源代码目录
│   ├── index.html       # 主文件（如果是Web工具）
│   ├── main.py          # 主文件（如果是Python工具）
│   ├── style.css        # 样式文件（可选）
│   └── script.js        # 脚本文件（可选）
├── README.md            # 📖 必需：工具详细说明
├── requirements.txt     # 📦 依赖文件（Python项目）
├── package.json         # 📦 依赖文件（Node.js项目）
└── assets/              # 📷 资源文件（可选）
    ├── screenshots/     # 截图
    └── examples/        # 示例文件
```

## 📖 README.md 要求

每个工具的 README.md 必须包含以下内容：

```markdown
# 工具名称

简短描述工具的用途和功能。

## 功能特性

- 功能1
- 功能2
- 功能3

## 安装说明

详细的安装步骤...

## 使用方法

详细的使用说明和示例...

## 配置选项

如果有配置选项，请在这里说明...

## 截图

![截图](assets/screenshots/demo.png)

## 技术栈

- 技术1
- 技术2

## 贡献者

- [@yourusername](https://github.com/yourusername)

## 许可证

[MIT License](../../LICENSE)
```

## 🛠️ 开发规范

### 代码质量

- 代码必须可以正常运行
- 包含必要的错误处理
- 添加适当的注释
- 遵循对应语言的最佳实践

### 依赖管理

- **Python项目**: 使用 `requirements.txt`
- **Node.js项目**: 使用 `package.json`
- **其他语言**: 使用相应的依赖管理文件

### 测试

虽然不是强制要求，但建议包含基本的测试：

```
your_tool-yourname/
├── src/
├── tests/           # 测试文件
└── README.md
```

## 🔄 提交流程

### 1. 创建分支

```bash
git checkout -b feature/your-tool-name
```

### 2. 提交代码

```bash
git add .
git commit -m "feat: 添加 your-tool-name 工具"
```

### 3. 推送分支

```bash
git push origin feature/your-tool-name
```

### 4. 创建 Pull Request

在 GitHub 上创建 Pull Request，确保：

- 标题清晰描述你的工具
- 详细说明工具的功能和用途
- 包含截图或演示（如果适用）
- 确认所有文件都已正确提交

## 📋 Pull Request 检查清单

提交前请确认：

- [ ] 工具文件夹命名正确（`项目名-贡献者名`）
- [ ] 包含完整的 README.md
- [ ] 代码可以正常运行
- [ ] 包含必要的依赖文件
- [ ] 所有文件都在正确的目录结构中
- [ ] 提交信息清晰明了

## 🎯 工具类型建议

我们欢迎各种类型的工具，包括但不限于：

- 📊 数据分析工具
- 🌐 Web开发工具
- 🔧 系统管理工具
- 📱 移动端工具
- 🎨 设计工具
- 🤖 自动化脚本
- 📈 监控工具

## 🤝 社区准则

- 保持友好和尊重
- 提供建设性的反馈
- 帮助新贡献者
- 遵守开源社区的最佳实践

## 📞 获取帮助

如果你在贡献过程中遇到问题：

1. 查看现有的 Issues
2. 创建新的 Issue
3. 在 Discussions 中提问
4. 查看其他贡献者的示例

感谢你的贡献！🎉 