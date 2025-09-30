@echo off
echo.
echo ====================================
echo    🚀 AI助手Web版启动脚本
echo ====================================
echo.

REM 检查当前目录是否存在main.go
if not exist "main.go" (
    echo ❌ 错误: 找不到main.go文件
    echo 请确保在项目根目录下运行此脚本
    pause
    exit /b 1
)

REM 检查Go是否已安装
go version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未检测到Go环境
    echo 请先安装Go语言运行时: https://golang.org/dl/
    pause
    exit /b 1
)

echo ✅ Go环境检查通过
echo.

REM 编译项目
echo 📦 正在编译项目...
go build -o ai-helper-web.exe main.go
if errorlevel 1 (
    echo ❌ 编译失败
    pause
    exit /b 1
)

echo ✅ 编译完成
echo.

REM 启动服务
echo 🌟 正在启动AI助手服务...
echo.
start "" ai-helper-web.exe

REM 等待服务启动
echo ⏳ 等待服务启动完成...
timeout /t 3 /nobreak > nul

REM 打开浏览器
echo 🌐 正在打开浏览器...
start "" http://localhost:8080

echo.
echo ====================================
echo    ✨ 启动完成！
echo ====================================
echo.
echo 📱 Web界面已在浏览器中打开
echo 🔗 访问地址: http://localhost:8080
echo 📝 日志文件: interactions.log.json
echo.
echo ⚠️  注意事项:
echo    • 首次使用请在设置中配置API密钥
echo    • 关闭此窗口将停止服务
echo    • 按 Ctrl+C 可手动停止服务
echo.
echo ====================================

pause