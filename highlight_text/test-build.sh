#!/bin/bash

# AI助手 - 构建验证测试脚本

echo "🧪 开始验证构建结果..."
echo ""

# 检查 build 目录是否存在
if [ ! -d "build" ]; then
    echo "❌ build/ 目录不存在！请先运行 ./build.sh"
    exit 1
fi

# 检查必要的文件
echo "📋 检查文件..."
files=(
    "build/AIHelper-Windows-x64.exe"
    "build/AIHelper-macOS-Intel"
    "build/AIHelper-macOS-AppleSilicon"
)

missing=0
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        size=$(ls -lh "$file" | awk '{print $5}')
        echo "  ✓ $file ($size)"
    else
        echo "  ✗ $file - 文件缺失"
        missing=$((missing + 1))
    fi
done

if [ $missing -gt 0 ]; then
    echo ""
    echo "❌ 有 $missing 个文件缺失，请重新运行 ./build.sh"
    exit 1
fi

echo ""
echo "🔍 检查文件权限..."
# 检查 macOS 文件是否可执行
for file in "build/AIHelper-macOS-Intel" "build/AIHelper-macOS-AppleSilicon"; do
    if [ -x "$file" ]; then
        echo "  ✓ $file 可执行"
    else
        echo "  ! $file 不可执行，正在添加权限..."
        chmod +x "$file"
        echo "    ✓ 已添加执行权限"
    fi
done

echo ""
echo "🧬 检查嵌入的资源..."
# 检查 dist 目录是否存在（用于构建）
if [ ! -d "dist" ]; then
    echo "  ⚠️  dist/ 目录不存在（这是正常的，只需在构建时存在）"
else
    dist_files=$(find dist -type f | wc -l | tr -d ' ')
    echo "  ✓ dist/ 目录包含 $dist_files 个文件"
fi

echo ""
echo "📊 文件大小统计："
total_size=$(du -sh build 2>/dev/null | awk '{print $1}')
echo "  总大小: $total_size"
echo ""

echo "✅ 所有检查通过！"
echo ""
echo "🚀 快速测试运行（按 Ctrl+C 停止）："
echo ""
echo "  当前平台测试命令："
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    arch=$(uname -m)
    if [[ "$arch" == "arm64" ]]; then
        echo "  ./build/AIHelper-macOS-AppleSilicon"
        echo ""
        echo "是否现在启动测试？(y/n)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            echo ""
            echo "🎯 启动服务器..."
            ./build/AIHelper-macOS-AppleSilicon
        fi
    else
        echo "  ./build/AIHelper-macOS-Intel"
        echo ""
        echo "是否现在启动测试？(y/n)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            echo ""
            echo "🎯 启动服务器..."
            ./build/AIHelper-macOS-Intel
        fi
    fi
else
    echo "  (非 macOS 系统，请手动测试对应平台的可执行文件)"
fi

echo ""
echo "访问 http://localhost:8080 查看应用"
echo ""
