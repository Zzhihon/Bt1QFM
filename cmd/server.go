package cmd

import (
	"Bt1QFM/server"

	"github.com/spf13/cobra"
)

var serverCmd = &cobra.Command{
	Use:   "server",
	Short: "启动1QFM服务器",
	Long:  `启动1QFM音乐系统的HTTP服务器，提供API服务和Web界面`,
	Run: func(cmd *cobra.Command, args []string) {
		server.Start()
	},
}

func init() {
	rootCmd.AddCommand(serverCmd)
}
