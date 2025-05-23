package cmd

import (
	"fmt"
	"log"

	"Bt1QFM/config"
	"Bt1QFM/storage"

	"github.com/spf13/cobra"
)

var (
	minioPrefix    string
	minioStats     bool
	minioRecursive bool
	minioDelete    bool
)

var minioCmd = &cobra.Command{
	Use:   "minio",
	Short: "MinIO存储桶管理",
	Long:  `查看和管理MinIO存储桶中的文件，支持列出文件、查看统计信息、递归显示目录结构、删除目录等功能。`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("开始连接MinIO服务器...")

		// 加载配置
		cfg := config.Load()
		fmt.Printf("MinIO配置: %s, Bucket: %s\n", cfg.MinioEndpoint, cfg.MinioBucket)

		// 初始化MinIO客户端
		if err := storage.InitMinio(); err != nil {
			log.Fatalf("无法连接到MinIO: %v", err)
		}
		fmt.Println("MinIO连接成功！")

		// 创建MinIO客户端
		client, err := storage.NewMinioClient(
			cfg.MinioEndpoint,
			cfg.MinioAccessKey,
			cfg.MinioSecretKey,
			cfg.MinioBucket,
			cfg.MinioUseSSL,
		)
		if err != nil {
			log.Fatalf("创建MinIO客户端失败: %v", err)
		}

		// 根据参数执行不同的操作
		if minioDelete {
			// 删除目录
			if minioPrefix == "" {
				log.Fatal("删除操作需要指定目录前缀")
			}
			fmt.Printf("\n删除目录: %s\n", minioPrefix)
			if err := client.DeleteDirectory(minioPrefix); err != nil {
				log.Fatalf("删除目录失败: %v", err)
			}
		} else if minioRecursive {
			// 递归显示目录结构
			fmt.Printf("\n递归显示目录结构 (前缀: %s)...\n", minioPrefix)
			if err := client.ListObjectsRecursive(minioPrefix); err != nil {
				log.Fatalf("显示目录结构失败: %v", err)
			}
		} else if minioStats {
			// 显示存储桶统计信息
			fmt.Println("\n获取存储桶统计信息...")
			if err := client.PrintBucketStats(); err != nil {
				log.Fatalf("获取存储桶统计信息失败: %v", err)
			}
		} else {
			// 列出文件
			fmt.Printf("\n列出存储桶中的文件 (前缀: %s)...\n", minioPrefix)
			if err := client.ListObjects(); err != nil {
				log.Fatalf("列出文件失败: %v", err)
			}
		}

		fmt.Println("\nMinIO操作完成！")
	},
}

func init() {
	rootCmd.AddCommand(minioCmd)

	// 添加命令行参数
	minioCmd.Flags().StringVarP(&minioPrefix, "prefix", "p", "", "按前缀过滤文件或指定要操作的目录")
	minioCmd.Flags().BoolVarP(&minioStats, "stats", "s", false, "显示存储桶统计信息")
	minioCmd.Flags().BoolVarP(&minioRecursive, "recursive", "r", false, "递归显示目录结构")
	minioCmd.Flags().BoolVarP(&minioDelete, "delete", "d", false, "删除指定目录及其下的所有文件")

	// 添加使用说明
	minioCmd.Example = `  # 列出所有文件
  1qfm_server minio

  # 按前缀过滤文件
  1qfm_server minio -p "music/"

  # 显示存储桶统计信息
  1qfm_server minio -s

  # 递归显示目录结构
  1qfm_server minio -r -p "music/"

  # 删除目录及其下的所有文件
  1qfm_server minio -d -p "music/"

  # 同时使用多个选项
  1qfm_server minio -p "music/" -s -r`
}
