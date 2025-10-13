/**
 * ShortcutManager - 管理笔记编辑器的快捷键
 * 避免与浏览器原生快捷键冲突，支持可配置的Markdown快捷键
 */
class ShortcutManager {
    /**
     * 构造函数
     * @param {HTMLTextAreaElement} editor - 笔记编辑器的DOM元素
     * @param {Array} initialSettings - 初始的快捷键配置
     * @param {AIAssistant} appInstance - 主应用的实例，用于调用保存等方法
     */
    constructor(editor, initialSettings, appInstance) {
        this.editor = editor;
        this.shortcuts = initialSettings || [];
        this.app = appInstance;
        this.isEnabled = true;
    }

    /**
     * 初始化，绑定事件监听器
     */
    init() {
        if (!this.editor) {
            console.error('[ShortcutManager] ❌ 编辑器元素未找到，无法初始化快捷键');
            return;
        }

        // 在 noteEditor 上绑定 onKeyDown 方法
        this.editor.addEventListener('keydown', this.onKeyDown.bind(this));
    }

    /**
     * 更新配置
     * @param {Array} newSettings - 新的快捷键配置数组
     */
    loadSettings(newSettings) {
        this.shortcuts = newSettings || [];
    }

    /**
     * 构建快捷键字符串
     * @param {KeyboardEvent} event
     * @returns {string} 例如 "Ctrl+B", "Ctrl+Shift+I"
     */
    buildKeyString(event) {
        const parts = [];

        // 注意：macOS 使用 Meta (Command), Windows/Linux 使用 Ctrl
        if (event.ctrlKey || event.metaKey) {
            parts.push('Ctrl');
        }
        if (event.shiftKey) {
            parts.push('Shift');
        }
        if (event.altKey) {
            parts.push('Alt');
        }

        // 使用 event.code 获取物理按键，避免 Alt 键影响字符
        // event.code 格式如 "KeyA", "Digit1", "Digit2" 等
        const code = event.code;

        // 排除修饰键本身
        if (!['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code)) {
            let mainKey = '';

            // 处理字母键 KeyA-KeyZ
            if (code.startsWith('Key')) {
                mainKey = code.substring(3); // KeyA -> A
            }
            // 处理数字键 Digit0-Digit9
            else if (code.startsWith('Digit')) {
                mainKey = code.substring(5); // Digit1 -> 1
            }
            // 处理其他常用键
            else if (code === 'Space') {
                mainKey = 'Space';
            } else if (code === 'Enter') {
                mainKey = 'Enter';
            } else if (code === 'Backspace') {
                mainKey = 'Backspace';
            } else {
                // 其他情况使用 event.key
                mainKey = event.key.toUpperCase();
            }

            if (mainKey) {
                parts.push(mainKey);
            }
        }

        return parts.join('+');
    }

    /**
     * 处理键盘按下事件的核心方法
     * @param {KeyboardEvent} event
     */
    onKeyDown(event) {
        if (!this.isEnabled) {
            return;
        }

        // 构建快捷键字符串
        const keyString = this.buildKeyString(event);

        // 在已加载的配置中查找匹配的快捷键
        let shortcut = this.shortcuts.find(s => {
            const configKey = s.key.replace(/Command/g, 'Ctrl'); // 兼容macOS的Command键
            return configKey === keyString;
        });

        // 如果没有找到精确匹配，尝试通配符匹配
        if (!shortcut) {
            shortcut = this.shortcuts.find(s => {
                const configKey = s.key.replace(/Command/g, 'Ctrl');
                // 检查是否包含 N 通配符（数字键）
                if (configKey.includes('+N')) {
                    const pattern = configKey.replace('+N', '\\+[1-9]');
                    const regex = new RegExp(`^${pattern}$`);
                    return regex.test(keyString);
                }
                return false;
            });

            // 如果匹配到数字键通配符，需要替换模板中的 N
            if (shortcut) {
                const digitMatch = keyString.match(/\+([1-9])$/);
                if (digitMatch) {
                    const digit = parseInt(digitMatch[1]);
                    let template = shortcut.template;

                    // 处理 #N 格式（标题）：替换为对应数量的 #
                    if (template.includes('#N')) {
                        const hashes = '#'.repeat(digit);
                        template = template.replace(/#N/g, hashes);
                    } else {
                        // 普通 N 替换
                        template = template.replace(/N/g, digit);
                    }

                    // 创建一个副本
                    shortcut = {
                        ...shortcut,
                        template: template
                    };
                }
            } else {
            }
        }

        if (shortcut) {
            // 阻止默认行为
            event.preventDefault();
            event.stopPropagation();

            // 根据配置的动作类型执行操作
            if (shortcut.type === 'markdown') {
                this.applyMarkdownFormatting(shortcut.template);
            } else if (shortcut.type === 'action') {
                this.executeAction(shortcut.action);
            }

        } else {
        }
    }

    /**
     * 应用Markdown格式化
     * @param {string} template - Markdown模板, 例如 "**{}**", "[{}]()", "![]({})"
     */
    applyMarkdownFormatting(template) {

        const start = this.editor.selectionStart;
        const end = this.editor.selectionEnd;
        const selectedText = this.editor.value.substring(start, end);
        const beforeText = this.editor.value.substring(0, start);
        const afterText = this.editor.value.substring(end);


        let newText;
        let newCursorPos;

        if (selectedText) {
            // 有选中文本：用模板包裹选中文本
            newText = template.replace('{}', selectedText);
            newCursorPos = start + newText.length;
        } else {
            // 没有选中文本：插入模板，光标定位到占位符位置
            const placeholderIndex = template.indexOf('{}');
            if (placeholderIndex !== -1) {
                // 将 {} 替换为空，光标定位在原 {} 的位置
                newText = template.replace('{}', '');
                newCursorPos = start + placeholderIndex;
            } else {
                // 模板中没有占位符，直接插入
                newText = template;
                newCursorPos = start + newText.length;
            }
        }

        // 更新编辑器的值
        const finalValue = beforeText + newText + afterText;
        this.editor.value = finalValue;

        // 恢复焦点并设置光标位置
        this.editor.focus();
        this.editor.setSelectionRange(newCursorPos, newCursorPos);

        // 触发input事件，以便其他监听器能感知到变化（如预览更新）
        this.editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * 执行预定义的操作
     * @param {string} actionName - 例如 'saveNote', 'togglePreview'
     */
    executeAction(actionName) {
        switch (actionName) {
            case 'saveNote':
                // 调用主应用的保存笔记方法
                if (this.app && typeof this.app.saveActiveNote === 'function') {
                    this.app.saveActiveNote();
                }
                break;
            case 'togglePreview':
                // 切换预览模式
                if (this.app && typeof this.app.togglePreview === 'function') {
                    this.app.togglePreview();
                }
                break;
            case 'backToChat':
                // 返回聊天模式
                if (this.app && typeof this.app.switchToMode === 'function') {
                    this.app.switchToMode('chat');
                }
                break;
            default:
                console.warn('[ShortcutManager] 未知的操作：', actionName);
        }
    }

    /**
     * 启用快捷键
     */
    enable() {
        this.isEnabled = true;
    }

    /**
     * 禁用快捷键
     */
    disable() {
        this.isEnabled = false;
    }
}
