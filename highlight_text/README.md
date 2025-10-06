

# 智能 Agent Web 终端 (Intelligent Agent Web Terminal)

一个功能强大的、本地部署的 AI 助手 Web 界面。它不仅仅是一个聊天机器人，更是一个集成了 **Agent 模式** (与本地文件系统交互) 和 **知识库 Copilot 模式** (智能笔记管理与编辑) 的综合性 AI 工作台。



-----

## ✨ 核心功能

### 聊天界面 (Chat Interface)

  - **多会话管理**: 支持创建、切换、搜索和删除多个对话，所有会话记录存储在本地浏览器。
  - **富文本渲染**: 全面支持 Markdown 格式，包括代码块、列表、表格等，并自动应用语法高亮。
  - **流式响应**: AI 的回答以打字机效果流式输出，提供即时反馈。
  - **划词交互**: 选中 AI 回答的任何文本，即可弹出快捷操作菜单（如解释、翻译、自定义指令）。
  - **会话节点轴**: 左侧提供当前对话的树状可视化节点图，清晰展示对话分支与追问。
  - **上下文管理**: 智能显示当前会話的 Token 占用率，并在上下文过长时提供一键压缩摘要功能。
  - **多模态支持**: 支持上传图片进行对话。

### 🤖 Agent 模式 (Agent Mode)

  - **本地系统交互**: 通过向 AI 发出 `Agent: <你的任务>` 格式的指令，激活 Agent 模式。
  - **工具使用**: Agent 能够自主调用后端提供的一系列工具（如`读写文件`、`列出目录`、`grep搜索`、`切换路径`）来完成复杂任务。
  - **实时追踪**: UI 会实时展示 Agent 的完整思考链（Thought）、执行的动作（Action）和观察到的结果（Observation），过程完全透明。
  - **安全确认**: 对于写入文件等敏感操作，Agent 会在执行前请求用户确认。
  - **跨平台支持**: 后端为 macOS/Linux (Bash) 和 Windows (CMD) 提供了独立的终端实现。

### 📚 知识库 Copilot (Knowledge Base Copilot)

  - **双模式切换**: 应用可在“聊天模式”和“编辑器模式”之间无缝切换。
  - **文件树管理**: 右侧边栏提供对本地 `./KnowledgeBase` 目录的完整文件树视图，支持创建、删除、移动文件和文件夹。
  - **强大的 Markdown 编辑器**:
      - 支持实时预览 (Preview)。
      - 支持可配置的 Markdown 快捷键 (如 `Ctrl+B` 加粗)。
      - 支持拖拽或粘贴上传图片，并自动生成 Markdown 引用。
  - **Copilot 智能编辑**:
      - 在编辑器模式下，可以向 Copilot 发出指令，让 AI 智能地修改笔记内容。
      - Copilot 使用 **精细化工具** (`read_lines`, `replace_lines`, `insert_lines`, `delete_lines`) 对文件进行精准的行级别操作，而非全文覆盖。
  - **可视化 Diff 审查**:
      - Copilot 的每一次修改都会生成一个清晰、专业的可视化差异（Diff）视图。
      - 支持**累积 Diff**，Agent 的多次连续修改会合并显示在一个 Diff 视图中。
      - 用户可以逐块审查、**撤销单次修改**，或**一键回退所有变更**。
  - **WebSocket 实时同步**: 当你在外部编辑器修改了 `./KnowledgeBase` 目录中的文件时，Web 界面会自动收到通知并刷新文件列表。

-----

## 🛠️ 技术栈

  - **后端 (Backend)**:
      - **语言**: Go
      - **Web框架**: `net/http` (标准库)
      - **WebSocket**: `github.com/gorilla/websocket`
  - **前端 (Frontend)**:
      - **语言**: HTML, CSS, JavaScript (ES Modules)
      - **UI/CSS**: Tailwind CSS
      - **Markdown渲染**: Marked.js
      - **代码高亮**: Highlight.js
      - **图标**: Lucide Icons
      - **文本差异比较**: `diff-match-patch` & 自定义 `DiffViewer.js`

-----

## 📂 项目结构

