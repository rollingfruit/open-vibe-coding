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
