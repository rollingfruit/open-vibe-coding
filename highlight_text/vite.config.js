import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'web',
  publicDir: false,  // 不复制任何public目录，uploads和KnowledgeBase在运行时动态创建

  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        performanceTest: resolve(__dirname, 'web/test/performance-tests.html')
      }
    },
    // 优化chunk大小
    chunkSizeWarningLimit: 1000,
    // 启用CSS代码分割
    cssCodeSplit: true,
    // 压缩选项
    minify: 'esbuild'
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
    exclude: []
  },

  css: {
    postcss: './postcss.config.js'
  }
});
