package logger

import (
	"os"
	"sync"

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
			level = zapcore.InfoLevel
		}

		// 配置编码器
		encoderConfig := zapcore.EncoderConfig{
			TimeKey:        "time",
			LevelKey:       "level",
			NameKey:        "logger",
			CallerKey:      "caller",
			MessageKey:     "msg",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.LowercaseLevelEncoder,
			EncodeTime:     zapcore.ISO8601TimeEncoder,
			EncodeDuration: zapcore.SecondsDurationEncoder,
			EncodeCaller:   zapcore.ShortCallerEncoder,
		}

		// 配置输出
		var writeSyncer zapcore.WriteSyncer
		if config.OutputPath != "" {
			// 使用 lumberjack 进行日志轮转
			writeSyncer = zapcore.AddSync(&lumberjack.Logger{
				Filename:   config.OutputPath,
				MaxSize:    config.MaxSize,
				MaxBackups: config.MaxBackups,
				MaxAge:     config.MaxAge,
				Compress:   config.Compress,
			})
		} else {
			writeSyncer = zapcore.AddSync(os.Stdout)
		}

		// 创建核心
		core := zapcore.NewCore(
			zapcore.NewJSONEncoder(encoderConfig),
			writeSyncer,
			level,
		)

		// 创建 logger
		globalLogger = zap.New(core, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))
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
