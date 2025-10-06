package tasks

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Task 表示一个任务
type Task struct {
	ID          string                 `json:"id"`
	Title       string                 `json:"title"`
	Type        string                 `json:"type,omitempty"`     // 任务类型: work, personal, study
	Color       string                 `json:"color,omitempty"`    // 任务颜色
	Status      string                 `json:"status"`             // preview | pending | in_progress | completed | archived
	Project     string                 `json:"project,omitempty"`
	ParentID    string                 `json:"parent_id,omitempty"` // 父任务ID
	Progress    int                    `json:"progress,omitempty"`  // 进度百分比 (0-100)
	DtStart     string                 `json:"dtstart,omitempty"`
	DtEnd       string                 `json:"dtend,omitempty"`
	CreatedAt   string                 `json:"created_at"`
	UpdatedAt   string                 `json:"updated_at"`
	CompletedAt string                 `json:"completed_at,omitempty"`
	Review      *TaskReview            `json:"review,omitempty"`
	Content     string                 `json:"content,omitempty"` // Markdown 正文
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// TaskReview 表示任务复盘数据
type TaskReview struct {
	Score   *int                   `json:"score,omitempty"` // 1-5
	Metrics map[string]int         `json:"metrics,omitempty"`
	Notes   string                 `json:"notes,omitempty"`
}

// ToolDefinition 定义任务工具
type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// GetTaskTools 返回任务管理工具列表
func GetTaskTools() []ToolDefinition {
	return []ToolDefinition{
		{
			Name:        "get_current_time",
			Description: "获取当前时间（ISO 8601格式）。用于任务规划时确定准确的时间戳。",
			Parameters: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "create_task",
			Description: "创建一个新任务。根据传入的YAML数据，在 _tasks/ 目录下创建一个新的 .md 文件。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"title": map[string]interface{}{
						"type":        "string",
						"description": "任务标题",
					},
					"type": map[string]interface{}{
						"type":        "string",
						"description": "任务类型（work-工作/personal-个人/study-学习，可选）",
					},
					"status": map[string]interface{}{
						"type":        "string",
						"description": "任务状态（preview-预览/pending-待处理，默认为pending。使用preview创建待确认的任务）",
					},
					"project": map[string]interface{}{
						"type":        "string",
						"description": "项目名称（用于甘特图分组，可选）",
					},
					"parent_id": map[string]interface{}{
						"type":        "string",
						"description": "父任务ID（创建子任务时使用，可选）",
					},
					"dtstart": map[string]interface{}{
						"type":        "string",
						"description": "开始时间（ISO 8601格式，可选）",
					},
					"dtend": map[string]interface{}{
						"type":        "string",
						"description": "结束时间（ISO 8601格式，可选）",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "任务描述（Markdown格式，可选）",
					},
				},
				"required": []string{"title"},
			},
		},
		{
			Name:        "list_tasks",
			Description: "列出所有任务。可以根据状态、项目、日期范围等条件过滤。返回任务对象的JSON数组。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"status": map[string]interface{}{
						"type":        "string",
						"description": "按状态过滤（pending|in_progress|completed|archived，可选）",
					},
					"project": map[string]interface{}{
						"type":        "string",
						"description": "按项目名称过滤（可选）",
					},
					"date_from": map[string]interface{}{
						"type":        "string",
						"description": "开始日期过滤（ISO 8601格式，可选）",
					},
					"date_to": map[string]interface{}{
						"type":        "string",
						"description": "结束日期过滤（ISO 8601格式，可选）",
					},
				},
			},
		},
		{
			Name:        "update_task",
			Description: "更新任务信息。可以更新任务的任意字段（标题、状态、时间、复盘数据等）或正文内容。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"task_id": map[string]interface{}{
						"type":        "string",
						"description": "任务ID",
					},
					"updates": map[string]interface{}{
						"type":        "object",
						"description": "要更新的字段（支持 title, status, type, parent_id, progress, project, dtstart, dtend, content, review 等）",
					},
				},
				"required": []string{"task_id", "updates"},
			},
		},
		{
			Name:        "delete_task",
			Description: "删除指定任务。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"task_id": map[string]interface{}{
						"type":        "string",
						"description": "任务ID",
					},
				},
				"required": []string{"task_id"},
			},
		},
	}
}

// ExecuteTaskTool 执行任务工具
func ExecuteTaskTool(toolName string, args map[string]interface{}, tasksBasePath string) (string, error) {
	switch toolName {
	case "get_current_time":
		return getCurrentTime()
	case "create_task":
		return createTask(args, tasksBasePath)
	case "list_tasks":
		return listTasks(args, tasksBasePath)
	case "update_task":
		return updateTask(args, tasksBasePath)
	case "delete_task":
		return deleteTask(args, tasksBasePath)
	default:
		return "", fmt.Errorf("未知的任务工具: %s", toolName)
	}
}

