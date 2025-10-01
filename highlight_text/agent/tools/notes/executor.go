package notes

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Note 表示一篇笔记
type Note struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Path      string    `json:"path"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
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
			Description: "读取指定笔记的完整内容。通过笔记ID或标题获取笔记全文。",
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
			Name:        "update_note",
			Description: "更新或覆写整篇笔记的内容。可以修改已有笔记的全部内容。",
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
	}
}

// ExecuteKnowledgeTool 执行知识库工具
func ExecuteKnowledgeTool(toolName string, args map[string]interface{}, knowledgeBasePath string) (string, error) {
	switch toolName {
	case "search_notes":
		return searchNotes(args, knowledgeBasePath)
	case "read_note":
		return readNote(args, knowledgeBasePath)
	case "update_note":
		return updateNote(args, knowledgeBasePath)
	case "create_note":
		return createNote(args, knowledgeBasePath)
	case "list_notes":
		return listNotes(knowledgeBasePath)
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

	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".md") {
			content, err := os.ReadFile(path)
			if err != nil {
				return nil // 跳过无法读取的文件
			}

			contentStr := string(content)
			if strings.Contains(strings.ToLower(contentStr), query) {
				// 提取匹配片段
				lines := strings.Split(contentStr, "\n")
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
				title := extractTitle(contentStr)

				results = append(results, map[string]interface{}{
					"id":       noteID,
					"title":    title,
					"path":     path,
					"snippets": snippets,
				})
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

// readNote 读取笔记内容
func readNote(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	notePath := filepath.Join(basePath, noteID+".md")
	content, err := os.ReadFile(notePath)
	if err != nil {
		return "", fmt.Errorf("读取笔记失败: %v", err)
	}

	return string(content), nil
}

// updateNote 更新笔记内容
func updateNote(args map[string]interface{}, basePath string) (string, error) {
	noteID, ok := args["note_id"].(string)
	if !ok || noteID == "" {
		return "", fmt.Errorf("缺少必需参数: note_id")
	}

	content, ok := args["content"].(string)
	if !ok {
		return "", fmt.Errorf("缺少必需参数: content")
	}

	notePath := filepath.Join(basePath, noteID+".md")
	err := os.WriteFile(notePath, []byte(content), 0644)
	if err != nil {
		return "", fmt.Errorf("更新笔记失败: %v", err)
	}

	return fmt.Sprintf("笔记 '%s' 已成功更新", noteID), nil
}

// createNote 创建新笔记
func createNote(args map[string]interface{}, basePath string) (string, error) {
	title, ok := args["title"].(string)
	if !ok || title == "" {
		return "", fmt.Errorf("缺少必需参数: title")
	}

	content, ok := args["content"].(string)
	if !ok {
		return "", fmt.Errorf("缺少必需参数: content")
	}

	// 生成文件名（基于标题）
	noteID := sanitizeFileName(title)
	notePath := filepath.Join(basePath, noteID+".md")

	// 检查是否已存在
	if _, err := os.Stat(notePath); err == nil {
		return "", fmt.Errorf("笔记 '%s' 已存在", noteID)
	}

	// 创建笔记，添加标题作为第一行
	fullContent := fmt.Sprintf("# %s\n\n%s", title, content)
	err := os.WriteFile(notePath, []byte(fullContent), 0644)
	if err != nil {
		return "", fmt.Errorf("创建笔记失败: %v", err)
	}

	return fmt.Sprintf("笔记 '%s' 已成功创建，ID: %s", title, noteID), nil
}

// listNotes 列出所有笔记
func listNotes(basePath string) (string, error) {
	var notes []map[string]interface{}

	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".md") {
			noteID := strings.TrimSuffix(info.Name(), ".md")

			// 读取内容以提取标题
			content, err := os.ReadFile(path)
			if err == nil {
				title := extractTitle(string(content))
				notes = append(notes, map[string]interface{}{
					"id":         noteID,
					"title":      title,
					"created_at": info.ModTime(),
				})
			}
		}
		return nil
	})

	if err != nil {
		return "", fmt.Errorf("列出笔记失败: %v", err)
	}

	if len(notes) == 0 {
		return "知识库中暂无笔记", nil
	}

	resultJSON, _ := json.MarshalIndent(notes, "", "  ")
	return fmt.Sprintf("知识库中共有 %d 篇笔记:\n%s", len(notes), string(resultJSON)), nil
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
