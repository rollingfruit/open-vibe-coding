package tools

import (
	"fmt"
	"runtime"
	"strings"
)

// ToolDefinition 定义一个工具
type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// GetAvailableTools 返回所有可用的工具定义
func GetAvailableTools() []ToolDefinition {
	return []ToolDefinition{
		{
			Name:        "path_switch",
			Description: "切换当前工作目录",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "目标目录路径（可以是相对路径或绝对路径）",
					},
				},
				"required": []string{"path"},
			},
		},
		{
			Name:        "read_file",
			Description: "读取文件内容",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "文件路径",
					},
				},
				"required": []string{"path"},
			},
		},
		{
			Name:        "write_file",
			Description: "写入内容到文件（相对于当前工作目录）",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "文件路径（相对于当前工作目录，如：hello.py）",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "要写入的内容",
					},
				},
				"required": []string{"path", "content"},
			},
		},
		{
			Name:        "grep",
			Description: "在文件中搜索匹配的文本",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"pattern": map[string]interface{}{
						"type":        "string",
						"description": "要搜索的模式",
					},
					"path": map[string]interface{}{
						"type":        "string",
						"description": "文件或目录路径",
					},
				},
				"required": []string{"pattern", "path"},
			},
		},
		{
			Name:        "list_files",
			Description: "列出目录中的文件和子目录",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "目录路径（可选，默认为当前目录）",
					},
				},
			},
		},
	}
}

// ExecuteTool 执行工具调用，返回对应的shell命令
func ExecuteTool(toolName string, args map[string]interface{}) (string, error) {
	switch toolName {
	case "path_switch":
		return executePathSwitch(args)
	case "read_file":
		return executeReadFile(args)
	case "write_file":
		return executeWriteFile(args)
	case "grep":
		return executeGrep(args)
	case "list_files":
		return executeListFiles(args)
	default:
		return "", fmt.Errorf("unknown tool: %s", toolName)
	}
}

func executePathSwitch(args map[string]interface{}) (string, error) {
	path, ok := args["path"].(string)
	if !ok {
		return "", fmt.Errorf("missing or invalid 'path' parameter")
	}

	// 转义特殊字符
	path = strings.ReplaceAll(path, "\"", "\\\"")
	return fmt.Sprintf("cd \"%s\"", path), nil
}

func executeReadFile(args map[string]interface{}) (string, error) {
	// 兼容多种路径参数名：path, file_path, filename
	path, ok := args["path"].(string)
	if !ok {
		path, ok = args["file_path"].(string)
		if !ok {
			path, ok = args["filename"].(string)
			if !ok {
				return "", fmt.Errorf("missing or invalid path parameter (tried: 'path', 'file_path', 'filename')")
			}
		}
	}

	// 转义特殊字符
	path = strings.ReplaceAll(path, "\"", "\\\"")

	if runtime.GOOS == "windows" {
		return fmt.Sprintf("type \"%s\"", path), nil
	}
	return fmt.Sprintf("cat \"%s\"", path), nil
}

func executeWriteFile(args map[string]interface{}) (string, error) {
	// 兼容多种路径参数名：path, file_path, filename
	path, ok := args["path"].(string)
	if !ok {
		path, ok = args["file_path"].(string)
		if !ok {
			path, ok = args["filename"].(string)
			if !ok {
				return "", fmt.Errorf("missing or invalid path parameter (tried: 'path', 'file_path', 'filename')")
			}
		}
	}

	content, ok := args["content"].(string)
	if !ok {
		return "", fmt.Errorf("missing or invalid 'content' parameter")
	}

	// 转义特殊字符
	path = strings.ReplaceAll(path, "\"", "\\\"")
	content = strings.ReplaceAll(content, "\"", "\\\"")
	content = strings.ReplaceAll(content, "\n", "\\n")

	if runtime.GOOS == "windows" {
		// Windows 使用 echo 写入文件
		return fmt.Sprintf("echo %s > \"%s\"", content, path), nil
	}
	// Unix 系统使用 echo 写入文件
	return fmt.Sprintf("echo \"%s\" > \"%s\"", content, path), nil
}

func executeGrep(args map[string]interface{}) (string, error) {
	pattern, ok := args["pattern"].(string)
	if !ok {
		return "", fmt.Errorf("missing or invalid 'pattern' parameter")
	}

	// 兼容多种路径参数名：path, file_path, filename
	path, ok := args["path"].(string)
	if !ok {
		path, ok = args["file_path"].(string)
		if !ok {
			path, ok = args["filename"].(string)
			if !ok {
				return "", fmt.Errorf("missing or invalid path parameter (tried: 'path', 'file_path', 'filename')")
			}
		}
	}

	// 转义特殊字符
	pattern = strings.ReplaceAll(pattern, "\"", "\\\"")
	path = strings.ReplaceAll(path, "\"", "\\\"")

	if runtime.GOOS == "windows" {
		return fmt.Sprintf("findstr /s /i \"%s\" \"%s\"", pattern, path), nil
	}
	return fmt.Sprintf("grep -r \"%s\" \"%s\"", pattern, path), nil
}

func executeListFiles(args map[string]interface{}) (string, error) {
	path := "."
	if p, ok := args["path"].(string); ok && p != "" {
		path = p
	}

	// 转义特殊字符
	path = strings.ReplaceAll(path, "\"", "\\\"")

	if runtime.GOOS == "windows" {
		return fmt.Sprintf("dir \"%s\"", path), nil
	}
	return fmt.Sprintf("ls -la \"%s\"", path), nil
}