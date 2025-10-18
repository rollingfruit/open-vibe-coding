package notes

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Note 表示一篇笔记
type Note struct {
	ID        string                 `json:"id"`
	Title     string                 `json:"title"`
	Content   string                 `json:"content"`
	Path      string                 `json:"path"`
	CreatedAt time.Time              `json:"created_at"`
	UpdatedAt time.Time              `json:"updated_at"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	Tags      []string               `json:"tags,omitempty"`
}

// NoteMetadata YAML Front Matter元数据
type NoteMetadata struct {
	Title     string   `json:"title,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt string   `json:"created_at,omitempty"`
	UpdatedAt string   `json:"updated_at,omitempty"`
}

// FileNode 表示文件树节点
type FileNode struct {
	Name     string                 `json:"name"`
	Path     string                 `json:"path"`
	Type     string                 `json:"type"` // "file" or "folder"
	Children []*FileNode            `json:"children,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
	Tags     []string               `json:"tags,omitempty"`
}

// ToolDefinition 定义知识库工具
type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// GetKnowledgeTools 返回知识库专用工具列表
func GetKnowledgeTools() []ToolDefinition {
	return []ToolDefinition{
		{
			Name:        "search_notes",
			Description: "在知识库中搜索包含特定关键词的笔记。支持全文搜索，返回匹配的笔记列表及相关片段。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "搜索关键词或短语",
					},
				},
				"required": []string{"query"},
			},
		},
		{
			Name:        "read_note",
			Description: "读取指定笔记的完整内容。通过笔记ID或标题获取笔记全文。用于需要全文上下文的场景。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"note_id": map[string]interface{}{
						"type":        "string",
						"description": "笔记的唯一标识符（文件名，不含扩展名）",
					},
				},
				"required": []string{"note_id"},
			},
		},
		{
			Name:        "read_lines",
			Description: "精确读取笔记的指定行范围。这是进行精细操作的基础工具，可以准确获取需要修改的内容。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"note_id": map[string]interface{}{
						"type":        "string",
						"description": "笔记的唯一标识符（文件名，不含扩展名）",
					},
					"start_line": map[string]interface{}{
						"type":        "integer",
						"description": "起始行号（从1开始）",
					},
					"end_line": map[string]interface{}{
						"type":        "integer",
						"description": "结束行号（包含该行）",
					},
				},
				"required": []string{"note_id", "start_line", "end_line"},
			},
		},
		{
			Name:        "update_note",
			Description: "【高风险操作】完全覆写整篇笔记的内容。建议优先使用 replace_lines 进行精细修改。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"note_id": map[string]interface{}{
						"type":        "string",
						"description": "笔记的唯一标识符",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "新的笔记内容（Markdown格式）",
					},
				},
				"required": []string{"note_id", "content"},
			},
		},
		{
			Name:        "replace_lines",
			Description: "【核心工具】替换笔记中指定行范围的内容。这是最常用的精细修改工具，会自动计算并返回diff。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"note_id": map[string]interface{}{
						"type":        "string",
						"description": "笔记的唯一标识符",
					},
					"start_line": map[string]interface{}{
						"type":        "integer",
						"description": "起始行号（从1开始）",
					},
					"end_line": map[string]interface{}{
						"type":        "integer",
						"description": "结束行号（包含该行）",
					},
					"new_content": map[string]interface{}{
						"type":        "string",
						"description": "替换后的新内容",
					},
				},
				"required": []string{"note_id", "start_line", "end_line", "new_content"},
			},
		},
		{
			Name:        "insert_lines",
			Description: "在笔记的指定行之后插入新内容。会自动计算并返回diff。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"note_id": map[string]interface{}{
						"type":        "string",
						"description": "笔记的唯一标识符",
					},
					"after_line": map[string]interface{}{
						"type":        "integer",
						"description": "在此行号之后插入（0表示在文件开头插入）",
					},
					"content_to_insert": map[string]interface{}{
						"type":        "string",
						"description": "要插入的内容",
					},
				},
				"required": []string{"note_id", "after_line", "content_to_insert"},
			},
		},
		{
			Name:        "delete_lines",
			Description: "删除笔记中指定行范围的内容。会自动计算并返回diff。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"note_id": map[string]interface{}{
						"type":        "string",
						"description": "笔记的唯一标识符",
					},
					"start_line": map[string]interface{}{
						"type":        "integer",
						"description": "起始行号（从1开始）",
					},
					"end_line": map[string]interface{}{
						"type":        "integer",
						"description": "结束行号（包含该行）",
					},
				},
				"required": []string{"note_id", "start_line", "end_line"},
			},
		},
		{
			Name:        "create_note",
			Description: "创建一篇新的笔记。需要提供标题和内容。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"title": map[string]interface{}{
						"type":        "string",
						"description": "笔记标题",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "笔记内容（Markdown格式）",
					},
				},
				"required": []string{"title", "content"},
			},
		},
		{
			Name:        "list_notes",
			Description: "列出知识库中的所有笔记，返回笔记的基本信息（ID、标题、创建时间等）。",
			Parameters: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "create_todo_list",
			Description: "【规划工具】创建任务计划列表。在处理复杂任务时，先列出行动计划，让用户看到你的思路。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"note_id": map[string]interface{}{
						"type":        "string",
						"description": "任务关联的笔记ID（可选）",
					},
					"todo_list": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string",
						},
						"description": "任务列表，每项一个字符串",
					},
				},
				"required": []string{"todo_list"},
			},
		},
		{
			Name:        "update_todo_list",
			Description: "【规划工具】更新任务列表的状态。标记已完成的任务，添加新发现的任务。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"todo_list": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "object",
							"properties": map[string]interface{}{
								"task": map[string]interface{}{
									"type": "string",
								},
								"status": map[string]interface{}{
									"type": "string",
									"enum": []string{"pending", "in_progress", "completed"},
								},
							},
						},
						"description": "任务列表，包含任务内容和状态",
					},
				},
				"required": []string{"todo_list"},
			},
		},
	}
}

// ExecuteKnowledgeTool 执行知识库工具
func ExecuteKnowledgeTool(toolName string, args map[string]interface{}, knowledgeBasePath string) (string, error) {
	switch toolName {
	case "search_notes":
		return searchNotes(args, knowledgeBasePath)
	case "read_note":
		return readNote(args, knowledgeBasePath)
	case "read_lines":
		return readLines(args, knowledgeBasePath)
	case "update_note":
		return updateNote(args, knowledgeBasePath)
	case "replace_lines":
		return replaceLines(args, knowledgeBasePath)
	case "insert_lines":
		return insertLines(args, knowledgeBasePath)
	case "delete_lines":
		return deleteLines(args, knowledgeBasePath)
	case "create_note":
		return createNote(args, knowledgeBasePath)
	case "list_notes":
		return listNotes(knowledgeBasePath)
	case "create_todo_list":
		return createTodoList(args)
	case "update_todo_list":
		return updateTodoList(args)
	default:
		return "", fmt.Errorf("未知的知识库工具: %s", toolName)
	}
}

// searchNotes 在知识库中搜索笔记
func searchNotes(args map[string]interface{}, basePath string) (string, error) {
	query, ok := args["query"].(string)
	if !ok || query == "" {
		return "", fmt.Errorf("缺少必需参数: query")
	}

	query = strings.ToLower(query)
	var results []map[string]interface{}

	// 检查是否是标签搜索 (tag:xxx 格式)
	isTagSearch := false
	tagQuery := ""
	if strings.HasPrefix(query, "tag:") {
		isTagSearch = true
		tagQuery = strings.TrimPrefix(query, "tag:")
		tagQuery = strings.TrimSpace(tagQuery)
	}

	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// 支持多种文件格式
		if !info.IsDir() && isSupportedFileType(info.Name()) {
			content, err := os.ReadFile(path)
			if err != nil {
				return nil // 跳过无法读取的文件
			}

			contentStr := string(content)
			// 只对Markdown文件解析Front Matter
			var metadata map[string]interface{}
			var plainContent string
			var tags []string
			if strings.HasSuffix(strings.ToLower(info.Name()), ".md") {
				metadata, plainContent, tags = parseFrontMatter(contentStr)
			} else {
				plainContent = contentStr
			}

			matched := false

			// 标签搜索模式
			if isTagSearch {
				for _, tag := range tags {
					if strings.Contains(strings.ToLower(tag), tagQuery) {
						matched = true
						break
					}
				}
			} else {
				// 全文搜索：搜索内容、标题和标签
				if strings.Contains(strings.ToLower(contentStr), query) {
					matched = true
				} else if title, ok := metadata["title"].(string); ok {
					if strings.Contains(strings.ToLower(title), query) {
						matched = true
					}
				} else {
					// 搜索标签
					for _, tag := range tags {
						if strings.Contains(strings.ToLower(tag), query) {
							matched = true
							break
						}
					}
				}
			}

			if matched {
				// 提取匹配片段
				lines := strings.Split(plainContent, "\n")
				var snippets []string
				for _, line := range lines {
					if strings.Contains(strings.ToLower(line), query) {
						snippets = append(snippets, strings.TrimSpace(line))
						if len(snippets) >= 3 {
							break
						}
					}
				}

				noteID := strings.TrimSuffix(info.Name(), ".md")

				// 优先使用元数据中的标题
				title := ""
				if metaTitle, ok := metadata["title"].(string); ok && metaTitle != "" {
					title = metaTitle
				} else {
					title = extractTitle(contentStr)
				}

				result := map[string]interface{}{
					"id":       noteID,
					"title":    title,
					"path":     path,
					"snippets": snippets,
				}

				if len(tags) > 0 {
					result["tags"] = tags
				}

				results = append(results, result)
			}
		}
		return nil
	})

	if err != nil {
		return "", fmt.Errorf("搜索失败: %v", err)
	}

	if len(results) == 0 {
		return "未找到匹配的笔记", nil
	}

	resultJSON, _ := json.MarshalIndent(results, "", "  ")
	return fmt.Sprintf("找到 %d 篇匹配的笔记:\n%s", len(results), string(resultJSON)), nil
}

// readNote 读取笔记内容（支持路径）
func readNote(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	// 检查文件扩展名
	ext := strings.ToLower(filepath.Ext(noteID))

	// 如果没有扩展名，默认添加 .md
	if ext == "" {
		noteID += ".md"
		ext = ".md"
	}

	// 安全路径检查
	notePath, err := sanitizePath(basePath, noteID)
	if err != nil {
		return "", err
	}

	content, err := os.ReadFile(notePath)
	if err != nil {
		return "", fmt.Errorf("读取笔记失败: %v", err)
	}

	contentStr := string(content)

	// 只对 Markdown 文件解析 Front Matter
	var metadata map[string]interface{}
	var plainContent string
	var tags []string

	if ext == ".md" {
		metadata, plainContent, tags = parseFrontMatter(contentStr)
	} else {
		// 其他文件类型直接返回原始内容
		plainContent = contentStr
	}

	// 返回结构化的JSON数据
	result := map[string]interface{}{
		"id":      noteID,
		"content": plainContent,
	}

	if len(metadata) > 0 {
		result["metadata"] = metadata
	}

	if len(tags) > 0 {
		result["tags"] = tags
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}

// updateNote 更新笔记内容（支持路径）
func updateNote(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	content, ok := args["content"].(string)
	if !ok {
		return "", fmt.Errorf("缺少必需参数: content")
	}

	// 支持路径：如果不包含.md扩展名，则添加
	if !strings.HasSuffix(noteID, ".md") {
		noteID += ".md"
	}

	// 安全路径检查
	notePath, err := sanitizePath(basePath, noteID)
	if err != nil {
		return "", err
	}

	// 读取原文件内容（用于计算diff）
	var originalContent string
	var originalPlainContent string
	if existingContent, err := os.ReadFile(notePath); err == nil {
		originalContent = string(existingContent)
		// 提取纯文本内容（去除Front Matter）
		_, plainContent, _ := parseFrontMatter(originalContent)
		originalPlainContent = plainContent
	} else {
		// 文件不存在，视为空内容
		originalContent = ""
		originalPlainContent = ""
	}

	// 读取原文件以保留元数据
	var finalContent string
	if originalContent != "" {
		existingStr := originalContent

		// 检查是否有YAML Front Matter
		if strings.HasPrefix(existingStr, "---\n") {
			// 提取原有的Front Matter
			parts := strings.SplitN(existingStr, "---\n", 3)
			if len(parts) >= 3 {
				frontMatter := parts[1]

				// 更新updated_at时间戳
				now := time.Now().Format(time.RFC3339)
				lines := strings.Split(frontMatter, "\n")
				updatedLines := []string{}
				hasUpdatedAt := false

				for _, line := range lines {
					if strings.HasPrefix(line, "updated_at:") {
						updatedLines = append(updatedLines, fmt.Sprintf("updated_at: %s", now))
						hasUpdatedAt = true
					} else {
						updatedLines = append(updatedLines, line)
					}
				}

				// 如果没有updated_at字段，添加它
				if !hasUpdatedAt {
					updatedLines = append(updatedLines, fmt.Sprintf("updated_at: %s", now))
				}

				// 重建完整内容：Front Matter + 新内容
				finalContent = fmt.Sprintf("---\n%s\n---\n%s", strings.Join(updatedLines, "\n"), content)
			} else {
				// Front Matter格式不正确，直接使用新内容
				finalContent = content
			}
		} else {
			// 没有Front Matter，直接使用新内容
			finalContent = content
		}
	} else {
		// 文件不存在，直接使用新内容
		finalContent = content
	}

	// 确保目录存在
	noteDir := filepath.Dir(notePath)
	if err := os.MkdirAll(noteDir, 0755); err != nil {
		return "", fmt.Errorf("创建目录失败: %v", err)
	}

	err = os.WriteFile(notePath, []byte(finalContent), 0644)
	if err != nil {
		return "", fmt.Errorf("更新笔记失败: %v", err)
	}

	// 计算diff（基于纯文本内容，不包含Front Matter）
	diffData := computeDiff(originalPlainContent, content)

	// 构造返回结果
	result := DiffResult{
		Success:         true,
		NoteID:          strings.TrimSuffix(noteID, ".md"),
		Message:         fmt.Sprintf("笔记 '%s' 已成功更新", strings.TrimSuffix(noteID, ".md")),
		DiffData:        diffData,
		OriginalContent: originalPlainContent,
		NewContent:      content,
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("序列化结果失败: %v", err)
	}

	return string(resultJSON), nil
}

// createNote 创建新笔记（支持路径，自动创建目录）
func createNote(args map[string]interface{}, basePath string) (string, error) {
	title, ok := args["title"].(string)
	if !ok || title == "" {
		return "", fmt.Errorf("缺少必需参数: title")
	}

	content, ok := args["content"].(string)
	if !ok {
		return "", fmt.Errorf("缺少必需参数: content")
	}

	// 支持路径，例如 "folder/note-title"
	// 生成文件名（基于标题）
	noteID := sanitizeFileName(title)

	// 如果不包含.md扩展名，则添加
	if !strings.HasSuffix(noteID, ".md") {
		noteID += ".md"
	}

	// 安全路径检查
	notePath, err := sanitizePath(basePath, noteID)
	if err != nil {
		return "", err
	}

	// 检查是否已存在
	if _, err := os.Stat(notePath); err == nil {
		return "", fmt.Errorf("笔记 '%s' 已存在", strings.TrimSuffix(noteID, ".md"))
	}

	// 确保父目录存在
	parentDir := filepath.Dir(notePath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return "", fmt.Errorf("创建目录失败: %v", err)
	}

	// 创建笔记，添加标题作为第一行
	fullContent := fmt.Sprintf("# %s\n\n%s", title, content)
	err = os.WriteFile(notePath, []byte(fullContent), 0644)
	if err != nil {
		return "", fmt.Errorf("创建笔记失败: %v", err)
	}

	// 计算diff（与空内容对比）
	diffData := computeDiff("", fullContent)

	// 构造返回结果
	result := DiffResult{
		Success:         true,
		NoteID:          strings.TrimSuffix(noteID, ".md"),
		Message:         fmt.Sprintf("笔记 '%s' 已成功创建，ID: %s", title, strings.TrimSuffix(noteID, ".md")),
		DiffData:        diffData,
		OriginalContent: "",
		NewContent:      fullContent,
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("序列化结果失败: %v", err)
	}

	return string(resultJSON), nil
}

// listNotes 列出所有笔记（返回树状结构）
func listNotes(basePath string) (string, error) {
	// 构建文件树
	tree, err := buildFileTree(basePath, "")
	if err != nil {
		return "", fmt.Errorf("构建文件树失败: %v", err)
	}

	// 如果是根目录节点，返回其子节点
	var nodes []*FileNode
	if tree.Type == "folder" && tree.Children != nil {
		nodes = tree.Children
	} else {
		nodes = []*FileNode{tree}
	}

	if len(nodes) == 0 {
		return "知识库中暂无笔记", nil
	}

	resultJSON, err := json.MarshalIndent(nodes, "", "  ")
	if err != nil {
		return "", fmt.Errorf("序列化失败: %v", err)
	}

	// 计算文件总数
	totalFiles := countFiles(nodes)
	return fmt.Sprintf("知识库中共有 %d 个项目:\n%s", totalFiles, string(resultJSON)), nil
}

// countFiles 统计文件数量
func countFiles(nodes []*FileNode) int {
	count := 0
	for _, node := range nodes {
		if node.Type == "file" {
			count++
		} else if node.Type == "folder" && node.Children != nil {
			count += countFiles(node.Children)
		}
	}
	return count
}

// extractTitle 从内容中提取标题
func extractTitle(content string) string {
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			return strings.TrimPrefix(line, "# ")
		}
	}
	return "无标题"
}

// sanitizeFileName 清理文件名
func sanitizeFileName(title string) string {
	// 移除或替换不安全字符
	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"*", "-",
		"?", "-",
		"\"", "-",
		"<", "-",
		">", "-",
		"|", "-",
		" ", "_",
	)
	return replacer.Replace(title)
}

// parseFrontMatter 解析YAML Front Matter
func parseFrontMatter(content string) (map[string]interface{}, string, []string) {
	metadata := make(map[string]interface{})
	var tags []string
	plainContent := content

	// 检查是否有YAML Front Matter (以 --- 开头和结尾)
	yamlRegex := regexp.MustCompile(`^---\s*\n([\s\S]*?)\n---\s*\n`)
	matches := yamlRegex.FindStringSubmatch(content)

	if len(matches) > 1 {
		yamlContent := matches[1]
		plainContent = strings.TrimPrefix(content, matches[0])

		// 简单的YAML解析（仅支持常见字段）
		lines := strings.Split(yamlContent, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}

			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				value := strings.TrimSpace(parts[1])

				// 特殊处理tags字段（可能是数组）
				if key == "tags" {
					// 处理 [tag1, tag2] 或 - tag1 格式
					value = strings.Trim(value, "[]")
					tagParts := strings.Split(value, ",")
					for _, tag := range tagParts {
						tag = strings.TrimSpace(tag)
						tag = strings.Trim(tag, "\"'")
						if tag != "" {
							tags = append(tags, tag)
						}
					}
					metadata[key] = tags
				} else {
					// 移除引号
					value = strings.Trim(value, "\"'")
					metadata[key] = value
				}
			}
		}
	}

	// 同时在内容中查找 #标签 格式的标签
	// Go正则表达式使用 \x{4e00}-\x{9fa5} 表示中文范围
	tagRegex := regexp.MustCompile(`#([a-zA-Z0-9_\p{Han}]+)`)
	tagMatches := tagRegex.FindAllStringSubmatch(plainContent, -1)
	for _, match := range tagMatches {
		if len(match) > 1 {
			tag := match[1]
			// 避免重复
			found := false
			for _, existing := range tags {
				if existing == tag {
					found = true
					break
				}
			}
			if !found {
				tags = append(tags, tag)
			}
		}
	}

	return metadata, plainContent, tags
}

