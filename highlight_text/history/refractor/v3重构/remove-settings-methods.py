#!/usr/bin/env python3
"""
删除app.js中已提取到SettingsManager的方法
"""

import re

# 读取文件
with open('web/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 需要删除的方法列表
methods_to_remove = [
    'showSettings',
    'hideSettings',
    'bindSettingsTabEvents',
    'renderCommandsList',
    'addCommand',
    'deleteCommand',
    'renderShortcutsSettings',
    'addShortcut',
    'deleteShortcut',
    'buildShortcutKeyString',
    'checkShortcutConflict',
    'saveSettingsFromModal'
]

# 删除每个方法
for method in methods_to_remove:
    # 匹配方法定义：从方法名开始到下一个方法或类结束
    # 支持async和普通方法
    pattern = r'(\n\s*(?:async\s+)?' + re.escape(method) + r'\s*\([^)]*\)\s*\{(?:[^{}]|\{[^{}]*\})*\})'

    # 使用更精确的模式：匹配完整的方法块（包括嵌套的大括号）
    def find_method_block(text, method_name):
        # 查找方法定义的开始
        pattern_start = r'(\n\s*(?:async\s+)?' + re.escape(method_name) + r'\s*\([^)]*\)\s*\{)'
        match = re.search(pattern_start, text)
        if not match:
            return None, None

        start_pos = match.start()
        brace_pos = match.end() - 1  # '{'的位置

        # 从{开始，找到匹配的}
        depth = 0
        pos = brace_pos
        while pos < len(text):
            if text[pos] == '{':
                depth += 1
            elif text[pos] == '}':
                depth -= 1
                if depth == 0:
                    return start_pos, pos + 1
            pos += 1

        return None, None

    while True:
        start, end = find_method_block(content, method)
        if start is None:
            break
        print(f"删除方法: {method} (位置: {start}-{end})")
        content = content[:start] + content[end:]

# 写回文件
with open('web/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("\n✅ 完成！已删除所有设置管理相关方法")