```
Directory structure:
└── /./
    ├── go.mod
    ├── web/
    │   ├── index.html
    │   ├── js/
    │   │   ├── core/
    │   │   │   ├── SettingsManager.js
    │   │   │   └── UIManager.js
    │   │   ├── diff/
    │   │   │   └── DiffViewer.js
    │   │   └── utils/
    │   │       └── helpers.js
    │   ├── config.json
    │   ├── shortcuts.js
    │   ├── agent/
    │   │   ├── tasks/
    │   │   │   └── TaskAgentHandler.js
    │   │   ├── notes/
    │   │   │   └── handler.js
    │   │   └── agent.js
    │   ├── views/
    │   │   └── workspace/
    │   │       ├── AnalyticsView.js
    │   │       ├── CalendarView.js
    │   │       ├── GanttView.js
    │   │       └── WorkspaceView.js
    │   └── app.js
    ├── .claude/
    ├── uploads/
    ├── agent/
    │   ├── tools/
    │   │   ├── tasks/
    │   │   │   └── executor.go
    │   │   ├── notes/
    │   │   │   └── executor.go
    │   │   └── executor.go
    │   └── terminal/
    │       ├── terminal.go
    │       ├── terminal_darwin.go
    │       └── terminal_windows.go
    ├── go.sum
    ├── README.md
    ├── KnowledgeBase/
    ├── logs/
    ├── package.json
    ├── .playwright-mcp/
    ├── main.go
    └── highlight_text

```

-----

## 🚀 快速开始

### 1\. 先决条件

  - 已安装 [Go](https://golang.org/dl/) (版本 \>= 1.21)。

### 2\. 克隆项目

```bash
git clone <your-repository-url>
cd <project-directory>
```

### 3\. 配置

1.  进入 `web` 目录，复制或重命名 `config.json.example` (如果提供) 为 `config.json`。
2.  打开 `web/config.json` 文件，填入你的 LLM API 密钥和模型信息。
    ```json
    {
      "apiSettings": {
        "defaultEndpoint": "https://api.openai.com/v1/chat/completions",
        "model": "gpt-4.1-mini"
      },
      // ... 其他配置
    }
    ```
    *你也可以在启动应用后，通过点击界面右上角的 "设置" 按钮来完成此项配置。*

### 4\. 运行后端服务

在项目根目录运行以下命令：

```bash
go mod tidy
go run main.go
```

服务启动后，你将看到类似以下的输出：

```
🚀 AI助手Web服务启动成功!
📱 请访问: http://localhost:8080
...
```

### 5\. 访问应用

在你的浏览器中打开 **http://localhost:8080** 即可开始使用。

-----

## 📖 使用指南

### 基本聊天

直接在输入框中输入问题，即可与 AI 进行对话。

### Agent 模式

1.  在输入框中输入 `Agent: <你的任务>`，例如：
    > `Agent: 在当前目录下创建一个名为 'hello_world.py' 的文件，并写入代码 print("Hello, Agent!")`
2.  发送后，应用会自动进入 Agent 模式。
3.  在主聊天窗口，你会看到 Agent 的实时思考和执行过程。
4.  如果 Agent 需要执行敏感操作（如写入文件），会弹出对话框请求你的授权。

### 知识库 (Copilot) 模式

1.  **打开知识库**: 点击页面右上角的 "知识库" 按钮，展开右侧边栏。
2.  **创建/选择笔记**: 在右侧边栏中，你可以右键单击来创建新的文件或文件夹。单击一个笔记文件，应用将切换到编辑器模式。
3.  **编辑笔记**: 在中间的编辑器中，你可以像在普通 Markdown 编辑器中一样写作。
4.  **使用 Copilot**:
      - 在左侧的 Copilot 面板输入框中，输入你希望 AI 执行的修改指令，例如：
        > `帮我重构第二段，让语言更简洁`
        > `搜索知识库中关于 "React Hooks" 的笔记，并总结要点添加到当前笔记末尾`
      - Copilot 会开始执行任务，并在 Copilot 面板中显示其思考过程。
      - 当 Copilot 对文件进行修改时，编辑器区域会自动切换到 **Diff 视图**。
5.  **审查变更**:
      - 在 Diff 视图中，你可以清晰地看到所有增、删、改的内容。
      - 你可以**撤销**（Revert）不想要的修改块。
      - 如果你对所有修改都满意，可以点击 "保存" 按钮。
      - 如果你想放弃所有修改，可以点击 "**全部回退**" (Reject All) 按钮。