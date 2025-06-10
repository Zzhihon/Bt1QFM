package repository

import (
	"database/sql"
	"fmt"

	"Bt1QFM/model"
)

// UserRepository defines the interface for user data operations.
type UserRepository interface {
	CreateUser(user *model.User) (int64, error)
	GetUserByID(id int64) (*model.User, error)
	GetUserByUsername(username string) (*model.User, error)
	GetUserByEmail(email string) (*model.User, error)
	UpdateNeteaseInfo(userID int64, neteaseUsername, neteaseUID string) error
}

// mysqlUserRepository implements UserRepository for MySQL.
type mysqlUserRepository struct {
	db *sql.DB
}

// NewMySQLUserRepository creates a new mysqlUserRepository.
func NewMySQLUserRepository(db *sql.DB) UserRepository {
	return &mysqlUserRepository{db: db}
}

// CreateUser adds a new user to the database.
func (r *mysqlUserRepository) CreateUser(user *model.User) (int64, error) {
	query := "INSERT INTO users (username, email, password_hash, phone, preferences, netease_username, netease_uid) VALUES (?, ?, ?, ?, ?, ?, ?)"
	stmt, err := r.db.Prepare(query)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare create user statement: %w", err)
	}
	defer stmt.Close()

	res, err := stmt.Exec(user.Username, user.Email, user.PasswordHash, user.Phone, user.Preferences, user.NeteaseUsername, user.NeteaseUID)
	if err != nil {
		return 0, fmt.Errorf("failed to execute create user statement: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get last insert ID for user: %w", err)
	}
	return id, nil
}

// GetUserByID retrieves a user by their ID.
func (r *mysqlUserRepository) GetUserByID(id int64) (*model.User, error) {
	query := "SELECT id, username, email, password_hash, phone, preferences, netease_username, netease_uid, created_at, updated_at FROM users WHERE id = ?"
	row := r.db.QueryRow(query, id)
	user := &model.User{}
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Phone, &user.Preferences, &user.NeteaseUsername, &user.NeteaseUID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // User not found
		}
		return nil, fmt.Errorf("failed to scan user row for ID %d: %w", id, err)
	}
	return user, nil
}

// GetUserByUsername retrieves a user by their username.
func (r *mysqlUserRepository) GetUserByUsername(username string) (*model.User, error) {
	query := "SELECT id, username, email, password_hash, phone, preferences, netease_username, netease_uid, created_at, updated_at FROM users WHERE username = ?"
	row := r.db.QueryRow(query, username)
	user := &model.User{}
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Phone, &user.Preferences, &user.NeteaseUsername, &user.NeteaseUID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // User not found
		}
		return nil, fmt.Errorf("failed to scan user row for username %s: %w", username, err)
	}
	return user, nil
}

// GetUserByEmail retrieves a user by their email address.
func (r *mysqlUserRepository) GetUserByEmail(email string) (*model.User, error) {
	query := "SELECT id, username, email, password_hash, phone, preferences, netease_username, netease_uid, created_at, updated_at FROM users WHERE email = ?"
	row := r.db.QueryRow(query, email)
	user := &model.User{}
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Phone, &user.Preferences, &user.NeteaseUsername, &user.NeteaseUID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // User not found
		}
		return nil, fmt.Errorf("failed to scan user row for email %s: %w", email, err)
	}
	return user, nil
}

// UpdateNeteaseInfo updates user's netease username and UID.
func (r *mysqlUserRepository) UpdateNeteaseInfo(userID int64, neteaseUsername, neteaseUID string) error {
	query := "UPDATE users SET netease_username = ?, netease_uid = ?, updated_at = NOW() WHERE id = ?"
	stmt, err := r.db.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare update netease info statement: %w", err)
	}
	defer stmt.Close()

	var neteaseUsernameNull, neteaseUIDNull sql.NullString
	if neteaseUsername != "" {
		neteaseUsernameNull = sql.NullString{String: neteaseUsername, Valid: true}
	}
	if neteaseUID != "" {
		neteaseUIDNull = sql.NullString{String: neteaseUID, Valid: true}
	}

	_, err = stmt.Exec(neteaseUsernameNull, neteaseUIDNull, userID)
	if err != nil {
		return fmt.Errorf("failed to execute update netease info statement: %w", err)
	}
	return nil
}
