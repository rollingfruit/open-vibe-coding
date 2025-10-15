/**
 * 公共工具函数
 * 从 app.js 重构提取
 */

/**
 * 转义HTML特殊字符
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的HTML
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 反转义Unicode字符
 * @param {string} text - 包含Unicode转义序列的文本
 * @returns {string} 反转义后的文本
 */
export function unescapeUnicodeChars(text) {
    // 处理常见的Unicode转义字符
    return text
        .replace(/\\u003c/g, '<')  // \u003c -> <
        .replace(/\\u003e/g, '>')  // \u003e -> >
        .replace(/\\u0026/g, '&')  // \u0026 -> &
        .replace(/\\u0022/g, '"')  // \u0022 -> "
        .replace(/\\u0027/g, "'")  // \u0027 -> '
        .replace(/\\u002f/g, '/')  // \u002f -> /
        .replace(/\\u003d/g, '=')  // \u003d -> =
        .replace(/\\u0020/g, ' ')  // \u0020 -> space
        .replace(/\\u000a/g, '\n') // \u000a -> newline
        .replace(/\\u000d/g, '\r') // \u000d -> carriage return
        .replace(/\\u0009/g, '\t') // \u0009 -> tab
        // 处理通用的Unicode转义模式 \uXXXX
        .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
}

/**
 * 将行号范围转换为字符索引位置
 * 用于Agent工具调用时将基于行号的修改转换为InlineDiffView所需的字符位置
 * @param {string} text - 完整文本内容
 * @param {number} startLine - 起始行号（从1开始）
 * @param {number} endLine - 结束行号（包含此行）
 * @returns {Object|null} 包含 {selectionStart, selectionEnd, selectedText} 的对象，失败返回null
 */
export function convertLinesToSelection(text, startLine, endLine) {
    const lines = text.split('\n');

    // 验证行号范围
    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
        console.error(`Invalid line range: ${startLine}-${endLine} (total lines: ${lines.length})`);
        return null;
    }

    // 计算起始字符位置
    let selectionStart = 0;
    for (let i = 0; i < startLine - 1; i++) {
        selectionStart += lines[i].length + 1; // +1 for newline character
    }

    // 计算结束字符位置
    let selectionEnd = selectionStart;
    for (let i = startLine - 1; i < endLine; i++) {
        selectionEnd += lines[i].length;
        if (i < endLine - 1) {
            selectionEnd += 1; // Add newline character for all but the last line in selection
        }
    }

    // 提取选中的文本
    const selectedText = text.substring(selectionStart, selectionEnd);

    return {
        selectionStart,
        selectionEnd,
        selectedText
    };
}
