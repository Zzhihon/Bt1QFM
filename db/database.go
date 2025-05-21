package db

import (
	"database/sql"
	"fmt"
	"log"
	"strings" // Added for checking alter table error

	"Bt1QFM/core/auth" // Added for password hashing
	"Bt1QFM/config"

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

// InitDB initializes the database schema, creating tables if they don't exist,
// and performs necessary data migrations.
func InitDB() error {
	if err := createUsersTable(); err != nil {
		return err
	}
	if err := alterTracksTableAddUserID(); err != nil {
		// It's possible the column already exists, especially during development.
		// A more robust migration system would handle this more gracefully.
		// For now, we check for a common error string.
		if !strings.Contains(err.Error(), "Duplicate column name") && !strings.Contains(err.Error(), "already exists") {
			return err
		}
		log.Println("Column 'user_id' likely already exists in 'tracks' table or other alter error:", err)
	}
	if err := createTracksTable(); err != nil { // Ensures tracks table exists, potentially with new structure if it was just altered
		return err
	}

	if err := migrateInitialUserAndTracks(); err != nil {
		return err
	}

	log.Println("Database initialization and migration completed.")
	return nil
}

func createUsersTable() error {
	query := `
	CREATE TABLE IF NOT EXISTS users (
		id INT AUTO_INCREMENT PRIMARY KEY,
		username VARCHAR(100) NOT NULL UNIQUE,
		email VARCHAR(255) NOT NULL UNIQUE,
		password_hash VARCHAR(255) NOT NULL,
		phone VARCHAR(20),
		preferences TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	);
	`
	_, err := DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}
	log.Println("Users table initialized successfully (or already exists).")
	return nil
}

func createTracksTable() error {
	// This function now primarily ensures the table exists.
	// The user_id column and FK constraint are added by alterTracksTableAddUserID.
	// The UNIQUE constraint on file_path is modified there as well.
	query := `
	CREATE TABLE IF NOT EXISTS tracks (
		id INT AUTO_INCREMENT PRIMARY KEY,
		title VARCHAR(255) NOT NULL,
		artist VARCHAR(255),
		album VARCHAR(255),
		file_path VARCHAR(767) NOT NULL, 
		cover_art_path VARCHAR(767),
		hls_playlist_path VARCHAR(767),
		duration FLOAT,
		user_id INT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		CONSTRAINT fk_user_tracks FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		CONSTRAINT uq_user_filepath UNIQUE (user_id, file_path)
	);
	`
	// Attempt to remove old unique constraint if it exists, before creating the new one.
	// This is a best-effort for development and might fail if table is new or constraint name is different.
	// A proper migration tool would handle this more robustly.
	_, err := DB.Exec("ALTER TABLE tracks DROP INDEX file_path;")
	if err != nil {
		log.Printf("Could not drop old unique constraint on file_path (may not exist or different name): %v", err)
	}

	_, err = DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create/update tracks table: %w", err)
	}

	log.Println("Tracks table structure ensured/updated (or already exists with new structure).")
	return nil
}

func alterTracksTableAddUserID() error {
	// Check if user_id column exists
	var columnExists bool
	err := DB.QueryRow("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracks' AND COLUMN_NAME = 'user_id'").Scan(&columnExists)
	if err != nil {
		return fmt.Errorf("failed to check if user_id column exists: %w", err)
	}

	if !columnExists {
		alterQuery := `ALTER TABLE tracks ADD COLUMN user_id INT;`
		_, err = DB.Exec(alterQuery)
		if err != nil {
			return fmt.Errorf("failed to add user_id column to tracks table: %w", err)
		}
		log.Println("Column 'user_id' added to 'tracks' table.")
	} else {
		log.Println("Column 'user_id' already exists in 'tracks' table.")
	}

	// Note: Foreign key and unique constraint (user_id, file_path) are now part of createTracksTable
	// because CREATE TABLE IF NOT EXISTS is safer for defining these.
	// If we alter them here, we need more complex logic to drop/add them conditionally.
	// The initial createTracksTable might have created a simple file_path UNIQUE constraint.
	// We will try to drop it and the createTracksTable will add the composite one.
	return nil
}

func migrateInitialUserAndTracks() error {
	// 1. Create 'bt1q' user
	username := "bt1q"
	email := "bt1q@tatakal.com"
	phone := "13434206007"
	password := "qweasd2417" // Temporary password

	hashedPassword, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("failed to hash password for initial user: %w", err)
	}

	// Check if user 'bt1q' already exists
	var existingUserID int64
	err = DB.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&existingUserID)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("failed to check for existing user 'bt1q': %w", err)
	}

	var userIDToAssign int64
	if err == sql.ErrNoRows { // User does not exist, create them
		res, err := DB.Exec("INSERT INTO users (username, email, password_hash, phone) VALUES (?, ?, ?, ?)",
			username, email, hashedPassword, phone)
		if err != nil {
			return fmt.Errorf("failed to insert initial user 'bt1q': %w", err)
		}
		userIDToAssign, err = res.LastInsertId()
		if err != nil {
			return fmt.Errorf("failed to get ID of newly inserted user 'bt1q': %w", err)
		}
		log.Printf("Initial user 'bt1q' created with ID: %d", userIDToAssign)
	} else { // User 'bt1q' already exists
		userIDToAssign = existingUserID
		log.Printf("Initial user 'bt1q' already exists with ID: %d. Skipping creation.", userIDToAssign)
	}

	// 2. Update existing tracks to belong to this user (user_id = userIDToAssign)
	// Only update tracks where user_id IS NULL to avoid re-assigning if script runs multiple times
	// or if some tracks somehow already have a user_id.
	updateRes, err := DB.Exec("UPDATE tracks SET user_id = ? WHERE user_id IS NULL", userIDToAssign)
	if err != nil {
		return fmt.Errorf("failed to update existing tracks for user ID %d: %w", userIDToAssign, err)
	}
	rowsAffected, _ := updateRes.RowsAffected()
	log.Printf("%d existing tracks (with NULL user_id) assigned to user ID %d.", rowsAffected, userIDToAssign)

	return nil
}
