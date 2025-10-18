package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"highlight_text/agent/terminal"
	"highlight_text/agent/tools"
	"highlight_text/agent/tools/notes"
	"highlight_text/agent/tools/tasks"

	"github.com/gorilla/websocket"
)

type InteractionLog struct {
	Timestamp string `json:"timestamp"`
	UserInput string `json:"user_input"`
	AIResponse string `json:"ai_response"`
	Type string `json:"type"` // "main" or "followup"
}

// AgentRequest Agent请求结构
type AgentRequest struct {
	SessionID        string                 `json:"session_id"`
	Tool             string                 `json:"tool"`
	Args             map[string]interface{} `json:"args"`
	Action           string                 `json:"action"` // "execute" or "close"
	UserConfirmed    bool                   `json:"user_confirmed"`
	InitialDirectory string                 `json:"initial_directory"` // 初始工作目录
	AgentType        string                 `json:"agent_type,omitempty"` // "terminal" or "knowledge"
}

// AgentResponse Agent响应结构
type AgentResponse struct {
	Success           bool   `json:"success"`
	Output            string `json:"output"`
	Error             string `json:"error,omitempty"`
	Cwd               string `json:"cwd"`
	RequiresConfirm   bool   `json:"requires_confirm"`
	ConfirmMessage    string `json:"confirm_message,omitempty"`
	InitialDirectory  string `json:"initial_directory,omitempty"`
}

var logMutex sync.Mutex
var terminals sync.Map // 存储所有活动的终端会话

// WebSocket相关
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许所有来源
	},
}
var wsClients = make(map[*websocket.Conn]bool)
var wsClientsMutex sync.Mutex
var lastKBModTime time.Time