// isSupportedFileType 检查文件是否为支持的类型
func isSupportedFileType(filename string) bool {
	supportedExts := []string{".md", ".txt", ".pdf", ".log", ".json", ".yaml", ".yml", ".toml", ".xml", ".csv"}
	ext := strings.ToLower(filepath.Ext(filename))
	for _, supported := range supportedExts {
		if ext == supported {
			return true
		}
	}
	return false
}

// buildFileTree 构建文件树（递归遍历目录）
func buildFileTree(basePath string, currentPath string) (*FileNode, error) {
	fullPath := filepath.Join(basePath, currentPath)
	info, err := os.Stat(fullPath)
	if err != nil {
		return nil, err
	}

	// 相对路径（用于ID）
	relPath := strings.TrimPrefix(currentPath, string(filepath.Separator))

	node := &FileNode{
		Name: info.Name(),
		Path: relPath,
	}

	if info.IsDir() {
		node.Type = "folder"
		node.Children = []*FileNode{}

		// 读取目录内容
		entries, err := os.ReadDir(fullPath)
		if err != nil {
			return nil, err
		}

		for _, entry := range entries {
			// 跳过隐藏文件
			if strings.HasPrefix(entry.Name(), ".") {
				continue
			}

			childPath := filepath.Join(currentPath, entry.Name())
			childNode, err := buildFileTree(basePath, childPath)
			if err != nil {
				continue // 跳过错误
			}
			node.Children = append(node.Children, childNode)
		}
	} else if isSupportedFileType(info.Name()) {
		node.Type = "file"

		// 读取文件以提取元数据（容错处理）
		content, err := os.ReadFile(fullPath)
		if err == nil && len(content) > 0 {
			contentStr := string(content)

			// 安全地解析元数据，即使出错也不影响文件树构建
			// 只对Markdown文件解析Front Matter
			if strings.HasSuffix(strings.ToLower(info.Name()), ".md") {
				func() {
					defer func() {
						if r := recover(); r != nil {
							// 解析失败时静默处理
							return
						}
					}()

					metadata, _, tags := parseFrontMatter(contentStr)

					if len(metadata) > 0 {
						node.Metadata = metadata
					}
					if len(tags) > 0 {
						node.Tags = tags
					}
				}()
			}
		}
	} else {
		// 跳过不支持的文件
		return nil, fmt.Errorf("unsupported file type")
	}

	return node, nil
}

