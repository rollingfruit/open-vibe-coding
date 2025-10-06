#!/usr/bin/env node

/**
 * 通用代码重构脚本
 * 用于从 app.js 中提取方法到独立模块
 */

const fs = require('fs');
const path = require('path');

class CodeRefactor {
    constructor(sourceFile) {
        this.sourceFile = sourceFile;
        this.sourceContent = fs.readFileSync(sourceFile, 'utf-8');
    }

    /**
     * 提取指定方法到新文件
     * @param {Array} methodNames - 要提取的方法名列表
     * @param {string} targetFile - 目标文件路径
     * @param {string} className - 新类的名称（如果需要）
     * @param {boolean} needsClass - 是否需要包装成类
     */
    extractMethods(methodNames, targetFile, className = null, needsClass = false) {
        const extractedMethods = [];
        const methodPatterns = [];

        // 为每个方法创建正则表达式模式
        for (const methodName of methodNames) {
            // 匹配方法定义（支持不同格式）
            const pattern = new RegExp(
                `(\\s*(?:/\\*\\*[\\s\\S]*?\\*/\\s*)?` + // 可选的注释
                `(?:async\\s+)?` + // 可选的 async
                `${methodName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\s*\\})`,
                'gm'
            );
            methodPatterns.push({ name: methodName, pattern });
        }

        // 提取方法内容
        for (const { name, pattern } of methodPatterns) {
            const matches = this.sourceContent.match(pattern);
            if (matches) {
                extractedMethods.push({
                    name,
                    code: matches[0]
                });
            } else {
                console.warn(`⚠️  未找到方法: ${name}`);
            }
        }

        // 生成目标文件内容
        let targetContent = '';

        if (needsClass && className) {
            // 生成类包装
            targetContent = this.generateClassFile(extractedMethods, className);
        } else {
            // 生成独立函数
            targetContent = this.generateFunctionFile(extractedMethods);
        }

        // 确保目标目录存在
        const targetDir = path.dirname(targetFile);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 写入目标文件
        fs.writeFileSync(targetFile, targetContent, 'utf-8');
        console.log(`✅ 已创建文件: ${targetFile}`);

        return extractedMethods;
    }

    /**
     * 生成类文件内容
     */
    generateClassFile(methods, className) {
        let content = `/**\n * ${className}\n * 从 app.js 重构提取\n */\n\n`;
        content += `export class ${className} {\n`;
        content += `    constructor() {\n`;
        content += `        // 初始化\n`;
        content += `    }\n\n`;

        for (const method of methods) {
            // 去掉方法前的缩进，添加类的缩进
            const methodCode = method.code.trim().replace(/^/gm, '    ');
            content += `${methodCode}\n\n`;
        }

        content += `}\n`;
        return content;
    }

    /**
     * 生成函数文件内容
     */
    generateFunctionFile(methods) {
        let content = `/**\n * 工具函数\n * 从 app.js 重构提取\n */\n\n`;

        for (const method of methods) {
            // 将方法转换为导出函数
            let methodCode = method.code.trim();
            methodCode = methodCode.replace(/^(\s*)/, 'export ');
            content += `${methodCode}\n\n`;
        }

        return content;
    }

    /**
     * 从源文件中删除已提取的方法
     */
    removeMethods(methodNames) {
        let newContent = this.sourceContent;

        for (const methodName of methodNames) {
            const pattern = new RegExp(
                `\\s*(?:/\\*\\*[\\s\\S]*?\\*/\\s*)?` +
                `(?:async\\s+)?` +
                `${methodName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\s*\\}\\s*\n`,
                'gm'
            );
            newContent = newContent.replace(pattern, '');
        }

        this.sourceContent = newContent;
        return this;
    }

    /**
     * 添加导入语句
     */
    addImport(importStatement) {
        // 在文件开头添加导入
        const lines = this.sourceContent.split('\n');

        // 找到第一个非注释、非空行
        let insertIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('//') && !line.startsWith('/*')) {
                insertIndex = i;
                break;
            }
        }

        lines.splice(insertIndex, 0, importStatement);
        this.sourceContent = lines.join('\n');
        return this;
    }

    /**
     * 替换方法调用
     */
    replaceMethodCalls(replacements) {
        for (const { from, to } of replacements) {
            const pattern = new RegExp(`\\b${from}\\(`, 'g');
            this.sourceContent = this.sourceContent.replace(pattern, `${to}(`);
        }
        return this;
    }

    /**
     * 保存源文件
     */
    save(backupFirst = true) {
        if (backupFirst) {
            const backupFile = this.sourceFile + '.backup';
            fs.writeFileSync(backupFile, fs.readFileSync(this.sourceFile, 'utf-8'));
            console.log(`📦 已备份原文件: ${backupFile}`);
        }

        fs.writeFileSync(this.sourceFile, this.sourceContent, 'utf-8');
        console.log(`✅ 已更新文件: ${this.sourceFile}`);
        return this;
    }
}

// 导出供其他脚本使用
module.exports = { CodeRefactor };

// 如果直接运行此脚本
if (require.main === module) {
    console.log('📝 代码重构脚本已就绪');
    console.log('请使用具体的重构脚本（如 refactor-step1.js）来执行重构');
}
