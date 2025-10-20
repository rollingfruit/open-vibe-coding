# AI助手 - 快速开始 ⚡

## 🎯 一键打包

```bash
./build.sh
```

完成！可执行文件位于 `build/` 目录。

---

## 📦 分发文件

构建完成后，你会得到：

- **AIHelper-Windows-x64.exe** - Windows 版本（双击运行）
- **AIHelper-macOS-Intel** - macOS Intel 版本
- **AIHelper-macOS-AppleSilicon** - macOS M1/M2/M3 版本

---

## 🚀 运行

### Windows
```
双击 AIHelper-Windows-x64.exe
```

### macOS
```bash
chmod +x AIHelper-macOS-*
./AIHelper-macOS-Intel  # 或 AIHelper-macOS-AppleSilicon
```

### 访问应用
```
http://localhost:8080
```

---

## 📁 首次运行后的目录

```
your-folder/
├── AIHelper.exe          # 可执行文件
├── KnowledgeBase/        # 自动创建 - 知识库
├── uploads/              # 自动创建 - 上传文件
└── logs/                 # 自动创建 - 日志
```

---

## ⚙️ 修改代码后

```bash
./build.sh  # 重新打包即可
```

---

## 📖 详细文档

查看 [BUILD_README.md](./BUILD_README.md) 了解：
- 手动构建步骤
- 技术架构详解
- 常见问题解答
- 开发模式说明

---

## 🆘 遇到问题？

1. **端口被占用**: 修改 `main.go` 中的 `:8080` 为其他端口
2. **macOS 安全警告**: 运行 `xattr -d com.apple.quarantine AIHelper-macOS-*`
3. **构建失败**: 确保已安装 Node.js 和 Go
4. **前端更新未生效**: 先运行 `npm run build`

---

就这么简单！🎉


1. 测试应用
  ./build/AIHelper-macOS-AppleSilicon
  1. 然后访问 http://localhost:8080
  2. 修改代码后重新构建
  ./build.sh
  3. 查看详细文档
    - QUICKSTART.md - 快速入门
    - BUILD_README.md - 完整指南
    - PACKAGING_CHANGES.md - 技术细节

  ---
  🎯 关键文件清单

  构建相关：
  - build.sh -
  自动构建脚本（Mac/Linux）
  - build.bat -
  自动构建脚本（Windows）
  - test-build.sh - 验证脚本
  - build/ - 构建产物目录

  文档：
  - QUICKSTART.md - 快速开始
  - BUILD_README.md - 详细文档
  - PACKAGING_CHANGES.md - 变更记录

  已修改：
  - main.go - 添加 embed 支持
  - vite.config.js - 优化构建配置