// DiffLine 表示差异的一行
type DiffLine struct {
	Type         string  `json:"type"`                   // "added", "removed", "unchanged", "modified"
	Content      string  `json:"content"`                // 行内容
	OldContent   *string `json:"oldContent,omitempty"`   // 修改前的内容（仅modified类型，使用指针确保空字符串也能序列化）
	LineNumber   int     `json:"lineNumber"`             // 行号
	OldLineNumber int    `json:"oldLineNumber,omitempty"` // 旧行号（仅modified类型）
}

// DiffResult 表示差异结果
type DiffResult struct {
	Success         bool       `json:"success"`
	NoteID          string     `json:"noteId"`
	Message         string     `json:"message"`
	DiffData        []DiffLine `json:"diffData,omitempty"`
	OriginalContent string     `json:"originalContent,omitempty"`
	NewContent      string     `json:"newContent,omitempty"`
}

// computeDiff 计算两个文本的差异（行级别，支持行内diff）
func computeDiff(original, new string) []DiffLine {
	originalLines := strings.Split(original, "\n")
	newLines := strings.Split(new, "\n")

	// 使用简单的逐行比较算法
	var result []DiffLine

	// 使用最长公共子序列(LCS)算法进行行级diff
	lcsMatrix := computeLCS(originalLines, newLines)

	// 回溯LCS矩阵生成diff
	i := len(originalLines)
	j := len(newLines)
	newLineNum := len(newLines)
	oldLineNum := len(originalLines)

	var tempResult []DiffLine

	for i > 0 || j > 0 {
		if i > 0 && j > 0 && originalLines[i-1] == newLines[j-1] {
			// 相同行
			tempResult = append([]DiffLine{{
				Type:       "unchanged",
				Content:    newLines[j-1],
				LineNumber: newLineNum,
			}}, tempResult...)
			i--
			j--
			newLineNum--
			oldLineNum--
		} else if j > 0 && (i == 0 || lcsMatrix[i][j-1] >= lcsMatrix[i-1][j]) {
			// 添加行
			tempResult = append([]DiffLine{{
				Type:       "added",
				Content:    newLines[j-1],
				LineNumber: newLineNum,
			}}, tempResult...)
			j--
			newLineNum--
		} else if i > 0 {
			// 删除行
			tempResult = append([]DiffLine{{
				Type:          "removed",
				Content:       originalLines[i-1],
				LineNumber:    0, // 会在后处理中重新计算
				OldLineNumber: oldLineNum,
			}}, tempResult...)
			i--
			oldLineNum--
		}
	}

	// 重新计算行号
	newLineNum = 1
	for idx := range tempResult {
		if tempResult[idx].Type != "removed" {
			tempResult[idx].LineNumber = newLineNum
			newLineNum++
		}
	}

	result = tempResult

	// 后处理：合并相邻的删除和添加为修改
	result = mergeModifications(result)

	return result
}

