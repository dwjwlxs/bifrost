package bifrost

import (
	"context"
	"os"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	gormLibLogger "gorm.io/gorm/logger"
)

// GormLogger is a logger for GORM.
type gormLogger struct {
	logger schemas.Logger
	level  schemas.LogLevel
}

// LogMode sets the log mode for the logger.
func (l *gormLogger) LogMode(level gormLibLogger.LogLevel) gormLibLogger.Interface {
	var lvl schemas.LogLevel
	switch level {
	case gormLibLogger.Silent:
		lvl = schemas.LogLevel("")
	case gormLibLogger.Error:
		lvl = schemas.LogLevelError
	case gormLibLogger.Warn:
		lvl = schemas.LogLevelWarn
	case gormLibLogger.Info:
		lvl = schemas.LogLevelInfo
	case 5:
		lvl = schemas.LogLevelDebug
	default:
	}
	l.level = lvl
	l.logger.SetLevel(lvl)
	return l
}

// Info logs an info message.
func (l *gormLogger) Info(ctx context.Context, msg string, data ...interface{}) {
	if string(l.level) == "" {
		return
	}
	l.logger.Info(msg, data...)
}

// Warn logs a warning message.
func (l *gormLogger) Warn(ctx context.Context, msg string, data ...interface{}) {
	if string(l.level) == "" {
		return
	}
	l.logger.Warn(msg, data...)
}

// Error logs an error message.
func (l *gormLogger) Error(ctx context.Context, msg string, data ...interface{}) {
	if string(l.level) == "" {
		return
	}
	l.logger.Error(msg, data...)
}

// Trace logs a trace message.
func (l *gormLogger) Trace(ctx context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	if string(l.level) == "" {
		return
	}
	sql, rows := fc()
	if err != nil {
		l.logger.Error("sql: %v; rows: %v; error: %v", sql, rows, err)
	} else {
		l.logger.Debug("sql: %v; rows: %v", sql, rows)
	}
}

// newGormLogger creates a new GormLogger.
func newGormLogger(l schemas.Logger) *gormLogger {
	gl := &gormLogger{logger: l}
	switch os.Getenv("LOG_LEVEL") {
	case "trace", "debug":
		gl.LogMode(gormLibLogger.LogLevel(5))
	case "info":
		gl.LogMode(gormLibLogger.Info)
	case "warn":
		gl.LogMode(gormLibLogger.Warn)
	case "error":
		gl.LogMode(gormLibLogger.Error)
	default:
		gl.LogMode(gormLibLogger.Silent)
	}

	return gl
}

func NewGormLogger(l schemas.Logger) *gormLogger {
	return newGormLogger(l)
}
