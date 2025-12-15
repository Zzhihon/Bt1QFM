package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"Bt1QFM/core/agent"
	"Bt1QFM/core/auth"
	"Bt1QFM/core/plugin"
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
	writeWait      = 30 * time.Second    // 写入超时 - 增加到30秒
	pongWait       = 60 * time.Second    // 等待 pong 响应超时
	pingPeriod     = (pongWait * 9) / 10 // ping 间隔 (必须小于 pongWait)
	maxMessageSize = 8192                // 最大消息大小

	// 分层超时配置
	softTimeout = 8 * time.Second  // 软超时：提示用户"AI思考中"
	hardTimeout = 30 * time.Second // 硬超时：提示用户可以重试
)

// NewChatHandler creates a new ChatHandler.
func NewChatHandler(chatRepo repository.ChatRepository, agentConfig *agent.MusicAgentConfig) *ChatHandler {
	return &ChatHandler{
		chatRepo:   chatRepo,
		musicAgent: agent.NewMusicAgent(agentConfig),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,  // 增加读缓冲
			WriteBufferSize: 4096,  // 增加写缓冲
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

	// 检测是否是 /netease 命令
	if len(content) > 9 && content[:9] == "/netease " {
		query := content[9:] // 提取搜索关键词
		h.handleDirectMusicSearch(conn, session, userID, query)
		return
	}

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

	// 用于跟踪是否收到首个响应
	firstChunkReceived := make(chan struct{})
	var firstChunkOnce sync.Once

	// 启动超时检测 goroutine
	go h.timeoutWatcher(conn, firstChunkReceived, ctx)

	// Stream response from AI
	var fullResponse string
	fullResponse, err = h.musicAgent.ChatStream(ctx, history, content, func(chunk string) error {
		// 标记已收到首个响应
		firstChunkOnce.Do(func() {
			close(firstChunkReceived)
		})

		// 直接发送原始文本块（不做标签检测，避免流式混乱）
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

	// 流式完成后，立即解析标签并触发搜索（关键优化点）
	cleanContent, searchQuery := h.musicAgent.ParseSearchMusic(fullResponse)
	var songCards []model.SongCard

	if searchQuery != "" {
		logger.Info("[ChatHandler] 检测到音乐搜索标签，立即触发搜索",
			logger.Int64("userID", userID),
			logger.String("query", searchQuery))

		// 立即执行搜索（不等待，快速响应）
		songCards = h.handleMusicSearchAndGetCards(conn, userID, searchQuery)

		// 确保只保留第一首歌曲
		if len(songCards) > 1 {
			songCards = songCards[:1]
			logger.Info("[ChatHandler] 限制为单首歌曲展示",
				logger.Int64("userID", userID),
				logger.String("query", searchQuery))
		}
	}

	// Save assistant message (保存清理后的内容和歌曲数据)
	assistantMsg := &model.ChatMessage{
		SessionID: session.ID,
		Role:      "assistant",
		Content:   cleanContent, // 保存不含标签的内容
		Songs:     songCards,    // 保存歌曲卡片数据
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
		logger.Int("responseLength", len(fullResponse)),
		logger.String("musicQuery", searchQuery),
		logger.Int("songsCount", len(songCards)))
}

// timeoutWatcher 监控首响应超时，发送分层超时提示
func (h *ChatHandler) timeoutWatcher(conn *websocket.Conn, firstChunkReceived <-chan struct{}, ctx context.Context) {
	softTimer := time.NewTimer(softTimeout)
	hardTimer := time.NewTimer(hardTimeout)
	defer softTimer.Stop()
	defer hardTimer.Stop()

	softNotified := false

	for {
		select {
		case <-firstChunkReceived:
			// 已收到首个响应，停止超时检测
			logger.Debug("First chunk received, stopping timeout watcher")
			return

		case <-ctx.Done():
			// 上下文已取消
			return

		case <-softTimer.C:
			// 软超时：8秒未收到响应，发送提示
			if !softNotified {
				softNotified = true
				logger.Info("Soft timeout reached, notifying user")
				h.sendWebSocketMessage(conn, model.WebSocketMessage{
					Type:    "slow",
					Content: "AI正在思考中，请稍候...",
				})
			}

		case <-hardTimer.C:
			// 硬超时：30秒未收到响应，提示可以重试
			logger.Warn("Hard timeout reached, suggesting retry")
			h.sendWebSocketMessage(conn, model.WebSocketMessage{
				Type:    "timeout",
				Content: "响应时间较长，您可以选择继续等待或重试",
			})
			return
		}
	}
}

// sendWebSocketMessage sends a message through WebSocket with proper deadline.
func (h *ChatHandler) sendWebSocketMessage(conn *websocket.Conn, msg model.WebSocketMessage) error {
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	return conn.WriteJSON(msg)
}

// sendWebSocketError sends an error message through WebSocket.
func (h *ChatHandler) sendWebSocketError(conn *websocket.Conn, errMsg string) {
	h.sendWebSocketMessage(conn, model.WebSocketMessage{
		Type:    "error",
		Content: errMsg,
	})
}

// handleMusicSearchAndGetCards 执行音乐搜索，发送歌曲卡片，并返回卡片数据用于持久化
func (h *ChatHandler) handleMusicSearchAndGetCards(conn *websocket.Conn, userID int64, query string) []model.SongCard {
	logger.Info("[ChatHandler] 执行音乐搜索",
		logger.Int64("userID", userID),
		logger.String("query", query))

	// 执行搜索（只搜索1首，避免浪费）
	songs, err := h.musicAgent.SearchMusic(query, 1)
	if err != nil {
		logger.Error("[ChatHandler] 音乐搜索失败",
			logger.Int64("userID", userID),
			logger.String("query", query),
			logger.ErrorField(err))
		return nil
	}

	if len(songs) == 0 {
		logger.Info("[ChatHandler] 未找到歌曲",
			logger.Int64("userID", userID),
			logger.String("query", query))
		return nil
	}

	// 转换为 SongCard 格式，并获取详细封面
	songCards := h.convertToSongCardsWithDetail(songs)

	// 发送歌曲卡片消息
	songsMsg := model.ChatMessageWithSongs{
		Type:    "songs",
		Content: "",
		Songs:   songCards,
	}

	conn.SetWriteDeadline(time.Now().Add(writeWait))
	if err := conn.WriteJSON(songsMsg); err != nil {
		logger.Error("[ChatHandler] 发送歌曲卡片失败",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
		return songCards // 即使发送失败也返回数据用于持久化
	}

	logger.Info("[ChatHandler] 歌曲卡片已发送",
		logger.Int64("userID", userID),
		logger.Int("count", len(songCards)))

	return songCards
}

// handleMusicSearch 执行音乐搜索并发送歌曲卡片 (保留兼容性)
func (h *ChatHandler) handleMusicSearch(conn *websocket.Conn, userID int64, query string) {
	h.handleMusicSearchAndGetCards(conn, userID, query)
}

// convertToSongCardsWithDetail 将 PluginSong 转换为 SongCard，并获取详细封面
func (h *ChatHandler) convertToSongCardsWithDetail(songs []plugin.PluginSong) []model.SongCard {
	cards := make([]model.SongCard, len(songs))
	for i, song := range songs {
		coverURL := song.CoverURL

		// 尝试获取更详细的封面（通过歌曲详情接口）
		if detail, err := h.musicAgent.GetMusicPlugin().GetDetail(song.ID); err == nil && detail != nil {
			if detail.CoverURL != "" {
				coverURL = detail.CoverURL
			}
		}

		cards[i] = model.SongCard{
			ID:       song.ID,
			Name:     song.Name,
			Artists:  song.Artists,
			Album:    song.Album,
			Duration: song.Duration,
			CoverURL: coverURL,
			HLSURL:   song.HLSURL,
			Source:   song.Source,
		}
	}
	return cards
}

// convertToSongCards 将 PluginSong 转换为 SongCard (简单版本)
func (h *ChatHandler) convertToSongCards(songs []plugin.PluginSong) []model.SongCard {
	cards := make([]model.SongCard, len(songs))
	for i, song := range songs {
		cards[i] = model.SongCard{
			ID:       song.ID,
			Name:     song.Name,
			Artists:  song.Artists,
			Album:    song.Album,
			Duration: song.Duration,
			CoverURL: song.CoverURL,
			HLSURL:   song.HLSURL,
			Source:   song.Source,
		}
	}
	return cards
}

// handleDirectMusicSearch 处理 /netease 直接搜索命令
func (h *ChatHandler) handleDirectMusicSearch(conn *websocket.Conn, session *model.ChatSession, userID int64, query string) {
	logger.Info("[ChatHandler] 处理直接搜索命令",
		logger.Int64("userID", userID),
		logger.String("query", query))

	// 保存用户命令消息
	userMsg := &model.ChatMessage{
		SessionID: session.ID,
		Role:      "user",
		Content:   "/netease " + query,
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

	// 发送开始信号
	h.sendWebSocketMessage(conn, model.WebSocketMessage{
		Type:    "start",
		Content: "",
	})

	// 执行搜索
	songs, err := h.musicAgent.SearchMusic(query, 1)
	if err != nil {
		logger.Error("[ChatHandler] 直接搜索失败",
			logger.Int64("userID", userID),
			logger.String("query", query),
			logger.ErrorField(err))
		h.sendWebSocketError(conn, "搜索失败: "+err.Error())
		return
	}

	if len(songs) == 0 {
		// 没有找到歌曲，返回提示消息
		responseText := "抱歉，没有找到「" + query + "」相关的歌曲。"

		// 发送内容
		h.sendWebSocketMessage(conn, model.WebSocketMessage{
			Type:    "content",
			Content: responseText,
		})

		// 保存 AI 响应
		assistantMsg := &model.ChatMessage{
			SessionID: session.ID,
			Role:      "assistant",
			Content:   responseText,
		}
		h.chatRepo.CreateMessage(assistantMsg)

		// 发送结束信号
		h.sendWebSocketMessage(conn, model.WebSocketMessage{
			Type:    "end",
			Content: "",
		})
		return
	}

	// 转换为 SongCard 并获取详细封面
	songCards := h.convertToSongCardsWithDetail(songs)

	// 生成回复文本
	responseText := "好的！马上为你播放「" + songs[0].Name + "」"
	if len(songs[0].Artists) > 0 {
		responseText += " - " + songs[0].Artists[0]
	}

	// 发送内容
	h.sendWebSocketMessage(conn, model.WebSocketMessage{
		Type:    "content",
		Content: responseText,
	})

	// 发送歌曲卡片
	songsMsg := model.ChatMessageWithSongs{
		Type:    "songs",
		Content: "",
		Songs:   songCards,
	}
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	if err := conn.WriteJSON(songsMsg); err != nil {
		logger.Error("[ChatHandler] 发送歌曲卡片失败",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
	}

	// 保存 AI 响应（包含歌曲卡片）
	assistantMsg := &model.ChatMessage{
		SessionID: session.ID,
		Role:      "assistant",
		Content:   responseText,
		Songs:     songCards,
		CreatedAt: time.Now(),
	}
	assistantMsgID, err := h.chatRepo.CreateMessage(assistantMsg)
	if err != nil {
		logger.Error("Failed to save assistant message",
			logger.Int64("userID", userID),
			logger.ErrorField(err))
	}
	assistantMsg.ID = assistantMsgID

	// 发送结束信号
	h.sendWebSocketMessage(conn, model.WebSocketMessage{
		Type:    "end",
		Content: "",
	})

	logger.Info("[ChatHandler] 直接搜索完成",
		logger.Int64("userID", userID),
		logger.String("query", query),
		logger.Int("songsCount", len(songCards)))
}