// computeLCS 计算最长公共子序列矩阵
func computeLCS(a, b []string) [][]int {
	m := len(a)
	n := len(b)
	lcs := make([][]int, m+1)
	for i := range lcs {
		lcs[i] = make([]int, n+1)
	}

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				lcs[i][j] = lcs[i-1][j-1] + 1
			} else {
				lcs[i][j] = max(lcs[i-1][j], lcs[i][j-1])
			}
		}
	}

	return lcs
}

// max 返回两个整数中的较大值
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// mergeModifications 将相邻的删除和添加行合并为修改行
func mergeModifications(diffs []DiffLine) []DiffLine {
	var result []DiffLine
	i := 0

	for i < len(diffs) {
		current := diffs[i]

		// 检查是否是删除行，且下一行是添加行
		if current.Type == "removed" && i+1 < len(diffs) && diffs[i+1].Type == "added" {
			// 合并为修改行
			oldContent := current.Content // 旧内容（可能是空字符串）
			result = append(result, DiffLine{
				Type:          "modified",
				Content:       diffs[i+1].Content,  // 新内容
				OldContent:    &oldContent,         // 旧内容（使用指针，即使是空字符串也会被序列化）
				LineNumber:    diffs[i+1].LineNumber,
				OldLineNumber: current.OldLineNumber,
			})
			i += 2 // 跳过两行
		} else {
			result = append(result, current)
			i++
		}
	}

	return result
}

