package db

import (
	"fmt"
	"log"
	"time"

	"Bt1QFM/config"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// GormDB 是 GORM 数据库连接实例
// 与现有的 DB (*sql.DB) 并存，用于新模块的开发
var GormDB *gorm.DB

// ConnectGormDB 建立 GORM 数据库连接
// 此函数独立于 ConnectDB，确保向后兼容
func ConnectGormDB(cfg *config.Config) error {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)

	var err error
	GormDB, err = gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
		// 禁用外键约束
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return fmt.Errorf("failed to connect database with GORM: %w", err)
	}

	// 获取底层的 sql.DB 并配置连接池
	sqlDB, err := GormDB.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	// 设置连接池参数
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	log.Println("Successfully connected to the database with GORM.")
	return nil
}

// CloseGormDB 关闭 GORM 数据库连接
func CloseGormDB() error {
	if GormDB == nil {
		return nil
	}

	sqlDB, err := GormDB.DB()
	if err != nil {
		return err
	}

	return sqlDB.Close()
}

// AutoMigrateModels 自动迁移指定的模型
// 传入需要迁移的模型指针
func AutoMigrateModels(models ...interface{}) error {
	if GormDB == nil {
		return fmt.Errorf("GORM database not initialized")
	}

	err := GormDB.AutoMigrate(models...)
	if err != nil {
		return fmt.Errorf("failed to auto migrate models: %w", err)
	}

	log.Println("Models migrated successfully with GORM.")
	return nil
}