// getCurrentTime 获取当前时间
func getCurrentTime() (string, error) {
	now := time.Now()
	result := map[string]interface{}{
		"current_time": now.Format(time.RFC3339),
		"timestamp":    now.Unix(),
		"formatted":    now.Format("2006-01-02 15:04:05"),
	}
	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}

// createTask 创建新任务
func createTask(args map[string]interface{}, basePath string) (string, error) {
	title, ok := args["title"].(string)
	if !ok || title == "" {
		return "", fmt.Errorf("缺少必需参数: title")
	}

	// 项目类型到颜色的映射
	projectTypeColors := map[string]string{
		"work":     "#3B82F6", // 蓝色 - 工作
		"personal": "#10B981", // 绿色 - 个人
		"study":    "#F97316", // 橙色 - 学习
		"default":  "#FBBF24", // 黄色 - 默认
	}

	// 生成任务ID（时间戳 + 随机字符）
	now := time.Now()
	taskID := fmt.Sprintf("task_%d_%s", now.Unix(), generateRandomID(5))

	// 构建任务对象，支持自定义状态
	status := "pending"
	if statusArg, ok := args["status"].(string); ok && statusArg != "" {
		status = statusArg
	}

	task := Task{
		ID:        taskID,
		Title:     title,
		Status:    status,
		CreatedAt: now.Format(time.RFC3339),
		UpdatedAt: now.Format(time.RFC3339),
	}

	// 处理任务类型和颜色
	taskType := "default"
	if typeArg, ok := args["type"].(string); ok && typeArg != "" {
		taskType = strings.ToLower(typeArg)
	}
	task.Type = taskType

	// 根据类型分配颜色
	if color, exists := projectTypeColors[taskType]; exists {
		task.Color = color
	} else {
		task.Color = projectTypeColors["default"]
	}

	// 可选字段
	if project, ok := args["project"].(string); ok && project != "" {
		task.Project = project
	}
	if parentID, ok := args["parent_id"].(string); ok && parentID != "" {
		task.ParentID = parentID
	}
	if dtstart, ok := args["dtstart"].(string); ok && dtstart != "" {
		task.DtStart = dtstart
	}
	if dtend, ok := args["dtend"].(string); ok && dtend != "" {
		task.DtEnd = dtend
	}
	if content, ok := args["content"].(string); ok && content != "" {
		task.Content = content
	}

	// 确保 _tasks 目录存在
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return "", fmt.Errorf("创建任务目录失败: %v", err)
	}

	// 写入文件
	taskPath := filepath.Join(basePath, taskID+".md")
	fileContent := buildTaskFileContent(task)

	if err := os.WriteFile(taskPath, []byte(fileContent), 0644); err != nil {
		return "", fmt.Errorf("创建任务文件失败: %v", err)
	}

	// 返回结果
	result := map[string]interface{}{
		"success": true,
		"task_id": taskID,
		"task":    task,
		"message": fmt.Sprintf("任务 '%s' 已成功创建，ID: %s", title, taskID),
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}

// listTasks 列出所有任务
func listTasks(args map[string]interface{}, basePath string) (string, error) {
	// 读取所有任务文件
	files, err := os.ReadDir(basePath)
	if err != nil {
		if os.IsNotExist(err) {
			return "[]", nil // 目录不存在，返回空数组
		}
		return "", fmt.Errorf("读取任务目录失败: %v", err)
	}

	var tasks []Task
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".md") {
			continue
		}

		taskPath := filepath.Join(basePath, file.Name())
		task, err := parseTaskFile(taskPath)
		if err != nil {
			continue // 跳过解析失败的文件
		}

		// 应用过滤条件
		if shouldIncludeTask(task, args) {
			tasks = append(tasks, task)
		}
	}

	resultJSON, _ := json.MarshalIndent(tasks, "", "  ")
	return string(resultJSON), nil
}

