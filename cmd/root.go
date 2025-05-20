package cmd

import (
	"Bt1QFM/internal/server"
	"fmt"
)

// For now, we'll directly call server start. Later, Cobra can be integrated.
func Execute() error {
	fmt.Println("Starting Bt1QFM Server...")
	// Define a port, can be moved to config later
	port := ":8080"
	return server.Start(port)
}
