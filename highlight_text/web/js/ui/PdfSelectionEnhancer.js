/**
 * PdfSelectionEnhancer - PDF文本选择增强器
 *
 * 解决PDF.js中文本选择不准确的问题：
 * 1. 清理选中文本中的多余空白和换行
 * 2. 智能检测和移除非连续选择的内容
 * 3. 提供更准确的选中文本边界
 */

export class PdfSelectionEnhancer {
    constructor() {
        // 文本清理配置
        this.config = {
            // 是否移除多余空白
            trimWhitespace: true,
            // 是否合并多个空格为一个
            collapseSpaces: true,
            // 是否移除换行符
            removeLineBreaks: false,
            // 是否智能合并换行（保留段落分隔）
            smartMergeLines: true,
            // 最大允许的连续空行数
            maxConsecutiveEmptyLines: 1
        };
    }

    /**
     * 清理PDF选中的文本
     * @param {string} text - 原始选中的文本
     * @returns {string} 清理后的文本
     */
    cleanSelectedText(text) {
        if (!text) return '';

        let cleaned = text;

        // 1. 移除首尾空白
        if (this.config.trimWhitespace) {
            cleaned = cleaned.trim();
        }

        // 2. 智能合并换行
        if (this.config.smartMergeLines) {
            cleaned = this.smartMergeLineBreaks(cleaned);
        } else if (this.config.removeLineBreaks) {
            // 简单移除所有换行
            cleaned = cleaned.replace(/\n/g, ' ');
        }

        // 3. 合并多个空格
        if (this.config.collapseSpaces) {
            cleaned = cleaned.replace(/\s+/g, ' ');
        }

        // 4. 移除多余的连续空行
        cleaned = this.removeExcessiveEmptyLines(cleaned);

        return cleaned.trim();
    }

    /**
     * 智能合并换行符
     * 保留段落分隔，但合并段落内的换行
     * @param {string} text - 原始文本
     * @returns {string} 处理后的文本
     */
    smartMergeLineBreaks(text) {
        // 将连续的多个换行视为段落分隔（保留）
        // 单个换行视为行内换行（合并为空格）

        // 先标记段落分隔符
        let processed = text.replace(/\n\s*\n/g, '<<<PARAGRAPH>>>');

        // 合并单个换行为空格
        processed = processed.replace(/\n/g, ' ');

        // 恢复段落分隔
        processed = processed.replace(/<<<PARAGRAPH>>>/g, '\n\n');

        return processed;
    }

    /**
     * 移除过多的连续空行
     * @param {string} text - 原始文本
     * @returns {string} 处理后的文本
     */
    removeExcessiveEmptyLines(text) {
        const maxLines = this.config.maxConsecutiveEmptyLines;
        const pattern = new RegExp(`\\n{${maxLines + 2},}`, 'g');
        const replacement = '\n'.repeat(maxLines + 1);
        return text.replace(pattern, replacement);
    }

    /**
     * 检测并修复跨列/跨页的选择
     * PDF中可能会因为布局问题导致选择了不连续的文本
     * @param {string} text - 原始文本
     * @returns {object} {text: string, hasIssue: boolean}
     */
    detectAndFixDisjointSelection(text) {
        // 检测是否有明显的不连续性标志
        const issues = [];

        // 1. 检测文本中是否有突然的主题跳跃（启发式方法）
        // 例如：标题后突然出现无关内容
        const lines = text.split('\n');

        // 2. 检测是否有重复的页眉/页脚
        const headerFooterPattern = /^(第\s*\d+\s*页|\d+\s*\/\s*\d+|Page\s+\d+)/;
        const filteredLines = lines.filter(line => !headerFooterPattern.test(line.trim()));

        // 3. 检测数字列表的连续性
        const hasNumberListBreak = this.detectNumberListBreak(lines);

        const hasIssue = filteredLines.length < lines.length || hasNumberListBreak;
        const cleanedText = filteredLines.join('\n');

        return {
            text: cleanedText,
            hasIssue: hasIssue,
            issues: issues
        };
    }

    /**
     * 检测数字列表是否有断裂
     * @param {Array<string>} lines - 文本行数组
     * @returns {boolean}
     */
    detectNumberListBreak(lines) {
        const numberPattern = /^\s*(\d+)[.、)]\s*/;
        let lastNumber = 0;
        let hasBreak = false;

        for (const line of lines) {
            const match = line.match(numberPattern);
            if (match) {
                const currentNumber = parseInt(match[1]);
                if (lastNumber > 0 && currentNumber !== lastNumber + 1) {
                    hasBreak = true;
                    break;
                }
                lastNumber = currentNumber;
            }
        }

        return hasBreak;
    }

    /**
     * 从PDF iframe中获取选中文本并清理
     * @param {HTMLIFrameElement} iframe - PDF viewer的iframe
     * @returns {Promise<{text: string, cleaned: string, range: object}>}
     */
    async getCleanedSelectionFromIframe(iframe) {
        try {
            if (!iframe || !iframe.contentWindow) {
                console.warn('Invalid iframe');
                return null;
            }

            const iframeDoc = iframe.contentWindow.document;
            const selection = iframe.contentWindow.getSelection();

            if (!selection || selection.rangeCount === 0) {
                return null;
            }

            const rawText = selection.toString();
            if (!rawText || rawText.trim().length === 0) {
                return null;
            }

            // 清理文本
            const cleaned = this.cleanSelectedText(rawText);

            // 检测并修复不连续选择
            const fixed = this.detectAndFixDisjointSelection(cleaned);

            // 获取选区范围信息
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            return {
                raw: rawText,
                cleaned: fixed.text,
                hasIssue: fixed.hasIssue,
                range: {
                    startOffset: range.startOffset,
                    endOffset: range.endOffset,
                    boundingRect: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                    }
                }
            };
        } catch (error) {
            console.error('Failed to get cleaned selection from iframe:', error);
            return null;
        }
    }

    /**
     * 更新配置
     * @param {object} newConfig - 新的配置项
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}