func main() {
	// 初始化工作空间管理器
	defaultWorkspace := "./KnowledgeBase"
	InitWorkspaceManager(defaultWorkspace, func(newPath string) {
		log.Printf("工作空间已切换至: %s", newPath)
		broadcastWorkspaceChange(newPath)
	})

	// API端点必须在静态文件服务器之前注册
	// API端点：记录交互日志
	http.HandleFunc("/log", handleLog)

	// API端点：HTML预览
	http.HandleFunc("/preview", handlePreview)

	// API端点：图片上传
	http.HandleFunc("/upload-image", handleImageUpload)

	// API端点：Agent执行
	http.HandleFunc("/agent/execute", handleAgentExecute)

	// API端点：获取可用工具
	http.HandleFunc("/agent/tools", handleAgentTools)

	// API端点：保存Agent日志
	http.HandleFunc("/agent/save-log", handleAgentSaveLog)

	// 知识库API端点
	http.HandleFunc("/api/notes", handleNotes)
	http.HandleFunc("/api/notes/upload-image", handleNoteImageUpload)
	http.HandleFunc("/api/notes/move", handleMoveNote)
	http.HandleFunc("/api/notes/delete", handleDeleteNote)
	http.HandleFunc("/api/notes/pdf-followup", handlePdfFollowup)
	http.HandleFunc("/api/notes/", handleNoteByID)
	http.HandleFunc("/api/search", handleSearchNotes)
	http.HandleFunc("/agent/knowledge/tools", handleKnowledgeAgentTools)
	http.HandleFunc("/agent/knowledge/write-log", handleKnowledgeAgentWriteLog)

	// 任务管理API端点
	http.HandleFunc("/api/tasks", handleTasks)
	http.HandleFunc("/agent/tasks/tools", handleTaskAgentTools)
	http.HandleFunc("/agent/tasks/execute", handleTaskAgentExecute)
	http.HandleFunc("/agent/tasks/log", handleTaskAgentLog)

	// 配置API端点
	http.HandleFunc("/api/save-config", handleSaveConfig)

	// WebSocket端点
	http.HandleFunc("/ws/notes", handleNotesWebSocket)

	// 工作空间管理API端点
	http.HandleFunc("/api/workspace", HandleGetWorkspace)
	http.HandleFunc("/api/workspace/set", HandleSetWorkspace)
	http.HandleFunc("/api/workspace/browse", HandleBrowseFolder)

	// 静态文件服务：提供uploads目录的访问
	http.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("./uploads"))))

	// 静态文件服务：提供KnowledgeBase目录的访问（用于图片）
	// 注意：这里仍使用/KnowledgeBase/作为URL路径，但实际映射到动态工作空间
	http.HandleFunc("/KnowledgeBase/", func(w http.ResponseWriter, r *http.Request) {
		workspacePath := workspaceManager.GetWorkspacePath()
		filePath := strings.TrimPrefix(r.URL.Path, "/KnowledgeBase/")
		fullPath := filepath.Join(workspacePath, filePath)
		http.ServeFile(w, r, fullPath)
	})

	// 设置静态文件服务器，指向web目录（必须放在最后）
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", fs)

	// 确保uploads目录存在
	if err := os.MkdirAll("./uploads", 0755); err != nil {
		log.Printf("创建uploads目录失败: %v", err)
	}

	// 确保logs目录存在
	if err := os.MkdirAll("./logs", 0755); err != nil {
		log.Printf("创建logs目录失败: %v", err)
	}

	// 确保知识库目录存在
	workspacePath := workspaceManager.GetWorkspacePath()
	if err := os.MkdirAll(workspacePath, 0755); err != nil {
		log.Printf("创建知识库目录失败: %v", err)
	}

	// 确保任务目录存在
	tasksPath := filepath.Join(workspacePath, "_tasks")
	if err := os.MkdirAll(tasksPath, 0755); err != nil {
		log.Printf("创建任务目录失败: %v", err)
	}

	fmt.Println("🚀 AI助手Web服务启动成功!")
	fmt.Println("📱 请访问: http://localhost:8080")
	fmt.Println("📝 交互日志将保存至: interactions.log.json")
	fmt.Println("🔍 HTML预览: http://localhost:8080/preview")
	fmt.Println("📷 图片上传: http://localhost:8080/upload-image")
	fmt.Printf("📚 知识库路径: %s\n", workspacePath)
	fmt.Println("🔌 WebSocket: ws://localhost:8080/ws/notes")
	fmt.Println("⏹️  按 Ctrl+C 停止服务")

	// 启动文件监控协程
	go monitorKnowledgeBase()

	// 启动HTTP服务器
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleLog(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头，允许前端访问
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 读取请求体
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var logEntry InteractionLog
	if err := json.Unmarshal(body, &logEntry); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 添加时间戳
	logEntry.Timestamp = time.Now().Format("2006-01-02 15:04:05")

	// 写入日志文件
	if err := writeLogEntry(logEntry); err != nil {
		log.Printf("Error writing log: %v", err)
		http.Error(w, "Failed to write log", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func writeLogEntry(entry InteractionLog) error {
	logMutex.Lock()
	defer logMutex.Unlock()

	logFile := "interactions.log.json"

	var logs []InteractionLog

	// 如果日志文件存在，先读取现有内容
	if _, err := os.Stat(logFile); err == nil {
		data, err := ioutil.ReadFile(logFile)
		if err != nil {
			return fmt.Errorf("failed to read log file: %v", err)
		}

		if len(data) > 0 {
			if err := json.Unmarshal(data, &logs); err != nil {
				// 如果解析失败，创建新的日志数组
				logs = []InteractionLog{}
			}
		}
	}

	// 添加新的日志条目
	logs = append(logs, entry)

	// 将日志写入文件
	data, err := json.MarshalIndent(logs, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal logs: %v", err)
	}

	// 确保目录存在
	if err := os.MkdirAll(filepath.Dir(logFile), 0755); err != nil && !os.IsExist(err) {
		return fmt.Errorf("failed to create log directory: %v", err)
	}

	if err := ioutil.WriteFile(logFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write log file: %v", err)
	}

	return nil
}

func handlePreview(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method == "GET" {
		// 返回预览页面模板
		previewTemplate := `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HTML预览 - 全屏模式</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            background: #f0f0f0;
        }
        .header {
            background: #333;
            color: white;
            padding: 10px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 1000;
        }
        .preview-container {
            background: white;
            min-height: calc(100vh - 60px);
            border-radius: 0;
        }
        .close-btn {
            background: #e74c3c;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
        }
        .close-btn:hover {
            background: #c0392b;
        }
        .loading {
            text-align: center;
            padding: 50px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="preview-container" id="previewContainer">
        <div class="loading">
            <p>正在加载HTML内容...</p>
            <p>请通过POST请求发送HTML内容到此页面</p>
        </div>
    </div>

    <script>
        // 监听来自父窗口的消息
        window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'html-content') {
                const container = document.getElementById('previewContainer');
                container.innerHTML = event.data.html;
            }
        });

        // 如果是通过POST请求打开的，等待内容
        if (window.location.search.includes('post=true')) {
            // 通知父窗口准备接收内容
            if (window.opener) {
                window.opener.postMessage({type: 'preview-ready'}, '*');
            }
        }
    </script>
</body>
</html>`

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(previewTemplate))
		return
	}

	if r.Method == "POST" {
		// 检查Content-Type来决定如何处理请求
		contentType := r.Header.Get("Content-Type")

		var htmlContent string

		if strings.Contains(contentType, "application/json") {
			// 处理JSON格式的请求
			body, err := ioutil.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "Failed to read request body", http.StatusBadRequest)
				return
			}

			var request struct {
				HTML string `json:"html"`
			}

			if err := json.Unmarshal(body, &request); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}
			htmlContent = request.HTML
		} else {
			// 处理表单格式的请求
			if err := r.ParseForm(); err != nil {
				http.Error(w, "Failed to parse form", http.StatusBadRequest)
				return
			}
			htmlContent = r.FormValue("html")
		}

		// 直接返回原始HTML内容，不添加任何包装
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(htmlContent))
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func handleImageUpload(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 解析multipart表单，限制最大内存为10MB
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// 获取上传的文件
	file, handler, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "Failed to get file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 验证文件类型
	contentType := handler.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		http.Error(w, "File must be an image", http.StatusBadRequest)
		return
	}

	// 生成唯一的文件名
	ext := filepath.Ext(handler.Filename)
	filename := fmt.Sprintf("%d_%s%s", time.Now().Unix(), generateRandomString(8), ext)
	filePath := filepath.Join("./uploads", filename)

	// 创建目标文件
	dst, err := os.Create(filePath)
	if err != nil {
		log.Printf("Failed to create file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	// 将上传的文件内容复制到目标文件
	if _, err := dst.ReadFrom(file); err != nil {
		log.Printf("Failed to write file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// 返回文件路径
	response := map[string]interface{}{
		"success":  true,
		"filePath": fmt.Sprintf("/uploads/%s", filename),
		"filename": filename,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func generateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
	result := make([]byte, length)
	for i := range result {
		result[i] = charset[time.Now().UnixNano()%int64(len(charset))]
	}
	return string(result)
}

// handleNoteImageUpload 处理笔记中的图片上传
func handleNoteImageUpload(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 解析multipart表单，限制最大内存为10MB
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// 获取上传的文件
	file, handler, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "Failed to get file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 验证文件类型
	contentType := handler.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		http.Error(w, "File must be an image", http.StatusBadRequest)
		return
	}

	// 获取存储模式和笔记ID
	storageMode := r.FormValue("storage_mode")
	if storageMode == "" {
		storageMode = "fixed"
	}
	noteID := r.FormValue("note_id")

	// 生成唯一的文件名
	ext := filepath.Ext(handler.Filename)
	filename := fmt.Sprintf("%d_%s%s", time.Now().Unix(), generateRandomString(8), ext)

	var uploadsDir string
	var webPath string

	if storageMode == "relative" && noteID != "" {
		// 相对路径模式：存储在笔记同级的imgs文件夹
		// 移除.md扩展名
		noteIDClean := strings.TrimSuffix(noteID, ".md")

		// 获取笔记所在目录
		noteDir := filepath.Dir(noteIDClean)
		if noteDir == "." {
			noteDir = ""
		}

		// 构建imgs目录路径
		workspacePath := workspaceManager.GetWorkspacePath()
		if noteDir != "" {
			uploadsDir = filepath.Join(workspacePath, noteDir, "imgs")
			webPath = fmt.Sprintf("/KnowledgeBase/%s/imgs/%s", noteDir, filename)
		} else {
			uploadsDir = filepath.Join(workspacePath, "imgs")
			webPath = fmt.Sprintf("/KnowledgeBase/imgs/%s", filename)
		}
	} else {
		// 固定路径模式：统一存储在uploads/nodes
		uploadsDir = "./uploads/nodes"
		webPath = fmt.Sprintf("/uploads/nodes/%s", filename)
	}

	// 确保目录存在
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		log.Printf("Failed to create uploads directory: %v", err)
		http.Error(w, "Failed to create uploads directory", http.StatusInternalServerError)
		return
	}

	filePath := filepath.Join(uploadsDir, filename)

	// 创建目标文件
	dst, err := os.Create(filePath)
	if err != nil {
		log.Printf("Failed to create file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	// 将上传的文件内容复制到目标文件
	if _, err := dst.ReadFrom(file); err != nil {
		log.Printf("Failed to write file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// 返回文件路径
	response := map[string]interface{}{
		"success":  true,
		"filePath": webPath,
		"filename": filename,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleAgentTools 返回可用的工具列表
func handleAgentTools(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	availableTools := tools.GetAvailableTools()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tools": availableTools,
	})
}

// handleAgentExecute 处理Agent命令执行请求
func handleAgentExecute(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 读取请求体
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req AgentRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 如果是关闭请求
	if req.Action == "close" {
		if term, ok := terminals.Load(req.SessionID); ok {
			if t, ok := term.(terminal.Terminal); ok {
				t.Close()
			}
			terminals.Delete(req.SessionID)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AgentResponse{
			Success: true,
			Output:  "Terminal session closed",
		})
		return
	}

	// 获取或创建终端实例
	var term terminal.Terminal
	var initialDir string

	if t, ok := terminals.Load(req.SessionID); ok {
		term = t.(terminal.Terminal)
	} else {
		newTerm, err := terminal.New()
		if err != nil {
			log.Printf("Failed to create terminal: %v", err)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(AgentResponse{
				Success: false,
				Error:   fmt.Sprintf("Failed to create terminal: %v", err),
			})
			return
		}
		term = newTerm
		terminals.Store(req.SessionID, term)
		initialDir = term.GetCwd()
	}

	// 如果是第一次请求，记录初始目录
	if req.InitialDirectory == "" {
		initialDir = term.GetCwd()
	} else {
		initialDir = req.InitialDirectory
	}

	// 检查是否需要用户确认
	needsConfirm, confirmMsg := checkIfNeedsConfirmation(req.Tool, req.Args, initialDir, term.GetCwd())

	if needsConfirm && !req.UserConfirmed {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AgentResponse{
			Success:          false,
			RequiresConfirm:  true,
			ConfirmMessage:   confirmMsg,
			Cwd:              term.GetCwd(),
			InitialDirectory: initialDir,
		})
		return
	}

	// 根据Agent类型执行不同的工具
	var result *tools.ToolResult
	var output string

	if req.AgentType == "knowledge" {
		// 执行知识库工具
		workspacePath := workspaceManager.GetWorkspacePath()
		knowledgeOutput, err := notes.ExecuteKnowledgeTool(req.Tool, req.Args, workspacePath)
		if err != nil {
			log.Printf("Failed to execute knowledge tool: %v", err)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(AgentResponse{
				Success: false,
				Error:   fmt.Sprintf("Failed to execute knowledge tool: %v", err),
				Cwd:     workspacePath,
			})
			return
		}
		output = knowledgeOutput

		// 返回成功响应
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AgentResponse{
			Success: true,
			Output:  output,
			Cwd:     workspacePath,
		})
		return
	}

	// 执行终端工具
	result, err = tools.ExecuteTool(req.Tool, req.Args)
	if err != nil {
		log.Printf("Failed to execute tool: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AgentResponse{
			Success:          false,
			Error:            fmt.Sprintf("Failed to execute tool: %v", err),
			Cwd:              term.GetCwd(),
			InitialDirectory: initialDir,
		})
		return
	}

	// 如果是直接结果，直接使用输出
	if result.DirectResult {
		output = result.Output
	} else if result.IsCommand {
		// 如果是命令，在终端中执行
		cmdOutput, err := term.Execute(result.Command)
		if err != nil {
			log.Printf("Failed to execute command: %v", err)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(AgentResponse{
				Success:          false,
				Error:            fmt.Sprintf("Failed to execute command: %v", err),
				Output:           cmdOutput,
				Cwd:              term.GetCwd(),
				InitialDirectory: initialDir,
			})
			return
		}
		output = cmdOutput
	}

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AgentResponse{
		Success:          true,
		Output:           output,
		Cwd:              term.GetCwd(),
		InitialDirectory: initialDir,
	})
}

// checkIfNeedsConfirmation 检查操作是否需要用户确认
func checkIfNeedsConfirmation(toolName string, args map[string]interface{}, initialDir, currentDir string) (bool, string) {
	switch toolName {
	case "path_switch":
		targetPath, ok := args["path"].(string)
		if !ok {
			return false, ""
		}

		// 如果是绝对路径
		if filepath.IsAbs(targetPath) {
			// 检查是否在初始目录或其子目录下
			absInitialDir, _ := filepath.Abs(initialDir)
			absTargetPath, _ := filepath.Abs(targetPath)

			rel, err := filepath.Rel(absInitialDir, absTargetPath)
			if err != nil || strings.HasPrefix(rel, "..") {
				return true, fmt.Sprintf("切换到初始目录之外的路径: %s", targetPath)
			}
		} else {
			// 相对路径，检查是否会跳出初始目录
			absCurrentDir, _ := filepath.Abs(currentDir)
			absTargetPath := filepath.Join(absCurrentDir, targetPath)
			absInitialDir, _ := filepath.Abs(initialDir)

			rel, err := filepath.Rel(absInitialDir, absTargetPath)
			if err != nil || strings.HasPrefix(rel, "..") {
				return true, fmt.Sprintf("切换到初始目录之外的路径: %s (解析为 %s)", targetPath, absTargetPath)
			}
		}

	case "write_file":
		// 兼容多种路径参数名：path, file_path, filename
		path, ok := args["path"].(string)
		if !ok {
			path, ok = args["file_path"].(string)
			if !ok {
				path, ok = args["filename"].(string)
				if !ok {
					return false, ""
				}
			}
		}
		return true, fmt.Sprintf("写入文件: %s", path)
	}

	return false, ""
}

// handleAgentSaveLog 保存Agent日志到logs目录
func handleAgentSaveLog(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 读取请求体
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var logData map[string]interface{}
	if err := json.Unmarshal(body, &logData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 生成日志文件名
	sessionID, _ := logData["session_id"].(string)
	if sessionID == "" {
		sessionID = fmt.Sprintf("agent_%d", time.Now().Unix())
	}
	logFileName := fmt.Sprintf("logs/%s.json", sessionID)

	// 写入日志文件
	logBytes, err := json.MarshalIndent(logData, "", "  ")
	if err != nil {
		log.Printf("Failed to marshal log data: %v", err)
		http.Error(w, "Failed to marshal log data", http.StatusInternalServerError)
		return
	}

	if err := ioutil.WriteFile(logFileName, logBytes, 0644); err != nil {
		log.Printf("Failed to write log file: %v", err)
		http.Error(w, "Failed to write log file", http.StatusInternalServerError)
		return
	}

	log.Printf("Agent日志已保存: %s", logFileName)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"filename": logFileName,
	})
}

// handleKnowledgeAgentTools 返回知识库专用工具列表
func handleKnowledgeAgentTools(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	knowledgeTools := notes.GetKnowledgeTools()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tools": knowledgeTools,
	})
}

