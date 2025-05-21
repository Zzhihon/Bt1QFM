package cmd

import (
	"fmt"
	"log"

	"Bt1QFM/config"
	"Bt1QFM/db"

	"github.com/spf13/cobra"
)

var redisCmd = &cobra.Command{
	Use:   "redis",
	Short: "Redis连接测试",
	Long:  `测试Redis连接是否成功，并进行基本读写操作。`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("开始测试Redis连接...")
		
		// 加载配置
		cfg := config.Load()
		fmt.Printf("Redis配置: %s:%s, DB: %d\n", cfg.RedisHost, cfg.RedisPort, cfg.RedisDB)
		
		// 连接Redis
		if err := db.ConnectRedis(cfg); err != nil {
			log.Fatalf("无法连接到Redis: %v", err)
		}
		fmt.Println("Redis连接成功！")
		
		// 测试Redis基本操作
		fmt.Println("开始测试Redis基本操作...")
		if err := db.TestRedis(); err != nil {
			log.Fatalf("Redis操作测试失败: %v", err)
		}
		fmt.Println("Redis基本操作测试成功！")
		
		// 关闭连接
		if err := db.CloseRedis(); err != nil {
			log.Printf("关闭Redis连接时发生错误: %v", err)
		}
		fmt.Println("Redis测试完成，连接已关闭。")
	},
}

func init() {
	rootCmd.AddCommand(redisCmd)
}