// sanitizePath 清理路径，防止路径遍历攻击
func sanitizePath(basePath string, userPath string) (string, error) {
	// 移除路径中的 ".." 等危险部分
	cleanPath := filepath.Clean(userPath)

	// 确保不以 / 开头
	cleanPath = strings.TrimPrefix(cleanPath, "/")
	cleanPath = strings.TrimPrefix(cleanPath, "\\")

	// 拼接完整路径
	fullPath := filepath.Join(basePath, cleanPath)

	// 验证路径是否在 basePath 内
	absBasePath, err := filepath.Abs(basePath)
	if err != nil {
		return "", err
	}

	absFullPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	// 检查是否在允许的目录内
	if !strings.HasPrefix(absFullPath, absBasePath) {
		return "", fmt.Errorf("路径访问被拒绝: 路径在知识库目录之外")
	}

	return fullPath, nil
}

// DeleteNote 删除笔记或文件夹
func DeleteNote(path, itemType, basePath string) error {
	// 验证路径
	fullPath, err := sanitizePath(basePath, path)
	if err != nil {
		return fmt.Errorf("路径无效: %v", err)
	}

	// 检查路径是否存在
	info, err := os.Stat(fullPath)
	if err != nil {
		return fmt.Errorf("路径不存在: %v", err)
	}

	// 验证类型匹配
	if itemType == "folder" && !info.IsDir() {
		return fmt.Errorf("路径不是文件夹")
	}
	if itemType == "file" && info.IsDir() {
		return fmt.Errorf("路径不是文件")
	}

	// 执行删除
	if info.IsDir() {
		// 删除文件夹及其所有内容
		err = os.RemoveAll(fullPath)
	} else {
		// 删除文件
		err = os.Remove(fullPath)
	}

	if err != nil {
		return fmt.Errorf("删除失败: %v", err)
	}

	return nil
}