// handleKnowledgeAgentWriteLog 处理日志写入请求
func handleKnowledgeAgentWriteLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 解析请求体
	var req struct {
		Filename string                 `json:"filename"`
		LogEntry map[string]interface{} `json:"logEntry"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 确保日志目录存在
	logDir := "./logs/notes"
	if err := os.MkdirAll(logDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Failed to create log directory: %v", err), http.StatusInternalServerError)
		return
	}

	// 日志文件路径
	logFilePath := filepath.Join(logDir, req.Filename)

	// 读取现有日志（如果存在）
	var logs []map[string]interface{}
	if data, err := ioutil.ReadFile(logFilePath); err == nil {
		json.Unmarshal(data, &logs)
	}

	// 追加新日志
	logs = append(logs, req.LogEntry)

	// 写入文件
	logData, err := json.MarshalIndent(logs, "", "  ")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to marshal log data: %v", err), http.StatusInternalServerError)
		return
	}

	if err := ioutil.WriteFile(logFilePath, logData, 0644); err != nil {
		http.Error(w, fmt.Sprintf("Failed to write log file: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Log written successfully",
	})
}

// handleNotes 处理笔记列表请求
func handleNotes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	workspacePath := workspaceManager.GetWorkspacePath()
	result, err := notes.ExecuteKnowledgeTool("list_notes", map[string]interface{}{}, workspacePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(result))
}

// handlePdfFollowup 处理PDF划词追问
func handlePdfFollowup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req struct {
		SelectedText string `json:"selectedText"`
		Question     string `json:"question"`
		Answer       string `json:"answer"`
		PdfPath      string `json:"pdfPath"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 从PDF路径提取文件名（去除/KnowledgeBase/前缀和.pdf扩展名）
	pdfFileName := strings.TrimPrefix(req.PdfPath, "/KnowledgeBase/")
	pdfFileName = strings.TrimSuffix(pdfFileName, ".pdf")

	// 调用notes包的AppendToFollowupNote函数
	workspacePath := workspaceManager.GetWorkspacePath()
	err = notes.AppendToFollowupNote(req.SelectedText, req.Question, req.Answer, pdfFileName, workspacePath)
	if err != nil {
		log.Printf("PDF追问失败: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// 广播更新通知（因为创建了新的md文件）
	broadcastNotesUpdate()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "追问内容已保存到对应的Markdown文件",
	})
}

