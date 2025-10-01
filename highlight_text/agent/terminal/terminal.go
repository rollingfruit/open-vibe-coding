package terminal

// Terminal 定义了终端操作的接口
type Terminal interface {
	// Execute 执行命令并返回输出
	Execute(command string) (string, error)
	// Close 关闭终端
	Close() error
	// GetCwd 获取当前工作目录
	GetCwd() string
}

// New 创建一个新的终端实例
func New() (Terminal, error) {
	return newTerminal()
}