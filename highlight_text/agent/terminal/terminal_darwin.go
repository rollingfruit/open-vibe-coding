//go:build darwin || linux

package terminal

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// MacTerminal macOS/Linux 终端实现
type MacTerminal struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
	cwd    string
	mu     sync.Mutex
}

// newTerminal 创建新的 macOS/Linux 终端实例
func newTerminal() (Terminal, error) {
	return newMacTerminal()
}

// newMacTerminal 创建新的 macOS/Linux 终端实例
func newMacTerminal() (*MacTerminal, error) {
	cmd := exec.Command("/bin/bash")

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
		return nil, fmt.Errorf("failed to start bash: %v", err)
	}

	mt := &MacTerminal{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		stderr: stderr,
		cwd:    "",
	}

	// 获取初始工作目录
	cwd, _ := mt.Execute("pwd")
	mt.cwd = strings.TrimSpace(cwd)

	return mt, nil
}

// Execute 执行命令并返回输出
func (mt *MacTerminal) Execute(command string) (string, error) {
	mt.mu.Lock()
	defer mt.mu.Unlock()

	// 添加分隔符以便识别命令输出的结束
	marker := "___COMMAND_END___"
	fullCommand := fmt.Sprintf("%s; echo %s\n", command, marker)

	// 写入命令
	if _, err := mt.stdin.Write([]byte(fullCommand)); err != nil {
		return "", fmt.Errorf("failed to write command: %v", err)
	}

	// 读取输出直到遇到分隔符
	var output strings.Builder
	scanner := bufio.NewScanner(mt.stdout)

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
		cwd, _ := mt.Execute("pwd")
		mt.cwd = strings.TrimSpace(cwd)
	}

	result := strings.TrimSpace(output.String())
	return result, nil
}

// Close 关闭终端
func (mt *MacTerminal) Close() error {
	mt.mu.Lock()
	defer mt.mu.Unlock()

	if mt.stdin != nil {
		mt.stdin.Write([]byte("exit\n"))
		mt.stdin.Close()
	}

	if mt.cmd != nil && mt.cmd.Process != nil {
		return mt.cmd.Process.Kill()
	}

	return nil
}

// GetCwd 获取当前工作目录
func (mt *MacTerminal) GetCwd() string {
	mt.mu.Lock()
	defer mt.mu.Unlock()
	return mt.cwd
}