package model

import (
	"time"
)

// ChatSession represents a chat session between a user and the AI agent.
// Each user has only one session.
type ChatSession struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"userId"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ChatMessage represents a single message in a chat session.
type ChatMessage struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"sessionId"`
	Role      string    `json:"role"` // "user", "assistant", or "system"
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

// ChatMessageRequest represents the request body for sending a message.
type ChatMessageRequest struct {
	Content string `json:"content"`
}

// ChatMessageResponse represents the response for a chat message.
type ChatMessageResponse struct {
	UserMessage      *ChatMessage `json:"userMessage"`
	AssistantMessage *ChatMessage `json:"assistantMessage"`
}

// ChatHistoryResponse represents the response for chat history.
type ChatHistoryResponse struct {
	Session  *ChatSession   `json:"session"`
	Messages []*ChatMessage `json:"messages"`
}

// OpenAIChatMessage represents a message in the OpenAI chat format.
type OpenAIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// OpenAIChatRequest represents a request to the OpenAI chat API.
type OpenAIChatRequest struct {
	Model       string              `json:"model"`
	Messages    []OpenAIChatMessage `json:"messages"`
	MaxTokens   int                 `json:"max_tokens,omitempty"`
	Temperature float64             `json:"temperature,omitempty"`
	Stream      bool                `json:"stream"`
}

// OpenAIChatResponse represents a response from the OpenAI chat API.
type OpenAIChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// OpenAIStreamChunk represents a streaming chunk from the OpenAI chat API.
type OpenAIStreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Role    string `json:"role,omitempty"`
			Content string `json:"content,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// WebSocketMessage represents a message sent over WebSocket.
type WebSocketMessage struct {
	Type    string `json:"type"`    // "start", "content", "end", "error", "songs"
	Content string `json:"content"` // Message content or error message
}

// SongCard 歌曲卡片结构，用于在聊天中展示可播放的歌曲
type SongCard struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	Duration int      `json:"duration"` // 毫秒
	CoverURL string   `json:"coverUrl"`
	HLSURL   string   `json:"hlsUrl"`
	Source   string   `json:"source"` // "netease" 等
}

// ChatMessageWithSongs 带歌曲卡片的聊天消息
type ChatMessageWithSongs struct {
	Type    string     `json:"type"`    // "songs"
	Content string     `json:"content"` // 文本内容
	Songs   []SongCard `json:"songs"`   // 歌曲列表
}
