package cmd

import (
	"fmt"
	"log"
	"os"

	"Bt1QFM/internal/server"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "1qfm_server",
	Short: "1QFM is a personal FM radio service.",
	Run: func(cmd *cobra.Command, args []string) {
		log.Println("Starting 1QFM server...")
		// server.Start now handles its own port and logging for startup.
		server.Start()
	},
}

// Execute executes the root command.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
