package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
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

	fmt.Println("🚀 AI助手Web服务启动成功!")
	fmt.Println("📱 请访问: http://localhost:8080")
	fmt.Println("📝 交互日志将保存至: interactions.log.json")
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