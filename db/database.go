package db

import (
	"database/sql"
	"fmt"
	"log"

	// Added for checking alter table error
	"Bt1QFM/config"
	"Bt1QFM/core/auth" // Added for password hashing

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
	// 按顺序创建表（如果不存在）
	if err := createUsersTable(); err != nil {
		return err
	}
	if err := createTracksTable(); err != nil {
		return err
	}
	if err := createAlbumsTable(); err != nil {
		return err
	}
	if err := createAlbumTracksTable(); err != nil {
		return err
	}

	// 检查是否需要迁移初始用户数据
	if err := migrateInitialUserAndTracks(); err != nil {
		return err
	}

	log.Println("Database initialization and migration completed.")
	return nil
}

func createUsersTable() error {
	query := `
	CREATE TABLE IF NOT EXISTS users (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		username VARCHAR(100) NOT NULL UNIQUE,
		email VARCHAR(255) NOT NULL UNIQUE,
		password_hash VARCHAR(255) NOT NULL,
		phone VARCHAR(20),
		preferences TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	`
	_, err := DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}
	log.Println("Users table initialized successfully.")
	return nil
}

func createTracksTable() error {
	query := `
	CREATE TABLE IF NOT EXISTS tracks (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		title VARCHAR(255) NOT NULL,
		artist VARCHAR(255),
		album VARCHAR(255),
		file_path VARCHAR(255) NOT NULL, 
		cover_art_path VARCHAR(255),
		hls_playlist_path VARCHAR(255),
		duration FLOAT,
		user_id BIGINT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		CONSTRAINT fk_user_tracks FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		CONSTRAINT uq_user_filepath UNIQUE (user_id, file_path)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	`
	_, err := DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create tracks table: %w", err)
	}
	log.Println("Tracks table initialized successfully.")
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
		alterQuery := `ALTER TABLE tracks ADD COLUMN user_id BIGINT;`
		_, err = DB.Exec(alterQuery)
		if err != nil {
			return fmt.Errorf("failed to add user_id column to tracks table: %w", err)
		}
		log.Println("Column 'user_id' added to 'tracks' table.")
	} else {
		log.Println("Column 'user_id' already exists in 'tracks' table.")
	}

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

// createAlbumsTable 创建专辑表
func createAlbumsTable() error {
	query := `
	CREATE TABLE IF NOT EXISTS albums (
		id BIGINT PRIMARY KEY AUTO_INCREMENT,
		user_id BIGINT NOT NULL,
		artist VARCHAR(255) NOT NULL,
		name VARCHAR(255) NOT NULL,
		cover_path VARCHAR(255),
		release_time DATETIME,
		genre VARCHAR(100),
		description TEXT,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		INDEX idx_user_id (user_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	`
	_, err := DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create albums table: %w", err)
	}
	log.Println("Albums table initialized successfully.")
	return nil
}

// createAlbumTracksTable 创建专辑歌曲关联表
func createAlbumTracksTable() error {
	query := `
	CREATE TABLE IF NOT EXISTS album_tracks (
		id BIGINT PRIMARY KEY AUTO_INCREMENT,
		album_id BIGINT NOT NULL,
		track_id BIGINT NOT NULL,
		position INT NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
		FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
		UNIQUE KEY unique_album_track (album_id, track_id),
		INDEX idx_album_id (album_id),
		INDEX idx_track_id (track_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	`
	_, err := DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create album_tracks table: %w", err)
	}
	log.Println("Album tracks table initialized successfully.")
	return nil
}