// MoveNote 移动笔记或文件夹到目标文件夹
func MoveNote(sourcePath, destFolderPath, basePath string) error {
	// 验证源路径
	fullSourcePath, err := sanitizePath(basePath, sourcePath)
	if err != nil {
		return fmt.Errorf("源路径无效: %v", err)
	}

	// 验证目标路径（空字符串表示根目录）
	var fullDestFolderPath string
	if destFolderPath == "" {
		// 移动到根目录
		fullDestFolderPath = basePath
	} else {
		fullDestFolderPath, err = sanitizePath(basePath, destFolderPath)
		if err != nil {
			return fmt.Errorf("目标路径无效: %v", err)
		}
	}

	// 检查源路径是否存在
	sourceInfo, err := os.Stat(fullSourcePath)
	if err != nil {
		return fmt.Errorf("源路径不存在: %v", err)
	}

	// 检查目标文件夹是否存在
	destInfo, err := os.Stat(fullDestFolderPath)
	if err != nil {
		return fmt.Errorf("目标文件夹不存在: %v", err)
	}

	// 确保目标是文件夹
	if !destInfo.IsDir() {
		return fmt.Errorf("目标必须是文件夹")
	}

	// 构造新的完整路径
	sourceName := filepath.Base(fullSourcePath)
	newFullPath := filepath.Join(fullDestFolderPath, sourceName)

	// 检查目标位置是否已存在同名文件
	if _, err := os.Stat(newFullPath); err == nil {
		return fmt.Errorf("目标位置已存在同名文件: %s", sourceName)
	}

	// 执行移动
	if sourceInfo.IsDir() {
		// 移动文件夹
		err = os.Rename(fullSourcePath, newFullPath)
	} else {
		// 移动文件
		err = os.Rename(fullSourcePath, newFullPath)
	}

	if err != nil {
		return fmt.Errorf("移动失败: %v", err)
	}

	return nil
}

// readLines 精确读取笔记的指定行范围
func readLines(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	startLine, ok := extractInt(args, "start_line")
	if !ok || startLine < 1 {
		return "", fmt.Errorf("缺少必需参数: start_line (必须 >= 1)")
	}

	endLine, ok := extractInt(args, "end_line")
	if !ok || endLine < startLine {
		return "", fmt.Errorf("缺少必需参数: end_line (必须 >= start_line)")
	}

	// 添加 .md 扩展名
	if !strings.HasSuffix(noteID, ".md") {
		noteID += ".md"
	}

	// 安全路径检查
	notePath, err := sanitizePath(basePath, noteID)
	if err != nil {
		return "", err
	}

	// 读取文件
	content, err := os.ReadFile(notePath)
	if err != nil {
		return "", fmt.Errorf("读取笔记失败: %v", err)
	}

	// 解析并跳过 Front Matter
	_, plainContent, _ := parseFrontMatter(string(content))
	lines := strings.Split(plainContent, "\n")

	// 验证行号范围
	if startLine > len(lines) {
		return "", fmt.Errorf("start_line (%d) 超出文件范围（总共 %d 行）", startLine, len(lines))
	}

	// 调整 endLine 以不超过文件范围
	if endLine > len(lines) {
		endLine = len(lines)
	}

	// 提取指定范围的行
	selectedLines := lines[startLine-1 : endLine]

	// 构建返回结果
	result := map[string]interface{}{
		"note_id":    strings.TrimSuffix(noteID, ".md"),
		"start_line": startLine,
		"end_line":   endLine,
		"lines":      []map[string]interface{}{},
	}

	linesData := []map[string]interface{}{}
	for i, line := range selectedLines {
		linesData = append(linesData, map[string]interface{}{
			"line":    startLine + i,
			"content": line,
		})
	}
	result["lines"] = linesData

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}

// extractInt 从参数中提取整数
func extractInt(args map[string]interface{}, key string) (int, bool) {
	if val, ok := args[key].(float64); ok {
		return int(val), true
	}
	if val, ok := args[key].(int); ok {
		return val, true
	}
	return 0, false
}

