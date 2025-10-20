# AI助手 - 打包部署指南

本项目是一个集成了 **Vite + Tailwind CSS 前端** 和 **Go 后端** 的 Web 应用。通过 Go 的 `embed` 包，我们将前端资源完全嵌入到 Go 可执行文件中，实现 **单文件部署**。

---

## 📦 快速构建

### 自动构建（推荐）

运行构建脚本即可完成所有步骤：

```bash
./build.sh
```

这个脚本会：
1. 清理旧的构建文件
2. 使用 Vite 编译前端资源
3. 编译 Windows 和 macOS 的可执行文件
4. 显示构建结果

### 手动构建

如果你想逐步了解构建过程：

#### 第一步：编译前端

```bash
npm install           # 首次运行需要安装依赖
npm run build         # 生成 dist/ 目录
```

#### 第二步：编译后端

**Windows 64-bit:**
```bash
GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui" -o AIHelper.exe main.go workspace.go
```

**macOS Intel:**
```bash
GOOS=darwin GOARCH=amd64 go build -o AIHelper-Intel main.go workspace.go
```

**macOS Apple Silicon:**
```bash
GOOS=darwin GOARCH=arm64 go build -o AIHelper-M1 main.go workspace.go
```

---

## 🚀 使用说明

### Windows

1. 下载 `AIHelper-Windows-x64.exe`
2. 双击运行即可启动服务
3. 浏览器访问 `http://localhost:8080`

**注意：**
- Windows 版本使用了 `-H windowsgui` 编译标志，运行时不会显示命令行窗口
- 首次运行会在可执行文件所在目录创建数据文件夹

### macOS

1. 下载对应处理器的版本：
   - Intel 芯片: `AIHelper-macOS-Intel`
   - Apple Silicon (M1/M2/M3): `AIHelper-macOS-AppleSilicon`

2. 添加执行权限（首次运行）：
   ```bash
   chmod +x AIHelper-macOS-Intel
   # 或
   chmod +x AIHelper-macOS-AppleSilicon
   ```

3. 运行应用：
   ```bash
   ./AIHelper-macOS-Intel
   # 或
   ./AIHelper-macOS-AppleSilicon
   ```

4. 浏览器访问 `http://localhost:8080`

**macOS 安全提示：**
如果遇到"无法验证开发者"的提示：
1. 系统偏好设置 → 安全性与隐私
2. 点击"仍要打开"
3. 或在终端运行：`xattr -d com.apple.quarantine AIHelper-macOS-*`

---

## 📁 运行时目录结构

应用首次运行时会自动创建以下目录（与可执行文件同级）：

```
.
├── AIHelper.exe              # 可执行文件
├── KnowledgeBase/            # 知识库（用户笔记）
├── uploads/                  # 上传的图片等文件
├── logs/                     # 应用日志
└── interactions.log.json     # 交互历史
```

**重要：**
- 可执行文件可以放在任何目录运行
- 数据目录会在当前工作目录下创建
- 建议为应用创建一个专用文件夹

---

## 🛠️ 技术架构

### 前端技术栈
- **Vite 5.x** - 快速的前端构建工具
- **Tailwind CSS 3.x** - 实用优先的 CSS 框架
- **原生 JavaScript** - 无框架依赖

### 后端技术栈
- **Go 1.24.6** - 高性能后端语言
- **embed 包** - Go 1.16+ 的嵌入文件系统
- **gorilla/websocket** - WebSocket 支持

### 打包原理

1. **前端编译**: Vite 将源代码打包成优化的静态资源 → `dist/` 目录
2. **资源嵌入**: Go 的 `//go:embed all:dist` 指令将 `dist/` 目录嵌入到可执行文件
3. **服务提供**: 通过 `http.FS(embeddedFiles)` 从内存中提供前端资源
4. **跨平台编译**: 使用 `GOOS` 和 `GOARCH` 环境变量编译不同平台的可执行文件

---

## 🔧 开发模式

如果你想在开发环境运行（无需打包）：

### 方式一：分离式开发（推荐）

**终端 1 - 前端开发服务器:**
```bash
npm run dev
```
访问 `http://localhost:3000`（带热重载）

**终端 2 - Go 后端:**
```bash
go run main.go workspace.go
```
API 服务在 `http://localhost:8080`

Vite 会自动代理 API 请求到后端。

### 方式二：直接运行 Go（生产模式）

```bash
npm run build          # 先编译前端
go run main.go workspace.go  # 运行后端（服务嵌入的前端）
```

访问 `http://localhost:8080`

---

## 📋 常见问题

### Q1: 构建后的文件很大（12MB）怎么办？

这是正常的。可执行文件包含：
- Go 运行时
- 所有前端静态资源（HTML/CSS/JS/字体）
- 第三方库

如果需要减小体积：
```bash
# 使用 UPX 压缩（可选）
upx --best --lzma AIHelper.exe
```

### Q2: 修改代码后如何重新打包？

```bash
./build.sh  # 自动完成前端编译和后端构建
```

### Q3: Windows 版本运行时看不到任何输出？

这是正常的。因为使用了 `-H windowsgui` 标志隐藏了控制台窗口。

如果需要调试版本：
```bash
GOOS=windows GOARCH=amd64 go build -o AIHelper-Debug.exe main.go workspace.go
```

### Q4: 端口 8080 被占用怎么办？

修改 `main.go` 的最后一行：
```go
log.Fatal(http.ListenAndServe(":8080", nil))
// 改为其他端口，例如：
log.Fatal(http.ListenAndServe(":9090", nil))
```

然后重新构建。

### Q5: 可以在服务器上部署吗？

可以！只需：
1. 上传对应平台的可执行文件
2. 运行它
3. 配置反向代理（Nginx/Caddy）将外部请求转发到 `localhost:8080`

示例 Nginx 配置：
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📝 核心代码修改说明

如果你想了解我们做了哪些关键修改：

### 1. main.go - 嵌入资源

**添加的代码：**
```go
import (
    "embed"
    "io/fs"
    // ... 其他导入
)

//go:embed all:dist
var embeddedFiles embed.FS

func main() {
    // ... 其他代码

    // 创建指向 dist 内部的子文件系统
    distFS, err := fs.Sub(embeddedFiles, "dist")
    if err != nil {
        log.Fatal(err)
    }

    // 使用嵌入的文件系统提供静态文件
    fileServer := http.FileServer(http.FS(distFS))
    http.Handle("/", fileServer)

    // ... 其他代码
}
```

### 2. vite.config.js - 优化构建

**修改的配置：**
```javascript
export default defineConfig({
  root: 'web',
  publicDir: false,  // 不复制 public 目录
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  }
})
```

---

## 🎯 下一步

- ✅ 单文件部署已实现
- 建议：添加系统托盘图标（Windows/macOS）
- 建议：创建安装程序（NSIS for Windows / DMG for macOS）
- 建议：添加自动更新功能

---

## 📄 许可证

请参考项目根目录的 LICENSE 文件。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

构建时间: 2025-10-20
