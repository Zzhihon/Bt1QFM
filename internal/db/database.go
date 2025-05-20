package db

import (
	"database/sql"
	"fmt"
	"log"

	"Bt1QFM/internal/config"

	_ "github.com/go-sql-driver/mysql" // MySQL driver
)

var DB *sql.DB

// ConnectDB establishes a connection to the database.
func ConnectDB(cfg *config.Config) error {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)

	var err error
	DB, err = sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database connection: %w", err)
	}

	if err = DB.Ping(); err != nil {
		DB.Close()
		return fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("Successfully connected to the database.")
	return nil
}

// InitDB initializes the database schema, creating tables if they don't exist.
func InitDB() error {
	query := `
	CREATE TABLE IF NOT EXISTS tracks (
		id INT AUTO_INCREMENT PRIMARY KEY,
		title VARCHAR(255) NOT NULL,
		artist VARCHAR(255),
		album VARCHAR(255),
		file_path VARCHAR(767) NOT NULL UNIQUE, -- Path to the original audio file
		cover_art_path VARCHAR(767),          -- Path to the cover art image
		hls_playlist_path VARCHAR(767),       -- Path to the HLS m3u8 file
		duration FLOAT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	);
	`
	_, err := DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create tracks table: %w", err)
	}

	log.Println("Tracks table initialized successfully (or already exists).")
	return nil
}