// handleDeleteNote 处理笔记或文件夹删除
func handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req struct {
		Path string `json:"path"`
		Type string `json:"type"` // "file" or "folder"
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 调用notes包的删除函数
	workspacePath := workspaceManager.GetWorkspacePath()
	err = notes.DeleteNote(req.Path, req.Type, workspacePath)
	if err != nil {
		log.Printf("删除失败: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// 广播更新通知
	broadcastNotesUpdate()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Deleted successfully",
	})
}

// handleMoveNote 处理笔记或文件夹移动
func handleMoveNote(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req struct {
		Source      string `json:"source"`
		Destination string `json:"destination"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 调用notes包的移动函数
	workspacePath := workspaceManager.GetWorkspacePath()
	err = notes.MoveNote(req.Source, req.Destination, workspacePath)
	if err != nil {
		log.Printf("移动文件失败: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// 广播更新通知
	broadcastNotesUpdate()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "File moved successfully",
	})
}

// handleNoteByID 处理单个笔记的GET/PUT/DELETE
func handleNoteByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	// 提取note_id并URL解码
	noteID := strings.TrimPrefix(r.URL.Path, "/api/notes/")

	// 排除特殊路径（这些路径由其他处理器处理）
	if noteID == "move" || noteID == "delete" || noteID == "upload-image" {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	noteID, err := url.QueryUnescape(noteID)
	if err != nil {
		http.Error(w, "Invalid note ID", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		workspacePath := workspaceManager.GetWorkspacePath()
		result, err := notes.ExecuteKnowledgeTool("read_note", map[string]interface{}{
			"note_id": noteID,
		}, workspacePath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// 解析JSON并提取原始内容
		var noteData map[string]interface{}
		if err := json.Unmarshal([]byte(result), &noteData); err == nil {
			// 如果是JSON格式，提取content字段
			if content, ok := noteData["content"].(string); ok {
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.Write([]byte(content))
				return
			}
		}

		// 如果解析失败，返回原始结果
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte(result))

	case "PUT":
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		var req struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		workspacePath := workspaceManager.GetWorkspacePath()
		result, err := notes.ExecuteKnowledgeTool("update_note", map[string]interface{}{
			"note_id": noteID,
			"content": req.Content,
		}, workspacePath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": result,
		})

	case "DELETE":
		// 删除笔记
		workspacePath := workspaceManager.GetWorkspacePath()
		notePath := filepath.Join(workspacePath, noteID+".md")
		if err := os.Remove(notePath); err != nil {
			http.Error(w, "Failed to delete note", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Note deleted successfully",
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleSearchNotes 处理笔记搜索
func handleSearchNotes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, "Missing query parameter 'q'", http.StatusBadRequest)
		return
	}

	workspacePath := workspaceManager.GetWorkspacePath()
	result, err := notes.ExecuteKnowledgeTool("search_notes", map[string]interface{}{
		"query": query,
	}, workspacePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(result))
}

// handleSaveConfig 保存配置到config.json
func handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 读取请求体
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	// 验证JSON格式
	var config map[string]interface{}
	if err := json.Unmarshal(body, &config); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 格式化JSON并写入文件
	formattedJSON, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		http.Error(w, "Failed to format JSON", http.StatusInternalServerError)
		return
	}

	// 保存到web/config.json
	configPath := "./web/config.json"
	if err := ioutil.WriteFile(configPath, formattedJSON, 0644); err != nil {
		log.Printf("Failed to write config file: %v", err)
		http.Error(w, "Failed to save config", http.StatusInternalServerError)
		return
	}

	log.Printf("配置已保存到: %s", configPath)

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Configuration saved successfully",
	})
}

// handleNotesWebSocket 处理知识库WebSocket连接
func handleNotesWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket升级失败: %v", err)
		return
	}
	defer conn.Close()

	// 注册客户端
	wsClientsMutex.Lock()
	wsClients[conn] = true
	wsClientsMutex.Unlock()

	log.Printf("新的WebSocket客户端已连接, 当前客户端数: %d", len(wsClients))

	// 保持连接直到客户端断开
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			// 客户端断开连接
			wsClientsMutex.Lock()
			delete(wsClients, conn)
			wsClientsMutex.Unlock()
			log.Printf("WebSocket客户端已断开, 当前客户端数: %d", len(wsClients))
			break
		}
	}
}

// broadcastNotesUpdate 广播知识库更新通知
func broadcastNotesUpdate() {
	wsClientsMutex.Lock()
	defer wsClientsMutex.Unlock()

	message := map[string]string{
		"type": "refresh_notes",
	}
	messageJSON, err := json.Marshal(message)
	if err != nil {
		log.Printf("序列化WebSocket消息失败: %v", err)
		return
	}

	// 向所有连接的客户端发送消息
	for conn := range wsClients {
		err := conn.WriteMessage(websocket.TextMessage, messageJSON)
		if err != nil {
			log.Printf("发送WebSocket消息失败: %v", err)
			conn.Close()
			delete(wsClients, conn)
		}
	}
}

// broadcastWorkspaceChange 广播工作空间变更通知
func broadcastWorkspaceChange(newPath string) {
	wsClientsMutex.Lock()
	defer wsClientsMutex.Unlock()

	message := map[string]string{
		"type":      "workspace_changed",
		"workspace": newPath,
	}
	messageJSON, err := json.Marshal(message)
	if err != nil {
		log.Printf("序列化WebSocket消息失败: %v", err)
		return
	}

	// 向所有连接的客户端发送消息
	for conn := range wsClients {
		err := conn.WriteMessage(websocket.TextMessage, messageJSON)
		if err != nil {
			log.Printf("发送WebSocket消息失败: %v", err)
			conn.Close()
			delete(wsClients, conn)
		}
	}
}

// getKBModTime 获取知识库目录的最新修改时间
func getKBModTime() time.Time {
	var latestTime time.Time
	workspacePath := workspaceManager.GetWorkspacePath()

	filepath.Walk(workspacePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.ModTime().After(latestTime) {
			latestTime = info.ModTime()
		}
		return nil
	})

	return latestTime
}

// monitorKnowledgeBase 监控知识库目录变化
func monitorKnowledgeBase() {
	// 初始化时间戳
	lastKBModTime = getKBModTime()

	ticker := time.NewTicker(2 * time.Second) // 每2秒检查一次
	defer ticker.Stop()

	for range ticker.C {
		currentModTime := getKBModTime()
		if currentModTime.After(lastKBModTime) {
			log.Printf("检测到知识库文件变化，通知客户端刷新")
			lastKBModTime = currentModTime
			broadcastNotesUpdate()
		}
	}
}

// handleTaskAgentTools 返回任务管理专用工具列表
func handleTaskAgentTools(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskTools := tasks.GetTaskTools()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tools": taskTools,
	})
}

// handleTaskAgentExecute 处理任务Agent工具执行
func handleTaskAgentExecute(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 读取请求体
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req struct {
		Tool string                 `json:"tool"`
		Args map[string]interface{} `json:"args"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 执行任务工具
	workspacePath := workspaceManager.GetWorkspacePath()
	tasksPath := filepath.Join(workspacePath, "_tasks")
	result, err := tasks.ExecuteTaskTool(req.Tool, req.Args, tasksPath)
	if err != nil {
		log.Printf("Failed to execute task tool: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to execute task tool: %v", err),
		})
		return
	}

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(result))
}

