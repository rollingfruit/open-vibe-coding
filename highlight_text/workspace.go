package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// WorkspaceManager 管理全局工作空间路径
type WorkspaceManager struct {
	mu              sync.RWMutex
	currentPath     string
	defaultPath     string
	broadcastChange func(string) // 用于通知前端工作空间已更改
}

var workspaceManager *WorkspaceManager

// InitWorkspaceManager 初始化工作空间管理器
func InitWorkspaceManager(defaultPath string, broadcastFunc func(string)) {
	workspaceManager = &WorkspaceManager{
		currentPath:     defaultPath,
		defaultPath:     defaultPath,
		broadcastChange: broadcastFunc,
	}
}

// GetWorkspacePath 获取当前工作空间路径（线程安全）
func (wm *WorkspaceManager) GetWorkspacePath() string {
	wm.mu.RLock()
	defer wm.mu.RUnlock()
	return wm.currentPath
}

// SetWorkspacePath 设置工作空间路径（线程安全）
func (wm *WorkspaceManager) SetWorkspacePath(path string) error {
	// 验证路径是否存在
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("路径不存在: %s", path)
	}

	// 验证路径是否为目录
	fileInfo, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("无法访问路径: %v", err)
	}
	if !fileInfo.IsDir() {
		return fmt.Errorf("路径不是目录: %s", path)
	}

	// 获取绝对路径
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("无法获取绝对路径: %v", err)
	}

	wm.mu.Lock()
	oldPath := wm.currentPath
	wm.currentPath = absPath
	wm.mu.Unlock()

	// 广播工作空间变更通知
	if wm.broadcastChange != nil && oldPath != absPath {
		wm.broadcastChange(absPath)
	}

	return nil
}

// ResetToDefault 重置为默认工作空间
func (wm *WorkspaceManager) ResetToDefault() error {
	return wm.SetWorkspacePath(wm.defaultPath)
}

// WorkspaceInfo 工作空间信息
type WorkspaceInfo struct {
	Path         string `json:"path"`
	AbsolutePath string `json:"absolute_path"`
	Exists       bool   `json:"exists"`
	IsDirectory  bool   `json:"is_directory"`
	FileCount    int    `json:"file_count,omitempty"`
}

// GetWorkspaceInfo 获取工作空间详细信息
func (wm *WorkspaceManager) GetWorkspaceInfo() WorkspaceInfo {
	currentPath := wm.GetWorkspacePath()
	info := WorkspaceInfo{
		Path:         currentPath,
		AbsolutePath: currentPath,
	}

	if fileInfo, err := os.Stat(currentPath); err == nil {
		info.Exists = true
		info.IsDirectory = fileInfo.IsDir()

		// 统计文件数量（仅统计支持的文件类型）
		if info.IsDirectory {
			fileCount := 0
			filepath.WalkDir(currentPath, func(path string, d fs.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				if !d.IsDir() && isSupportedFile(d.Name()) {
					fileCount++
				}
				return nil
			})
			info.FileCount = fileCount
		}
	}

	return info
}

// isSupportedFile 检查文件是否为支持的类型
func isSupportedFile(filename string) bool {
	supportedExts := []string{".md", ".txt", ".log", ".json", ".yaml", ".yml", ".toml", ".xml"}
	ext := filepath.Ext(filename)
	for _, supported := range supportedExts {
		if ext == supported {
			return true
		}
	}
	return false
}

// HTTP Handlers

// HandleGetWorkspace 获取当前工作空间信息
func HandleGetWorkspace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	info := workspaceManager.GetWorkspaceInfo()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// SetWorkspaceRequest 设置工作空间请求
type SetWorkspaceRequest struct {
	Path string `json:"path"`
}

// HandleSetWorkspace 设置工作空间路径
func HandleSetWorkspace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SetWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	if err := workspaceManager.SetWorkspacePath(req.Path); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 返回更新后的工作空间信息
	info := workspaceManager.GetWorkspaceInfo()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "工作空间已更新",
		"workspace": info,
	})
}

// BrowseFolderRequest 浏览文件夹请求
type BrowseFolderRequest struct {
	StartPath string `json:"start_path,omitempty"`
}

// HandleBrowseFolder 浏览并选择文件夹
// 注意：这个功能在Web环境中需要前端使用<input type="file" webkitdirectory>
// 或者实现一个文件系统浏览器UI
func HandleBrowseFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req BrowseFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// 如果解析失败，使用默认路径
		req.StartPath = "."
	}

	startPath := req.StartPath
	if startPath == "" {
		startPath = "."
	}

	// 获取绝对路径
	absPath, err := filepath.Abs(startPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Invalid path: %v", err), http.StatusBadRequest)
		return
	}

	// 列出目录内容
	entries, err := os.ReadDir(absPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Cannot read directory: %v", err), http.StatusBadRequest)
		return
	}

	// 构建目录列表（只返回目录，不返回文件）
	type DirEntry struct {
		Name     string `json:"name"`
		Path     string `json:"path"`
		IsParent bool   `json:"is_parent,omitempty"`
	}

	var dirs []DirEntry

	// 添加父目录入口（如果不是根目录）
	parentPath := filepath.Dir(absPath)
	if parentPath != absPath {
		dirs = append(dirs, DirEntry{
			Name:     "..",
			Path:     parentPath,
			IsParent: true,
		})
	}

	// 添加子目录
	for _, entry := range entries {
		if entry.IsDir() {
			dirs = append(dirs, DirEntry{
				Name: entry.Name(),
				Path: filepath.Join(absPath, entry.Name()),
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"current_path": absPath,
		"directories":  dirs,
	})
}
