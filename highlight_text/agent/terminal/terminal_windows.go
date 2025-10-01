//go:build windows

package terminal

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// WindowsTerminal Windows 终端实现
type WindowsTerminal struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
	cwd    string
	mu     sync.Mutex
}

// newTerminal 创建新的 Windows 终端实例
func newTerminal() (Terminal, error) {
	return newWindowsTerminal()
}

// newWindowsTerminal 创建新的 Windows 终端实例
func newWindowsTerminal() (*WindowsTerminal, error) {
	cmd := exec.Command("cmd.exe")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdin pipe: %v", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %v", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %v", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start cmd.exe: %v", err)
	}

	wt := &WindowsTerminal{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		stderr: stderr,
		cwd:    "",
	}

	// 获取初始工作目录
	cwd, _ := wt.Execute("cd")
	wt.cwd = strings.TrimSpace(cwd)

	return wt, nil
}

// Execute 执行命令并返回输出
func (wt *WindowsTerminal) Execute(command string) (string, error) {
	wt.mu.Lock()
	defer wt.mu.Unlock()

	// 添加分隔符以便识别命令输出的结束
	marker := "___COMMAND_END___"
	fullCommand := fmt.Sprintf("%s && echo %s\r\n", command, marker)

	// 写入命令
	if _, err := wt.stdin.Write([]byte(fullCommand)); err != nil {
		return "", fmt.Errorf("failed to write command: %v", err)
	}

	// 读取输出直到遇到分隔符
	var output strings.Builder
	scanner := bufio.NewScanner(wt.stdout)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, marker) {
			break
		}
		output.WriteString(line)
		output.WriteString("\n")
	}

	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("failed to read output: %v", err)
	}

	// 更新当前工作目录（如果执行的是 cd 命令）
	if strings.HasPrefix(strings.TrimSpace(command), "cd ") {
		cwd, _ := wt.Execute("cd")
		wt.cwd = strings.TrimSpace(cwd)
	}

	result := strings.TrimSpace(output.String())
	return result, nil
}

// Close 关闭终端
func (wt *WindowsTerminal) Close() error {
	wt.mu.Lock()
	defer wt.mu.Unlock()

	if wt.stdin != nil {
		wt.stdin.Write([]byte("exit\r\n"))
		wt.stdin.Close()
	}

	if wt.cmd != nil && wt.cmd.Process != nil {
		return wt.cmd.Process.Kill()
	}

	return nil
}

// GetCwd 获取当前工作目录
func (wt *WindowsTerminal) GetCwd() string {
	wt.mu.Lock()
	defer wt.mu.Unlock()
	return wt.cwd
}