// handleTaskAgentLog 处理任务Agent日志写入
func handleTaskAgentLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 读取请求体
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	// 解析JSON
	var logData map[string]interface{}
	if err := json.Unmarshal(body, &logData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 确保 logs/tasks 目录存在
	logsDir := "./logs/tasks"
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		log.Printf("Failed to create logs directory: %v", err)
		http.Error(w, "Failed to create logs directory", http.StatusInternalServerError)
		return
	}

	// 生成文件名（使用时间戳）
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("task_log_%s.json", timestamp)
	logPath := filepath.Join(logsDir, filename)

	// 将日志数据写入文件（格式化JSON）
	formattedJSON, err := json.MarshalIndent(logData, "", "  ")
	if err != nil {
		log.Printf("Failed to marshal log data: %v", err)
		http.Error(w, "Failed to format log data", http.StatusInternalServerError)
		return
	}

	if err := ioutil.WriteFile(logPath, formattedJSON, 0644); err != nil {
		log.Printf("Failed to write log file: %v", err)
		http.Error(w, "Failed to write log file", http.StatusInternalServerError)
		return
	}

	log.Printf("Task agent log saved to: %s", logPath)

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"filename": filename,
		"message":  fmt.Sprintf("Log saved to %s", filename),
	})
}

// handleTasks 处理任务列表请求
func handleTasks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	workspacePath := workspaceManager.GetWorkspacePath()
	tasksPath := filepath.Join(workspacePath, "_tasks")
	result, err := tasks.ExecuteTaskTool("list_tasks", map[string]interface{}{}, tasksPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(result))
}