// updateTask 更新任务
func updateTask(args map[string]interface{}, basePath string) (string, error) {
	taskID, ok := args["task_id"].(string)
	if !ok || taskID == "" {
		return "", fmt.Errorf("缺少必需参数: task_id")
	}

	updates, ok := args["updates"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("缺少必需参数: updates")
	}

	// 读取现有任务
	taskPath := filepath.Join(basePath, taskID+".md")
	task, err := parseTaskFile(taskPath)
	if err != nil {
		return "", fmt.Errorf("读取任务失败: %v", err)
	}

	// 应用更新
	if title, ok := updates["title"].(string); ok && title != "" {
		task.Title = title
	}
	if status, ok := updates["status"].(string); ok && status != "" {
		task.Status = status
		// 如果状态变为 completed，记录完成时间
		if status == "completed" && task.CompletedAt == "" {
			task.CompletedAt = time.Now().Format(time.RFC3339)
		}
	}
	if project, ok := updates["project"].(string); ok {
		task.Project = project
	}
	if dtstart, ok := updates["dtstart"].(string); ok {
		task.DtStart = dtstart
	}
	if dtend, ok := updates["dtend"].(string); ok {
		task.DtEnd = dtend
	}
	if content, ok := updates["content"].(string); ok {
		task.Content = content
	}

	// 处理复盘数据
	if review, ok := updates["review"].(map[string]interface{}); ok {
		if task.Review == nil {
			task.Review = &TaskReview{}
		}
		if score, ok := review["score"].(float64); ok {
			scoreInt := int(score)
			task.Review.Score = &scoreInt
		}
		if metrics, ok := review["metrics"].(map[string]interface{}); ok {
			if task.Review.Metrics == nil {
				task.Review.Metrics = make(map[string]int)
			}
			for k, v := range metrics {
				if val, ok := v.(float64); ok {
					task.Review.Metrics[k] = int(val)
				}
			}
		}
		if notes, ok := review["notes"].(string); ok {
			task.Review.Notes = notes
		}
	}

	// 更新时间戳
	task.UpdatedAt = time.Now().Format(time.RFC3339)

	// 写回文件
	fileContent := buildTaskFileContent(task)
	if err := os.WriteFile(taskPath, []byte(fileContent), 0644); err != nil {
		return "", fmt.Errorf("更新任务文件失败: %v", err)
	}

	// 返回结果
	result := map[string]interface{}{
		"success": true,
		"task_id": taskID,
		"task":    task,
		"message": fmt.Sprintf("任务 '%s' 已成功更新", task.Title),
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}

// deleteTask 删除任务(递归删除所有子任务)
func deleteTask(args map[string]interface{}, basePath string) (string, error) {
	taskID, ok := args["task_id"].(string)
	if !ok || taskID == "" {
		return "", fmt.Errorf("缺少必需参数: task_id")
	}

	// 步骤1: 加载所有任务以构建父子关系
	allTasks, err := loadAllTasks(basePath)
	if err != nil {
		return "", fmt.Errorf("加载任务列表失败: %v", err)
	}

	// 步骤2: 构建任务ID到任务对象的映射
	taskMap := make(map[string]Task)
	for _, task := range allTasks {
		taskMap[task.ID] = task
	}

	// 步骤3: 递归查找所有需要删除的任务ID
	tasksToDelete := []string{}
	collectTasksToDelete(taskID, taskMap, &tasksToDelete)

	// 步骤4: 批量删除文件
	deletedCount := 0
	for _, id := range tasksToDelete {
		taskPath := filepath.Join(basePath, id+".md")
		if err := os.Remove(taskPath); err != nil {
			// 如果文件不存在，继续删除其他文件
			if !os.IsNotExist(err) {
				return "", fmt.Errorf("删除任务 %s 失败: %v", id, err)
			}
		} else {
			deletedCount++
		}
	}

	// 步骤5: 返回结果
	result := map[string]interface{}{
		"success":      true,
		"task_id":      taskID,
		"deleted_ids":  tasksToDelete,
		"deleted_count": deletedCount,
		"message":      fmt.Sprintf("任务 '%s' 及 %d 个子任务已成功删除", taskID, deletedCount-1),
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return string(resultJSON), nil
}

// loadAllTasks 加载所有任务(内部辅助函数)
func loadAllTasks(basePath string) ([]Task, error) {
	files, err := os.ReadDir(basePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []Task{}, nil
		}
		return nil, err
	}

	var tasks []Task
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".md") {
			continue
		}

		taskPath := filepath.Join(basePath, file.Name())
		task, err := parseTaskFile(taskPath)
		if err != nil {
			continue // 跳过解析失败的文件
		}
		tasks = append(tasks, task)
	}

	return tasks, nil
}

// collectTasksToDelete 递归收集所有需要删除的任务ID
func collectTasksToDelete(taskID string, taskMap map[string]Task, result *[]string) {
	// 添加当前任务
	*result = append(*result, taskID)

	// 查找所有子任务
	for _, task := range taskMap {
		if task.ParentID == taskID {
			// 递归处理子任务
			collectTasksToDelete(task.ID, taskMap, result)
		}
	}
}

