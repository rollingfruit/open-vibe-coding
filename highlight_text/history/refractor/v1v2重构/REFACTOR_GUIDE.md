# 项目重构使用指南

## 已完成的重构

### ✅ 优先级1: 公共工具函数
- **文件**: `web/js/utils/helpers.js`
- **状态**: 已完成并测试通过
- **功能**: HTML转义、Unicode字符处理

### ✅ 优先级2: UI管理器
- **文件**: `web/js/core/UIManager.js`
- **状态**: 已完成并测试通过
- **功能**: 主题切换、通知显示、抽屉折叠

## 如何继续重构步骤3 (设置管理器)

### 准备工作

1. 确保当前重构工作正常:
```bash
# 在浏览器中访问 http://localhost:8080
# 测试以下功能:
# - 主题切换
# - 抽屉折叠/展开
# - 通知显示
```

2. 备份当前状态:
```bash
cp web/app.js web/app.js.step2-backup
```

### 步骤3: 拆分设置管理器

#### 1. 创建设置管理器文件

创建 `web/js/core/SettingsManager.js`:

```javascript
/**
 * 设置管理器
 * 负责设置模态框、指令管理、快捷键管理等
 */
export class SettingsManager {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
    }

    // 将相关方法从 app.js 复制到这里
    showSettings() { /* ... */ }
    hideSettings() { /* ... */ }
    // ... 其他方法
}
```

#### 2. 需要提取的方法列表

从 `app.js` 中找到并提取以下方法:

```bash
# 搜索这些方法
grep -n "showSettings\|hideSettings\|bindSettingsTabEvents\|renderCommandsList\|addCommand\|deleteCommand\|renderShortcutsSettings\|buildShortcutKeyString\|checkShortcutConflict\|addShortcut\|deleteShortcut\|saveSettingsFromModal" web/app.js
```

#### 3. 更新 app.js

在 `app.js` 顶部添加导入:
```javascript
import { SettingsManager } from './js/core/SettingsManager.js';
```

在 `constructor` 中初始化:
```javascript
// 设置管理器
this.settingsManager = new SettingsManager(this.config, this.settings);
```

#### 4. 批量替换方法调用

```bash
# 备份
cp web/app.js web/app.js.backup

# 替换调用
sed -i '' 's/this\.showSettings(/this.settingsManager.showSettings(/g' web/app.js
sed -i '' 's/this\.hideSettings(/this.settingsManager.hideSettings(/g' web/app.js
sed -i '' 's/this\.saveSettingsFromModal(/this.settingsManager.saveSettingsFromModal(/g' web/app.js
# ... 添加其他方法的替换

# 验证
grep -c "this\.settingsManager\." web/app.js
```

#### 5. 删除原方法

手动从 `app.js` 中删除已提取的方法定义。

#### 6. 测试

```bash
# 重启服务器
go run main.go

# 在浏览器中测试:
# 1. 点击"设置"按钮，确保模态框能打开
# 2. 测试各个标签页切换
# 3. 测试添加/删除指令
# 4. 测试添加/删除快捷键
# 5. 测试保存设置
```

---

## 通用重构脚本

项目中已包含通用重构脚本 `refactor.js`，可用于自动化部分重构工作:

```javascript
const { CodeRefactor } = require('./refactor.js');

const refactor = new CodeRefactor('web/app.js');

// 提取方法
refactor.extractMethods(
    ['methodName1', 'methodName2'],
    'web/js/core/ModuleName.js',
    'ModuleName',
    true  // 需要类包装
);

// 替换调用
refactor.replaceMethodCalls([
    { from: 'this\\.methodName1', to: 'this.moduleName.methodName1' }
]);

// 保存
refactor.save(true);
```

---

## 常见问题

### Q: 如何确定哪些方法应该一起提取?

A: 查看方法之间的调用关系和数据依赖。通常：
- 操作同一数据的方法应该在一起
- 功能相关的方法应该在一起
- 独立的工具函数可以单独提取

### Q: 提取后出现循环依赖怎么办?

A:
1. 使用回调函数传递依赖
2. 使用事件系统解耦
3. 重新设计模块边界

### Q: 如何回滚重构?

A:
```bash
# 如果有备份文件
cp web/app.js.backup web/app.js

# 如果使用git
git checkout web/app.js
```

---

## 检查清单

每次重构前:
- [ ] 阅读并理解要提取的代码
- [ ] 创建备份文件
- [ ] 确定依赖关系
- [ ] 准备测试计划

每次重构后:
- [ ] 检查控制台是否有错误
- [ ] 测试所有相关功能
- [ ] 更新文档
- [ ] 提交 git commit

---

## 推荐的重构顺序

基于代码耦合度，推荐按以下顺序继续重构:

1. ✅ **helpers.js** (已完成) - 完全独立
2. ✅ **UIManager.js** (已完成) - 低耦合
3. ⏳ **SettingsManager.js** (进行中) - 中等耦合
4. 📋 **SessionManager.js** - 会话管理
5. 📋 **NotesManager.js** - 笔记管理
6. 📋 **ChatManager.js** - 聊天逻辑
7. 📋 **AgentManager.js** - Agent相关

---

**祝重构顺利！**
