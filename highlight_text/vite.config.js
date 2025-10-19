import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'web',
  publicDir: '../uploads',

  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        performanceTest: resolve(__dirname, 'web/test/performance-tests.html')
      },
      output: {
        manualChunks: {
          // 第三方库分离
          'vendor-highlight': ['highlight.js'],
          'vendor-marked': ['marked'],
          // UI组件
          'ui': [
            './web/js/ui/SelectionHighlighter.js',
            './web/js/ui/PdfSelectionEnhancer.js'
          ],
          // 核心功能
          'core': [
            './web/js/core/ChatManager.js',
            './web/js/core/UIManager.js',
            './web/js/core/SessionManager.js',
            './web/js/core/SettingsManager.js'
          ],
          // 笔记功能
          'notes': [
            './web/js/notes/NoteManager.js',
            './web/js/notes/NotePreview.js'
          ],
          // 工作空间功能（懒加载）
          'workspace': [
            './web/views/workspace/WorkspaceView.js',
            './web/views/workspace/CalendarView.js',
            './web/views/workspace/GanttView.js',
            './web/views/workspace/AnalyticsView.js'
          ]
        }
      }
    },
    // 优化chunk大小
    chunkSizeWarningLimit: 500,
    // 启用CSS代码分割
    cssCodeSplit: true,
    // 压缩选项
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  },

  server: {
    port: 3000,
    proxy: {
      // 代理API请求到Go后端
      '/api': 'http://localhost:8080',
      '/upload-image': 'http://localhost:8080',
      '/log': 'http://localhost:8080',
      '/preview': 'http://localhost:8080',
      '/notes': 'http://localhost:8080',
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true
      }
    }
  },

  optimizeDeps: {
    include: [
      'diff-match-patch'
    ]
  },

  css: {
    postcss: './postcss.config.js'
  }
});
