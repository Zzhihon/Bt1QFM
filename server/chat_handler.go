package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"Bt1QFM/core/agent"
	"Bt1QFM/core/auth"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"

	"github.com/gorilla/websocket"
)

// ChatHandler handles chat-related HTTP requests.
type ChatHandler struct {
	chatRepo    repository.ChatRepository
	musicAgent  *agent.MusicAgent
	upgrader    websocket.Upgrader
	connections sync.Map // map[int64]*websocket.Conn - userID to connection
}

const (
	// WebSocket 配置
	writeWait      = 10 * time.Second    // 写入超时
	pongWait       = 60 * time.Second    // 等待 pong 响应超时
	pingPeriod     = (pongWait * 9) / 10 // ping 间隔 (必须小于 pongWait)
	maxMessageSize = 8192                // 最大消息大小
)

// NewChatHandler creates a new ChatHandler.
func NewChatHandler(chatRepo repository.ChatRepository, agentConfig *agent.MusicAgentConfig) *ChatHandler {
	return &ChatHandler{
		chatRepo:   chatRepo,
		musicAgent: agent.NewMusicAgent(agentConfig),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for now
			},
		},
	}
}

// GetChatHistoryHandler returns the chat history for the current user.
func (h *ChatHandler) GetChatHistoryHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get or create session
	session, err := h.chatRepo.GetOrCreateSession(userID)
	if err != nil {
		logger.Error("Failed to get or create session",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Get messages (limit to 50 for context)
	messages, err := h.chatRepo.GetMessagesBySessionID(session.ID, 50)
	if err != nil {
		logger.Error("Failed to get messages",
			logger.Int64("sessionID", session.ID),
			logger.ErrorField(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	response := model.ChatHistoryResponse{
		Session:  session,
		Messages: messages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ClearChatHistoryHandler clears the chat history for the current user.
func (h *ChatHandler) ClearChatHistoryHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	session, err := h.chatRepo.GetSessionByUserID(userID)
	if err != nil {
		logger.Error("Failed to get session",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if session == nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "No history to clear"})
		return
	}

	// Delete all messages but keep the session
	if err := h.chatRepo.DeleteMessagesBySessionID(session.ID); err != nil {
		logger.Error("Failed to delete messages",
			logger.Int64("sessionID", session.ID),
			logger.ErrorField(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	logger.Info("Chat history cleared",
		logger.Int64("userID", userID),
		logger.Int64("sessionID", session.ID))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Chat history cleared"})
}

// WebSocketChatHandler handles WebSocket connections for streaming chat.
func (h *ChatHandler) WebSocketChatHandler(w http.ResponseWriter, r *http.Request) {
	// Extract user info from query params (token validation)
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Token required", http.StatusUnauthorized)
		return
	}

	// Validate token and get user ID using auth package
	claims, err := auth.ParseToken(token)
	if err != nil {
		logger.Warn("Invalid WebSocket token", logger.ErrorField(err))
		http.Error(w, "Invalid token", http.StatusUnauthorized)
		return
	}
	userID := claims.UserID

	// Upgrade to WebSocket
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("Failed to upgrade WebSocket",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		return
	}

	// Configure connection
	conn.SetReadLimit(maxMessageSize)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Store connection
	h.connections.Store(userID, conn)
	defer func() {
		h.connections.Delete(userID)
		conn.Close()
	}()

	logger.Info("WebSocket connected",
		logger.Int64("userID", userID))

	// Get or create session
	session, err := h.chatRepo.GetOrCreateSession(userID)
	if err != nil {
		logger.Error("Failed to get or create session",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		h.sendWebSocketError(conn, "Failed to initialize chat session")
		return
	}

	// Start ping goroutine to keep connection alive
	done := make(chan struct{})
	go h.pingLoop(conn, done)
	defer close(done)

	// Handle messages
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
				logger.Warn("WebSocket unexpected close",
					logger.Int64("userID", userID),
					logger.ErrorField(err))
			}
			break
		}

		// Reset read deadline after receiving message
		conn.SetReadDeadline(time.Now().Add(pongWait))

		// Parse message
		var msgReq model.ChatMessageRequest
		if err := json.Unmarshal(message, &msgReq); err != nil {
			h.sendWebSocketError(conn, "Invalid message format")
			continue
		}

		if msgReq.Content == "" {
			h.sendWebSocketError(conn, "Message content is required")
			continue
		}

		// Process the message
		h.handleChatMessage(conn, session, userID, msgReq.Content)
	}
}

// pingLoop sends periodic pings to keep the connection alive.
func (h *ChatHandler) pingLoop(conn *websocket.Conn, done chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

// handleChatMessage processes a chat message and streams the response.
func (h *ChatHandler) handleChatMessage(conn *websocket.Conn, session *model.ChatSession, userID int64, content string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Save user message
	userMsg := &model.ChatMessage{
		SessionID: session.ID,
		Role:      "user",
		Content:   content,
	}
	userMsgID, err := h.chatRepo.CreateMessage(userMsg)
	if err != nil {
		logger.Error("Failed to save user message",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		h.sendWebSocketError(conn, "Failed to save message")
		return
	}
	userMsg.ID = userMsgID
	userMsg.CreatedAt = time.Now()

	// Get history for context
	history, err := h.chatRepo.GetMessagesBySessionID(session.ID, 50)
	if err != nil {
		logger.Error("Failed to get history",
			logger.Int64("sessionID", session.ID),
			logger.ErrorField(err))
		h.sendWebSocketError(conn, "Failed to load chat history")
		return
	}

	// Remove the current message from history (it's already in content)
	if len(history) > 0 && history[len(history)-1].ID == userMsgID {
		history = history[:len(history)-1]
	}

	// Send start signal
	h.sendWebSocketMessage(conn, model.WebSocketMessage{
		Type:    "start",
		Content: "",
	})

	// Stream response from AI
	var fullResponse string
	fullResponse, err = h.musicAgent.ChatStream(ctx, history, content, func(chunk string) error {
		return h.sendWebSocketMessage(conn, model.WebSocketMessage{
			Type:    "content",
			Content: chunk,
		})
	})

	if err != nil {
		logger.Error("Failed to get AI response",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		h.sendWebSocketError(conn, "Failed to get AI response: "+err.Error())
		return
	}

	// Save assistant message
	assistantMsg := &model.ChatMessage{
		SessionID: session.ID,
		Role:      "assistant",
		Content:   fullResponse,
	}
	assistantMsgID, err := h.chatRepo.CreateMessage(assistantMsg)
	if err != nil {
		logger.Error("Failed to save assistant message",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		// Don't return error to user since they already got the response
	}
	assistantMsg.ID = assistantMsgID
	assistantMsg.CreatedAt = time.Now()

	// Send end signal
	h.sendWebSocketMessage(conn, model.WebSocketMessage{
		Type:    "end",
		Content: "",
	})

	logger.Info("Chat message processed",
		logger.Int64("userID", userID),
		logger.Int("responseLength", len(fullResponse)))
}

// sendWebSocketMessage sends a message through WebSocket.
func (h *ChatHandler) sendWebSocketMessage(conn *websocket.Conn, msg model.WebSocketMessage) error {
	return conn.WriteJSON(msg)
}

// sendWebSocketError sends an error message through WebSocket.
func (h *ChatHandler) sendWebSocketError(conn *websocket.Conn, errMsg string) {
	h.sendWebSocketMessage(conn, model.WebSocketMessage{
		Type:    "error",
		Content: errMsg,
	})
}
