package main

import (
	"Bt1QFM/cmd"
	"log"
)

func main() {
	cmd.Execute()
	// If Execute() had a problem, Cobra would have called os.Exit.
	// If we reach here, it means the Cobra command completed successfully
	// (or a long-running server started without error during setup).
	log.Println("Application command execution finished or server started.")
}
