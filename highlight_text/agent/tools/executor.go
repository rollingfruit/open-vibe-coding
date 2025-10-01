package tools

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strings"
)

// 最大Token数限制（用于防止上下文溢出）
const maxOutputTokens = 2000

// truncateByTokens 根据Token估算截断内容，防止上下文溢出
// 使用 4 characters ≈ 1 token 的经验估算
func truncateByTokens(content string, maxTokens int) string {
	if maxTokens <= 0 {
		maxTokens = maxOutputTokens
	}

	maxChars := maxTokens * 4
	contentLen := len(content)

	if contentLen <= maxChars {
		return content
	}

	// 截断内容
	truncated := content[:maxChars]
	omittedChars := contentLen - maxChars
	omittedTokens := omittedChars / 4

	// 添加截断提示信息
	truncateMsg := fmt.Sprintf("\n\n[... content truncated ... 后续约 %d tokens 的内容已被省略，以保护上下文空间。如需查看特定部分，请使用 start_line/end_line 参数。]", omittedTokens)

	return truncated + truncateMsg
}

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
			Description: "从文件中读取内容。提供多种灵活的读取模式。如果未提供任何可选参数，则会尝试读取整个文件（但会受Token限制自动截断）。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "文件路径（必需）",
					},
					"head": map[string]interface{}{
						"type":        "integer",
						"description": "读取文件开头的N行（可选）",
					},
					"tail": map[string]interface{}{
						"type":        "integer",
						"description": "读取文件末尾的N行（可选）",
					},
					"start_line": map[string]interface{}{
						"type":        "integer",
						"description": "读取的起始行号，从1开始（可选，需与end_line配合使用）",
					},
					"end_line": map[string]interface{}{
						"type":        "integer",
						"description": "读取的结束行号，包含此行（可选，需与start_line配合使用）",
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

// ToolResult 工具执行结果
type ToolResult struct {
	Output      string // 输出内容
	IsCommand   bool   // 是否是需要在终端执行的命令
	Command     string // 如果IsCommand为true，这里是命令字符串
	DirectResult bool  // 是否是直接结果（不需要终端）
}

// ExecuteTool 执行工具调用，返回工具结果
func ExecuteTool(toolName string, args map[string]interface{}) (*ToolResult, error) {
	switch toolName {
	case "path_switch":
		cmd, err := executePathSwitch(args)
		if err != nil {
			return nil, err
		}
		return &ToolResult{Command: cmd, IsCommand: true}, nil

	case "read_file":
		output, err := executeReadFile(args)
		if err != nil {
			return nil, err
		}
		return &ToolResult{Output: output, DirectResult: true}, nil

	case "write_file":
		output, err := executeWriteFileDirect(args)
		if err != nil {
			return nil, err
		}
		return &ToolResult{Output: output, DirectResult: true}, nil

	case "grep":
		cmd, err := executeGrep(args)
		if err != nil {
			return nil, err
		}
		return &ToolResult{Command: cmd, IsCommand: true}, nil

	case "list_files":
		cmd, err := executeListFiles(args)
		if err != nil {
			return nil, err
		}
		return &ToolResult{Command: cmd, IsCommand: true}, nil

	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
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

// executeReadFile 统一的文件读取函数，支持多种模式
func executeReadFile(args map[string]interface{}) (string, error) {
	path := extractPath(args)
	if path == "" {
		return "", fmt.Errorf("missing or invalid path parameter")
	}

	// 优先级1: 检查 head 参数
	if head, ok := extractInt(args, "head"); ok && head > 0 {
		result, err := readFileLines(path, 1, head)
		if err != nil {
			return "", err
		}
		return truncateByTokens(result, maxOutputTokens), nil
	}

	// 优先级2: 检查 tail 参数
	if tail, ok := extractInt(args, "tail"); ok && tail > 0 {
		result, err := readFileTail(path, tail)
		if err != nil {
			return "", err
		}
		return truncateByTokens(result, maxOutputTokens), nil
	}

	// 优先级3: 检查 start_line / end_line 参数
	if startLine, okStart := extractInt(args, "start_line"); okStart {
		if endLine, okEnd := extractInt(args, "end_line"); okEnd {
			if startLine < 1 {
				return "", fmt.Errorf("start_line must be >= 1")
			}
			if endLine < startLine {
				return "", fmt.Errorf("end_line must be >= start_line")
			}
			result, err := readFileLines(path, startLine, endLine-startLine+1)
			if err != nil {
				return "", err
			}
			return truncateByTokens(result, maxOutputTokens), nil
		}
		return "", fmt.Errorf("start_line requires end_line parameter")
	}

	// 默认行为: 读取整个文件
	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %v", err)
	}

	return truncateByTokens(string(content), maxOutputTokens), nil
}

// readFileLines 读取文件指定行
func readFileLines(path string, startLine, count int) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	var result strings.Builder
	currentLine := 1
	linesRead := 0

	for scanner.Scan() {
		if currentLine >= startLine && linesRead < count {
			result.WriteString(scanner.Text())
			result.WriteString("\n")
			linesRead++
		}
		currentLine++

		if linesRead >= count {
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("error reading file: %v", err)
	}

	if linesRead == 0 {
		return "", fmt.Errorf("no lines found in specified range")
	}

	return fmt.Sprintf("[Lines %d-%d of %s]\n%s", startLine, startLine+linesRead-1, path, result.String()), nil
}

// executeWriteFileDirect 直接写入文件
func executeWriteFileDirect(args map[string]interface{}) (string, error) {
	path := extractPath(args)
	if path == "" {
		return "", fmt.Errorf("missing or invalid path parameter")
	}

	content, ok := args["content"].(string)
	if !ok {
		return "", fmt.Errorf("missing or invalid 'content' parameter")
	}

	err := os.WriteFile(path, []byte(content), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write file: %v", err)
	}

	return fmt.Sprintf("Successfully wrote %d bytes to %s", len(content), path), nil
}

// extractPath 从参数中提取路径，兼容多种参数名
func extractPath(args map[string]interface{}) string {
	if path, ok := args["path"].(string); ok {
		return path
	}
	if path, ok := args["file_path"].(string); ok {
		return path
	}
	if path, ok := args["filename"].(string); ok {
		return path
	}
	return ""
}

// extractInt 从参数中提取整数值，兼容float64和int类型
func extractInt(args map[string]interface{}, key string) (int, bool) {
	if val, ok := args[key].(float64); ok {
		return int(val), true
	}
	if val, ok := args[key].(int); ok {
		return val, true
	}
	return 0, false
}

// readFileTail 读取文件末尾N行
func readFileTail(path string, lines int) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	// 使用两遍扫描：第一遍统计总行数，第二遍读取末尾行
	scanner := bufio.NewScanner(file)
	totalLines := 0
	for scanner.Scan() {
		totalLines++
	}

	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("error reading file: %v", err)
	}

	// 计算起始行
	startLine := totalLines - lines + 1
	if startLine < 1 {
		startLine = 1
	}

	// 重新打开文件读取指定行
	file.Seek(0, 0)
	scanner = bufio.NewScanner(file)
	var result strings.Builder
	currentLine := 1

	for scanner.Scan() {
		if currentLine >= startLine {
			result.WriteString(scanner.Text())
			result.WriteString("\n")
		}
		currentLine++
	}

	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("error reading file: %v", err)
	}

	actualStart := startLine
	actualEnd := totalLines
	return fmt.Sprintf("[Lines %d-%d of %s (last %d lines)]\n%s", actualStart, actualEnd, path, lines, result.String()), nil
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