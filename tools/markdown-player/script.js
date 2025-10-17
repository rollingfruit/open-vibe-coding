document.addEventListener('DOMContentLoaded', () => {
    // 1. 获取 DOM 元素
    const markdownInput = document.getElementById('markdown-input');
    const markdownOutput = document.getElementById('markdown-output');
    const resizableContainer = document.getElementById('resizable-container');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resetBtn = document.getElementById('reset-btn');

    // 全局变量，用于存储动画实例
    let animation = null;

    // 2. 初始化 Marked.js 和 Highlight.js
    // 配置 Marked.js 以使用 Highlight.js 进行代码高亮
    marked.setOptions({
        highlight: function(code, lang) {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
        },
        langPrefix: 'hljs language-',
        gfm: true,
        breaks: true,
    });

    // 3. 实时渲染 Markdown
    const renderMarkdown = () => {
        const rawInput = markdownInput.value;
        // 使用 marked 解析
        const dirtyHtml = marked.parse(rawInput);
        // 使用 DOMPurify 清洁 HTML，防止 XSS
        const cleanHtml = DOMPurify.sanitize(dirtyHtml);
        markdownOutput.innerHTML = cleanHtml;
    };

    markdownInput.addEventListener('input', renderMarkdown);
    // 页面加载时先渲染一次默认内容
    renderMarkdown();

    // 4. 初始化 Interact.js 实现容器尺寸调整
    interact(resizableContainer)
        .resizable({
            edges: { left: true, right: true, bottom: true, top: true },
            listeners: {
                move(event) {
                    let { x, y } = event.target.dataset;
                    x = (parseFloat(x) || 0) + event.delta.x;
                    y = (parseFloat(y) || 0) + event.delta.y;

                    Object.assign(event.target.style, {
                        width: `${event.rect.width}px`,
                        height: `${event.rect.height}px`,
                    });

                    Object.assign(event.target.dataset, { x, y });
                }
            },
            modifiers: [
                interact.modifiers.restrictEdges({
                    outer: 'parent'
                }),
                interact.modifiers.restrictSize({
                    min: { width: 200, height: 150 }
                })
            ],
            inertia: true
        });

    // 5. 实现动画播放逻辑
    const playAnimation = () => {
        // 先重置之前的动画
        if (animation) {
            animation.kill();
        }

        const containerHeight = resizableContainer.clientHeight;
        const contentHeight = markdownOutput.scrollHeight;

        // 如果内容没有超出容器，则无需播放
        if (contentHeight <= containerHeight) {
            console.log("内容不足，无需播放。");
            return;
        }

        // 计算需要滚动的总距离
        const scrollDistance = contentHeight - containerHeight;
        
        // 基于内容长度估算一个舒适的播放时间 (例如每 1000 像素 15 秒)
        const duration = (contentHeight / 1000) * 15;

        // 使用 GSAP 创建动画
        animation = gsap.to(markdownOutput, {
            y: -scrollDistance, // 向上移动
            duration: duration,
            ease: "none" // 匀速播放
        });
    };

    const pauseAnimation = () => {
        if (animation) {
            animation.pause();
        }
    };

    const resetAnimation = () => {
        if (animation) {
            animation.kill(); // 彻底停止并移除动画
            animation = null;
        }
        // 将内容位置重置到顶部
        gsap.to(markdownOutput, { y: 0, duration: 0.5, ease: "power2.out" });
    };

    // 6. 绑定按钮事件
    playBtn.addEventListener('click', () => {
        if (animation && animation.isPaused()) {
            animation.resume();
        } else {
            // 在播放前，确保最新的内容已渲染
            renderMarkdown(); 
            // 延迟一点时间再播放，确保浏览器完成渲染
            setTimeout(playAnimation, 100); 
        }
    });

    pauseBtn.addEventListener('click', pauseAnimation);
    resetBtn.addEventListener('click', resetAnimation);
});