// parseTaskFile 解析任务文件
func parseTaskFile(filePath string) (Task, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return Task{}, err
	}

	contentStr := string(content)
	task := Task{}

	// 解析 YAML Front Matter
	if strings.HasPrefix(contentStr, "---\n") {
		parts := strings.SplitN(contentStr, "---\n", 3)
		if len(parts) >= 3 {
			yamlContent := parts[1]
			task.Content = strings.TrimSpace(parts[2])

			// 简单的 YAML 解析
			lines := strings.Split(yamlContent, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}

				keyValue := strings.SplitN(line, ":", 2)
				if len(keyValue) == 2 {
					key := strings.TrimSpace(keyValue[0])
					value := strings.TrimSpace(keyValue[1])
					value = strings.Trim(value, "\"'")

					switch key {
					case "id":
						task.ID = value
					case "title":
						task.Title = value
					case "type":
						task.Type = value
					case "color":
						task.Color = value
					case "status":
						task.Status = value
					case "project":
						task.Project = value
					case "parent_id":
						task.ParentID = value
					case "progress":
						// 解析进度为整数
						if progress, err := fmt.Sscanf(value, "%d", new(int)); err == nil && progress == 1 {
							task.Progress = *new(int)
						}
					case "dtstart":
						task.DtStart = value
					case "dtend":
						task.DtEnd = value
					case "created_at":
						task.CreatedAt = value
					case "updated_at":
						task.UpdatedAt = value
					case "completed_at":
						task.CompletedAt = value
					}
				}
			}
		}
	}

	return task, nil
}

// buildTaskFileContent 构建任务文件内容
func buildTaskFileContent(task Task) string {
	var sb strings.Builder

	// YAML Front Matter
	sb.WriteString("---\n")
	sb.WriteString(fmt.Sprintf("id: \"%s\"\n", task.ID))
	sb.WriteString(fmt.Sprintf("title: \"%s\"\n", task.Title))
	sb.WriteString(fmt.Sprintf("status: \"%s\"\n", task.Status))

	if task.Type != "" {
		sb.WriteString(fmt.Sprintf("type: \"%s\"\n", task.Type))
	}
	if task.Color != "" {
		sb.WriteString(fmt.Sprintf("color: \"%s\"\n", task.Color))
	}
	if task.Project != "" {
		sb.WriteString(fmt.Sprintf("project: \"%s\"\n", task.Project))
	}
	if task.ParentID != "" {
		sb.WriteString(fmt.Sprintf("parent_id: \"%s\"\n", task.ParentID))
	}
	if task.Progress > 0 {
		sb.WriteString(fmt.Sprintf("progress: %d\n", task.Progress))
	}
	if task.DtStart != "" {
		sb.WriteString(fmt.Sprintf("dtstart: \"%s\"\n", task.DtStart))
	}
	if task.DtEnd != "" {
		sb.WriteString(fmt.Sprintf("dtend: \"%s\"\n", task.DtEnd))
	}

	sb.WriteString(fmt.Sprintf("created_at: \"%s\"\n", task.CreatedAt))
	sb.WriteString(fmt.Sprintf("updated_at: \"%s\"\n", task.UpdatedAt))

	if task.CompletedAt != "" {
		sb.WriteString(fmt.Sprintf("completed_at: \"%s\"\n", task.CompletedAt))
	}

	// Review 数据
	if task.Review != nil {
		sb.WriteString("review:\n")
		if task.Review.Score != nil {
			sb.WriteString(fmt.Sprintf("  score: %d\n", *task.Review.Score))
		}
		if len(task.Review.Metrics) > 0 {
			sb.WriteString("  metrics:\n")
			for k, v := range task.Review.Metrics {
				sb.WriteString(fmt.Sprintf("    %s: %d\n", k, v))
			}
		}
		if task.Review.Notes != "" {
			sb.WriteString(fmt.Sprintf("  notes: \"%s\"\n", task.Review.Notes))
		}
	}

	sb.WriteString("---\n\n")

	// Markdown 正文
	if task.Content != "" {
		sb.WriteString(task.Content)
		sb.WriteString("\n")
	}

	return sb.String()
}

// shouldIncludeTask 判断任务是否应该被包含（基于过滤条件）
func shouldIncludeTask(task Task, filters map[string]interface{}) bool {
	if status, ok := filters["status"].(string); ok && status != "" {
		if task.Status != status {
			return false
		}
	}

	if project, ok := filters["project"].(string); ok && project != "" {
		if task.Project != project {
			return false
		}
	}

	// 日期范围过滤（简化版）
	if dateFrom, ok := filters["date_from"].(string); ok && dateFrom != "" {
		if task.DtStart < dateFrom {
			return false
		}
	}

	if dateTo, ok := filters["date_to"].(string); ok && dateTo != "" {
		if task.DtEnd > dateTo {
			return false
		}
	}

	return true
}

// generateRandomID 生成随机ID
func generateRandomID(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
		time.Sleep(1) // 简单的随机化
	}
	return string(b)
}
