@echo off
REM AI助手 - Windows 自动打包脚本
REM 用于将前端和后端打包成单一可执行文件

setlocal enabledelayedexpansion

echo 🚀 开始构建 AI助手应用...
echo.

REM 1. 清理旧的构建文件
echo 📦 第一步: 清理旧的构建文件...
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build
mkdir build
echo ✅ 清理完成
echo.

REM 2. 编译前端资源
echo 🎨 第二步: 编译前端资源 (Vite + Tailwind)...
call npm run build
if errorlevel 1 (
    echo ❌ 前端编译失败！
    pause
    exit /b 1
)
echo ✅ 前端编译完成
echo.

REM 3. 编译 Go 后端并嵌入前端资源
echo 🔨 第三步: 编译跨平台可执行文件...

REM Windows 64-bit
echo   - 正在编译 Windows x64 版本...
set GOOS=windows
set GOARCH=amd64
go build -ldflags "-H windowsgui" -o build\AIHelper-Windows-x64.exe main.go workspace.go
if errorlevel 1 (
    echo ❌ Windows 编译失败！
    pause
    exit /b 1
)
echo     ✓ AIHelper-Windows-x64.exe

REM macOS Intel
echo   - 正在编译 macOS Intel 版本...
set GOOS=darwin
set GOARCH=amd64
go build -o build\AIHelper-macOS-Intel main.go workspace.go
if errorlevel 1 (
    echo ❌ macOS Intel 编译失败！
    pause
    exit /b 1
)
echo     ✓ AIHelper-macOS-Intel

REM macOS Apple Silicon
echo   - 正在编译 macOS Apple Silicon 版本...
set GOOS=darwin
set GOARCH=arm64
go build -o build\AIHelper-macOS-AppleSilicon main.go workspace.go
if errorlevel 1 (
    echo ❌ macOS Apple Silicon 编译失败！
    pause
    exit /b 1
)
echo     ✓ AIHelper-macOS-AppleSilicon

echo ✅ 所有平台编译完成
echo.

REM 4. 显示构建结果
echo 📊 构建结果:
echo ----------------------------------------
dir build /b
echo ----------------------------------------
echo.

echo 🎉 构建完成！可执行文件位于 build\ 目录中
echo.
echo 📝 使用说明:
echo   Windows 用户: 双击运行 AIHelper-Windows-x64.exe
echo   macOS Intel 用户: ./AIHelper-macOS-Intel
echo   macOS Apple Silicon 用户: ./AIHelper-macOS-AppleSilicon
echo.
echo   首次运行会自动创建以下目录：
echo     - KnowledgeBase\  (知识库)
echo     - uploads\        (上传文件)
echo     - logs\           (日志文件)
echo.
echo   服务启动后访问: http://localhost:8080
echo.

pause