// replaceLines 替换指定行范围的内容
func replaceLines(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	startLine, ok := extractInt(args, "start_line")
	if !ok || startLine < 1 {
		return "", fmt.Errorf("缺少必需参数: start_line (必须 >= 1)")
	}

	endLine, ok := extractInt(args, "end_line")
	if !ok || endLine < startLine {
		return "", fmt.Errorf("缺少必需参数: end_line (必须 >= start_line)")
	}

	newContent, ok := args["new_content"].(string)
	if !ok {
		return "", fmt.Errorf("缺少必需参数: new_content")
	}

	// 添加 .md 扩展名
	if !strings.HasSuffix(noteID, ".md") {
		noteID += ".md"
	}

	// 安全路径检查
	notePath, err := sanitizePath(basePath, noteID)
	if err != nil {
		return "", err
	}

	// 读取原文件
	originalFileContent, err := os.ReadFile(notePath)
	if err != nil {
		return "", fmt.Errorf("读取笔记失败: %v", err)
	}

	originalStr := string(originalFileContent)
	metadata, plainContent, _ := parseFrontMatter(originalStr)

	// 分割内容为行
	lines := strings.Split(plainContent, "\n")

	// 验证行号范围
	if startLine > len(lines) {
		return "", fmt.Errorf("start_line (%d) 超出文件范围（总共 %d 行）", startLine, len(lines))
	}
	if endLine > len(lines) {
		endLine = len(lines)
	}

	// 保存原始内容（用于计算diff）
	originalPlainContent := plainContent

	// 执行替换
	newLines := strings.Split(newContent, "\n")
	resultLines := append(lines[:startLine-1], newLines...)
	if endLine < len(lines) {
		resultLines = append(resultLines, lines[endLine:]...)
	}

	newPlainContent := strings.Join(resultLines, "\n")

	// 重建完整内容（包含Front Matter）
	finalContent := rebuildContentWithFrontMatter(originalStr, metadata, newPlainContent)

	// 写回文件
	err = os.WriteFile(notePath, []byte(finalContent), 0644)
	if err != nil {
		return "", fmt.Errorf("写入笔记失败: %v", err)
	}

	// 计算diff
	diffData := computeDiff(originalPlainContent, newPlainContent)

	// 构造返回结果
	result := DiffResult{
		Success:         true,
		NoteID:          strings.TrimSuffix(noteID, ".md"),
		Message:         fmt.Sprintf("已成功替换笔记 '%s' 的第 %d-%d 行", strings.TrimSuffix(noteID, ".md"), startLine, endLine),
		DiffData:        diffData,
		OriginalContent: originalPlainContent,
		NewContent:      newPlainContent,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// insertLines 在指定行之后插入新内容
func insertLines(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	afterLine, ok := extractInt(args, "after_line")
	if !ok || afterLine < 0 {
		return "", fmt.Errorf("缺少必需参数: after_line (必须 >= 0，0表示在文件开头插入)")
	}

	contentToInsert, ok := args["content_to_insert"].(string)
	if !ok {
		return "", fmt.Errorf("缺少必需参数: content_to_insert")
	}

	// 添加 .md 扩展名
	if !strings.HasSuffix(noteID, ".md") {
		noteID += ".md"
	}

	// 安全路径检查
	notePath, err := sanitizePath(basePath, noteID)
	if err != nil {
		return "", err
	}

	// 读取原文件
	originalFileContent, err := os.ReadFile(notePath)
	if err != nil {
		return "", fmt.Errorf("读取笔记失败: %v", err)
	}

	originalStr := string(originalFileContent)
	metadata, plainContent, _ := parseFrontMatter(originalStr)

	// 分割内容为行
	lines := strings.Split(plainContent, "\n")

	// 验证行号
	if afterLine > len(lines) {
		return "", fmt.Errorf("after_line (%d) 超出文件范围（总共 %d 行）", afterLine, len(lines))
	}

	// 保存原始内容
	originalPlainContent := plainContent

	// 执行插入
	insertLines := strings.Split(contentToInsert, "\n")
	var resultLines []string
	if afterLine == 0 {
		// 在文件开头插入
		resultLines = append(insertLines, lines...)
	} else {
		// 在指定行之后插入
		resultLines = append(lines[:afterLine], insertLines...)
		resultLines = append(resultLines, lines[afterLine:]...)
	}

	newPlainContent := strings.Join(resultLines, "\n")

	// 重建完整内容
	finalContent := rebuildContentWithFrontMatter(originalStr, metadata, newPlainContent)

	// 写回文件
	err = os.WriteFile(notePath, []byte(finalContent), 0644)
	if err != nil {
		return "", fmt.Errorf("写入笔记失败: %v", err)
	}

	// 计算diff
	diffData := computeDiff(originalPlainContent, newPlainContent)

	// 构造返回结果
	result := DiffResult{
		Success:         true,
		NoteID:          strings.TrimSuffix(noteID, ".md"),
		Message:         fmt.Sprintf("已成功在笔记 '%s' 的第 %d 行之后插入内容", strings.TrimSuffix(noteID, ".md"), afterLine),
		DiffData:        diffData,
		OriginalContent: originalPlainContent,
		NewContent:      newPlainContent,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// deleteLines 删除指定行范围的内容
func deleteLines(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	startLine, ok := extractInt(args, "start_line")
	if !ok || startLine < 1 {
		return "", fmt.Errorf("缺少必需参数: start_line (必须 >= 1)")
	}

	endLine, ok := extractInt(args, "end_line")
	if !ok || endLine < startLine {
		return "", fmt.Errorf("缺少必需参数: end_line (必须 >= start_line)")
	}

	// 添加 .md 扩展名
	if !strings.HasSuffix(noteID, ".md") {
		noteID += ".md"
	}

	// 安全路径检查
	notePath, err := sanitizePath(basePath, noteID)
	if err != nil {
		return "", err
	}

	// 读取原文件
	originalFileContent, err := os.ReadFile(notePath)
	if err != nil {
		return "", fmt.Errorf("读取笔记失败: %v", err)
	}

	originalStr := string(originalFileContent)
	metadata, plainContent, _ := parseFrontMatter(originalStr)

	// 分割内容为行
	lines := strings.Split(plainContent, "\n")

	// 验证行号范围
	if startLine > len(lines) {
		return "", fmt.Errorf("start_line (%d) 超出文件范围（总共 %d 行）", startLine, len(lines))
	}
	if endLine > len(lines) {
		endLine = len(lines)
	}

	// 保存原始内容
	originalPlainContent := plainContent

	// 执行删除
	var resultLines []string
	if startLine > 1 {
		resultLines = append(resultLines, lines[:startLine-1]...)
	}
	if endLine < len(lines) {
		resultLines = append(resultLines, lines[endLine:]...)
	}

	newPlainContent := strings.Join(resultLines, "\n")

	// 重建完整内容
	finalContent := rebuildContentWithFrontMatter(originalStr, metadata, newPlainContent)

	// 写回文件
	err = os.WriteFile(notePath, []byte(finalContent), 0644)
	if err != nil {
		return "", fmt.Errorf("写入笔记失败: %v", err)
	}

	// 计算diff
	diffData := computeDiff(originalPlainContent, newPlainContent)

	// 构造返回结果
	result := DiffResult{
		Success:         true,
		NoteID:          strings.TrimSuffix(noteID, ".md"),
		Message:         fmt.Sprintf("已成功删除笔记 '%s' 的第 %d-%d 行", strings.TrimSuffix(noteID, ".md"), startLine, endLine),
		DiffData:        diffData,
		OriginalContent: originalPlainContent,
		NewContent:      newPlainContent,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// rebuildContentWithFrontMatter 重建包含Front Matter的完整内容
func rebuildContentWithFrontMatter(originalContent string, metadata map[string]interface{}, newPlainContent string) string {
	// 检查是否有YAML Front Matter
	if strings.HasPrefix(originalContent, "---\n") {
		parts := strings.SplitN(originalContent, "---\n", 3)
		if len(parts) >= 3 {
			frontMatter := parts[1]

			// 更新 updated_at 时间戳
			now := time.Now().Format(time.RFC3339)
			lines := strings.Split(frontMatter, "\n")
			updatedLines := []string{}
			hasUpdatedAt := false

			for _, line := range lines {
				if strings.HasPrefix(line, "updated_at:") {
					updatedLines = append(updatedLines, fmt.Sprintf("updated_at: %s", now))
					hasUpdatedAt = true
				} else {
					updatedLines = append(updatedLines, line)
				}
			}

			// 如果没有updated_at字段，添加它
			if !hasUpdatedAt {
				updatedLines = append(updatedLines, fmt.Sprintf("updated_at: %s", now))
			}

			return fmt.Sprintf("---\n%s\n---\n%s", strings.Join(updatedLines, "\n"), newPlainContent)
		}
	}

	// 没有Front Matter，直接返回新内容
	return newPlainContent
}

// createTodoList 创建任务列表（状态管理工具）
func createTodoList(args map[string]interface{}) (string, error) {
	todoList, ok := args["todo_list"].([]interface{})
	if !ok {
		return "", fmt.Errorf("缺少必需参数: todo_list")
	}

	noteID := ""
	if nid, ok := args["note_id"].(string); ok {
		noteID = nid
	}

	// 构建返回结果
	tasks := []map[string]interface{}{}
	for i, item := range todoList {
		if task, ok := item.(string); ok {
			tasks = append(tasks, map[string]interface{}{
				"index":  i + 1,
				"task":   task,
				"status": "pending",
			})
		}
	}

	result := map[string]interface{}{
		"success":   true,
		"note_id":   noteID,
		"todo_list": tasks,
		"message":   fmt.Sprintf("已创建包含 %d 个任务的计划列表", len(tasks)),
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}

// AppendToFollowupNote PDF划词追问，追加到同名md文件
func AppendToFollowupNote(selectedText, question, answer, pdfFileName, basePath string) error {
	// 生成对应的Markdown文件路径
	mdFileName := pdfFileName + ".md"
	mdPath, err := sanitizePath(basePath, mdFileName)
	if err != nil {
		return fmt.Errorf("路径无效: %v", err)
	}

	// 检查md文件是否存在
	var existingContent string
	if content, err := os.ReadFile(mdPath); err == nil {
		existingContent = string(content)
	} else {
		// 文件不存在，创建初始内容
		pdfBaseName := filepath.Base(pdfFileName)
		existingContent = fmt.Sprintf("# %s 笔记\n\n此文件记录了对 `%s.pdf` 的阅读笔记和追问。\n\n---\n\n", pdfBaseName, pdfBaseName)
	}

	// 构造追加内容
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	appendContent := fmt.Sprintf("\n## 追问 - %s\n\n> %s\n\n**Q:** %s\n\n**A:** %s\n\n---\n\n",
		timestamp,
		selectedText,
		question,
		answer)

	// 追加到文件
	newContent := existingContent + appendContent

	// 确保目录存在
	mdDir := filepath.Dir(mdPath)
	if err := os.MkdirAll(mdDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}

	// 写入文件
	err = os.WriteFile(mdPath, []byte(newContent), 0644)
	if err != nil {
		return fmt.Errorf("写入文件失败: %v", err)
	}

	return nil
}

// updateTodoList 更新任务列表状态
func updateTodoList(args map[string]interface{}) (string, error) {
	todoList, ok := args["todo_list"].([]interface{})
	if !ok {
		return "", fmt.Errorf("缺少必需参数: todo_list")
	}

	// 解析任务列表
	tasks := []map[string]interface{}{}
	for i, item := range todoList {
		if taskMap, ok := item.(map[string]interface{}); ok {
			task := ""
			status := "pending"

			if t, ok := taskMap["task"].(string); ok {
				task = t
			}
			if s, ok := taskMap["status"].(string); ok {
				status = s
			}

			tasks = append(tasks, map[string]interface{}{
				"index":  i + 1,
				"task":   task,
				"status": status,
			})
		}
	}

	// 统计状态
	completed := 0
	inProgress := 0
	pending := 0
	for _, task := range tasks {
		switch task["status"] {
		case "completed":
			completed++
		case "in_progress":
			inProgress++
		case "pending":
			pending++
		}
	}

	result := map[string]interface{}{
		"success":     true,
		"todo_list":   tasks,
		"stats": map[string]interface{}{
			"total":       len(tasks),
			"completed":   completed,
			"in_progress": inProgress,
			"pending":     pending,
		},
		"message": fmt.Sprintf("任务列表已更新：%d 已完成, %d 进行中, %d 待处理", completed, inProgress, pending),
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}
