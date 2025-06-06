package logger

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

var (
	globalLogger *zap.Logger
	once         sync.Once
)

// LogLevel 定义日志级别
type LogLevel string

const (
	DebugLevel LogLevel = "debug"
	InfoLevel  LogLevel = "info"
	WarnLevel  LogLevel = "warn"
	ErrorLevel LogLevel = "error"
)

// Config 定义日志配置
type Config struct {
	Level      LogLevel
	OutputPath string
	MaxSize    int
	MaxBackups int
	MaxAge     int
	Compress   bool
}

// InitLogger 初始化日志系统
func InitLogger(config Config) {
	once.Do(func() {
		// 设置日志级别
		var level zapcore.Level
		switch config.Level {
		case DebugLevel:
			level = zapcore.DebugLevel
		case InfoLevel:
			level = zapcore.InfoLevel
		case WarnLevel:
			level = zapcore.WarnLevel
		case ErrorLevel:
			level = zapcore.ErrorLevel
		default:
			level = zapcore.DebugLevel // 默认使用 Debug 级别
		}

		// 配置编码器
		encoderConfig := zapcore.EncoderConfig{
			TimeKey:        "timestamp",
			LevelKey:       "level",
			NameKey:        "logger",
			CallerKey:      "caller",
			MessageKey:     "msg",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.LowercaseLevelEncoder,  // 使用小写字母表示日志级别
			EncodeTime:     zapcore.RFC3339TimeEncoder,     // 使用 RFC3339 时间格式
			EncodeDuration: zapcore.StringDurationEncoder,  // 使用字符串表示持续时间
			EncodeCaller:   zapcore.ShortCallerEncoder,     // 使用短格式的调用者信息
		}

		// 创建控制台输出 - 使用JSON格式
		consoleEncoder := zapcore.NewJSONEncoder(encoderConfig)
		consoleCore := zapcore.NewCore(
			consoleEncoder,
			zapcore.AddSync(os.Stdout),
			level,
		)

		// 创建文件输出
		var fileCore zapcore.Core
		if config.OutputPath != "" {
			// 确保日志目录存在
			if err := os.MkdirAll(filepath.Dir(config.OutputPath), 0755); err != nil {
				panic(err)
			}

			// 使用 lumberjack 进行日志轮转
			fileWriter := zapcore.AddSync(&lumberjack.Logger{
				Filename:   config.OutputPath,
				MaxSize:    config.MaxSize,
				MaxBackups: config.MaxBackups,
				MaxAge:     config.MaxAge,
				Compress:   config.Compress,
			})

			// 使用 JSON 格式写入文件
			fileEncoder := zapcore.NewJSONEncoder(encoderConfig)
			fileCore = zapcore.NewCore(
				fileEncoder,
				fileWriter,
				level,
			)
		}

		// 合并多个输出
		var core zapcore.Core
		if fileCore != nil {
			core = zapcore.NewTee(consoleCore, fileCore)
		} else {
			core = consoleCore
		}

		// 创建 logger
		globalLogger = zap.New(core,
			zap.AddCaller(),                       // 添加调用者信息
			zap.AddStacktrace(zapcore.ErrorLevel), // 在错误级别添加堆栈跟踪
			zap.Development(),                     // 开发模式，提供更多调试信息
		)
	})
}

// Debug 输出调试级别日志
func Debug(msg string, fields ...zap.Field) {
	if globalLogger != nil {
		globalLogger.Debug(msg, fields...)
	}
}

// Info 输出信息级别日志
func Info(msg string, fields ...zap.Field) {
	if globalLogger != nil {
		globalLogger.Info(msg, fields...)
	}
}

// Warn 输出警告级别日志
func Warn(msg string, fields ...zap.Field) {
	if globalLogger != nil {
		globalLogger.Warn(msg, fields...)
	}
}

// Error 输出错误级别日志
func Error(msg string, fields ...zap.Field) {
	if globalLogger != nil {
		globalLogger.Error(msg, fields...)
	}
}

// Fatal 输出致命错误级别日志并退出程序
func Fatal(msg string, fields ...zap.Field) {
	if globalLogger != nil {
		globalLogger.Fatal(msg, fields...)
	}
}

// 辅助函数，用于创建字段
func String(key string, val string) zap.Field {
	return zap.String(key, val)
}

func Int(key string, val int) zap.Field {
	return zap.Int(key, val)
}

func Int64(key string, val int64) zap.Field {
	return zap.Int64(key, val)
}

func Float64(key string, val float64) zap.Field {
	return zap.Float64(key, val)
}

func Bool(key string, val bool) zap.Field {
	return zap.Bool(key, val)
}

// ErrorField 创建错误字段
func ErrorField(err error) zap.Field {
	return zap.Error(err)
}

func Any(key string, val interface{}) zap.Field {
	return zap.Any(key, val)
}

// Duration 创建持续时间字段
func Duration(key string, val time.Duration) zap.Field {
	return zap.Duration(key, val)
}
