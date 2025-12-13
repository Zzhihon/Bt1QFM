package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"Bt1QFM/model"
)

// ChatRepository defines the interface for chat data operations.
type ChatRepository interface {
	// Session operations
	GetOrCreateSession(userID int64) (*model.ChatSession, error)
	GetSessionByUserID(userID int64) (*model.ChatSession, error)
	DeleteSession(sessionID int64) error

	// Message operations
	CreateMessage(message *model.ChatMessage) (int64, error)
	GetMessagesBySessionID(sessionID int64, limit int) ([]*model.ChatMessage, error)
	DeleteMessagesBySessionID(sessionID int64) error
}

// mysqlChatRepository implements ChatRepository for MySQL.
type mysqlChatRepository struct {
	db *sql.DB
}

// NewMySQLChatRepository creates a new mysqlChatRepository.
func NewMySQLChatRepository(db *sql.DB) ChatRepository {
	return &mysqlChatRepository{db: db}
}

// GetOrCreateSession gets an existing session for a user or creates a new one.
func (r *mysqlChatRepository) GetOrCreateSession(userID int64) (*model.ChatSession, error) {
	// First, try to get existing session
	session, err := r.GetSessionByUserID(userID)
	if err != nil {
		return nil, err
	}
	if session != nil {
		return session, nil
	}

	// Create new session
	query := "INSERT INTO chat_sessions (user_id, title) VALUES (?, '音乐助手')"
	stmt, err := r.db.Prepare(query)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare create session statement: %w", err)
	}
	defer stmt.Close()

	res, err := stmt.Exec(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to execute create session statement: %w", err)
	}

	sessionID, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID for session: %w", err)
	}

	// Fetch and return the created session
	return r.getSessionByID(sessionID)
}

// GetSessionByUserID retrieves a session by user ID.
func (r *mysqlChatRepository) GetSessionByUserID(userID int64) (*model.ChatSession, error) {
	query := "SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE user_id = ?"
	row := r.db.QueryRow(query, userID)

	session := &model.ChatSession{}
	err := row.Scan(&session.ID, &session.UserID, &session.Title, &session.CreatedAt, &session.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // Session not found
		}
		return nil, fmt.Errorf("failed to scan session row for user ID %d: %w", userID, err)
	}
	return session, nil
}

// getSessionByID retrieves a session by its ID.
func (r *mysqlChatRepository) getSessionByID(sessionID int64) (*model.ChatSession, error) {
	query := "SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE id = ?"
	row := r.db.QueryRow(query, sessionID)

	session := &model.ChatSession{}
	err := row.Scan(&session.ID, &session.UserID, &session.Title, &session.CreatedAt, &session.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // Session not found
		}
		return nil, fmt.Errorf("failed to scan session row for ID %d: %w", sessionID, err)
	}
	return session, nil
}

// DeleteSession deletes a session and all its messages.
func (r *mysqlChatRepository) DeleteSession(sessionID int64) error {
	// Messages will be automatically deleted due to CASCADE
	query := "DELETE FROM chat_sessions WHERE id = ?"
	stmt, err := r.db.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare delete session statement: %w", err)
	}
	defer stmt.Close()

	_, err = stmt.Exec(sessionID)
	if err != nil {
		return fmt.Errorf("failed to execute delete session statement: %w", err)
	}
	return nil
}

// CreateMessage adds a new message to a session.
func (r *mysqlChatRepository) CreateMessage(message *model.ChatMessage) (int64, error) {
	// 将 songs 序列化为 JSON
	var songsJSON []byte
	var err error
	if len(message.Songs) > 0 {
		songsJSON, err = json.Marshal(message.Songs)
		if err != nil {
			return 0, fmt.Errorf("failed to marshal songs: %w", err)
		}
	}

	query := "INSERT INTO chat_messages (session_id, role, content, songs) VALUES (?, ?, ?, ?)"
	stmt, err := r.db.Prepare(query)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare create message statement: %w", err)
	}
	defer stmt.Close()

	res, err := stmt.Exec(message.SessionID, message.Role, message.Content, songsJSON)
	if err != nil {
		return 0, fmt.Errorf("failed to execute create message statement: %w", err)
	}

	messageID, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get last insert ID for message: %w", err)
	}

	// Update session's updated_at
	updateQuery := "UPDATE chat_sessions SET updated_at = NOW() WHERE id = ?"
	_, _ = r.db.Exec(updateQuery, message.SessionID)

	return messageID, nil
}

// GetMessagesBySessionID retrieves messages for a session with a limit.
func (r *mysqlChatRepository) GetMessagesBySessionID(sessionID int64, limit int) ([]*model.ChatMessage, error) {
	// Get the most recent messages, ordered by created_at ASC for conversation flow
	query := `
		SELECT id, session_id, role, content, songs, created_at
		FROM chat_messages
		WHERE session_id = ?
		ORDER BY created_at DESC
		LIMIT ?
	`

	rows, err := r.db.Query(query, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query messages for session ID %d: %w", sessionID, err)
	}
	defer rows.Close()

	var messages []*model.ChatMessage
	for rows.Next() {
		msg := &model.ChatMessage{}
		var songsJSON sql.NullString
		err := rows.Scan(&msg.ID, &msg.SessionID, &msg.Role, &msg.Content, &songsJSON, &msg.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan message row: %w", err)
		}

		// 解析 songs JSON
		if songsJSON.Valid && songsJSON.String != "" {
			if err := json.Unmarshal([]byte(songsJSON.String), &msg.Songs); err != nil {
				// 解析失败不阻断，只记录日志
				msg.Songs = nil
			}
		}

		messages = append(messages, msg)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating message rows: %w", err)
	}

	// Reverse the messages to get chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, nil
}

// DeleteMessagesBySessionID deletes all messages for a session.
func (r *mysqlChatRepository) DeleteMessagesBySessionID(sessionID int64) error {
	query := "DELETE FROM chat_messages WHERE session_id = ?"
	stmt, err := r.db.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare delete messages statement: %w", err)
	}
	defer stmt.Close()

	_, err = stmt.Exec(sessionID)
	if err != nil {
		return fmt.Errorf("failed to execute delete messages statement: %w", err)
	}
	return nil
}
