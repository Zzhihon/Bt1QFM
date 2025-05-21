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
	query := "INSERT INTO users (username, email, password_hash, phone, preferences) VALUES (?, ?, ?, ?, ?)"
	stmt, err := r.db.Prepare(query)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare create user statement: %w", err)
	}
	defer stmt.Close()

	res, err := stmt.Exec(user.Username, user.Email, user.PasswordHash, user.Phone, user.Preferences)
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
	query := "SELECT id, username, email, password_hash, phone, preferences, created_at, updated_at FROM users WHERE id = ?"
	row := r.db.QueryRow(query, id)
	user := &model.User{}
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Phone, &user.Preferences, &user.CreatedAt, &user.UpdatedAt)
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
	query := "SELECT id, username, email, password_hash, phone, preferences, created_at, updated_at FROM users WHERE username = ?"
	row := r.db.QueryRow(query, username)
	user := &model.User{}
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Phone, &user.Preferences, &user.CreatedAt, &user.UpdatedAt)
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
	query := "SELECT id, username, email, password_hash, phone, preferences, created_at, updated_at FROM users WHERE email = ?"
	row := r.db.QueryRow(query, email)
	user := &model.User{}
	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Phone, &user.Preferences, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // User not found
		}
		return nil, fmt.Errorf("failed to scan user row for email %s: %w", email, err)
	}
	return user, nil
}
