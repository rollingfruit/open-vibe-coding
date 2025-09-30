package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type InteractionLog struct {
	Timestamp string `json:"timestamp"`
	UserInput string `json:"user_input"`
	AIResponse string `json:"ai_response"`
	Type string `json:"type"` // "main" or "followup"
}

var logMutex sync.Mutex

func main() {
	// 设置静态文件服务器，指向web目录
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", fs)

	// API端点：记录交互日志
	http.HandleFunc("/log", handleLog)

	// API端点：HTML预览
	http.HandleFunc("/preview", handlePreview)

	fmt.Println("🚀 AI助手Web服务启动成功!")
	fmt.Println("📱 请访问: http://localhost:8080")
	fmt.Println("📝 交互日志将保存至: interactions.log.json")
	fmt.Println("🔍 HTML预览: http://localhost:8080/preview")
	fmt.Println("⏹️  按 Ctrl+C 停止服务")

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