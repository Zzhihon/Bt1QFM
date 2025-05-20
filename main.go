package main

import (
	"Bt1QFM/cmd"
	"log"
)

func main() {
	if err := cmd.Execute(); err != nil {
		log.Fatalf("Error starting application: %v", err)
	}
}
