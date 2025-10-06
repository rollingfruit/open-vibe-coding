#!/usr/bin/env node

/**
 * 重构步骤1: 提取公共工具函数
 * 将 escapeHtml 和 unescapeUnicodeChars 提取到 helpers.js
 */

const { CodeRefactor } = require('./refactor.js');
const path = require('path');

console.log('🚀 开始重构步骤1: 提取公共工具函数\n');

const sourceFile = path.join(__dirname, 'web/app.js');
const targetFile = path.join(__dirname, 'web/js/utils/helpers.js');

const refactor = new CodeRefactor(sourceFile);

// 1. 提取方法到新文件
console.log('📤 提取方法到 helpers.js...');
const methodsToExtract = ['escapeHtml', 'unescapeUnicodeChars'];

refactor.extractMethods(methodsToExtract, targetFile, null, false);

// 2. 添加导入语句到 app.js
console.log('\n📥 添加导入语句...');
refactor.addImport("import { escapeHtml, unescapeUnicodeChars } from './js/utils/helpers.js';");

// 3. 替换方法调用（从 this.methodName 到 methodName）
console.log('🔄 替换方法调用...');
refactor.replaceMethodCalls([
    { from: 'this\\.escapeHtml', to: 'escapeHtml' },
    { from: 'this\\.unescapeUnicodeChars', to: 'unescapeUnicodeChars' }
]);

// 4. 从原文件删除已提取的方法
console.log('🗑️  从 app.js 删除已提取的方法...');
refactor.removeMethods(methodsToExtract);

// 5. 保存文件
console.log('\n💾 保存文件...');
refactor.save(true);

console.log('\n✅ 重构步骤1完成！');
console.log('\n📋 下一步:');
console.log('1. 在浏览器中测试应用，确保HTML转义和Unicode字符处理正常');
console.log('2. 如果测试通过，运行: node refactor-step2.js');
console.log('3. 如果有问题，可以从 web/app.js.backup 恢复原文件');
