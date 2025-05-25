package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "1qfm",
	Short: "1QFM音乐系统",
	Long:  `1QFM音乐系统命令行工具`,
}

func init() {
	rootCmd.AddCommand(neteaseCmd)
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
