package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"Bt1QFM/logger"
	"Bt1QFM/model"
)

// MusicAgentConfig contains configuration for the music agent.
type MusicAgentConfig struct {
	APIBaseURL  string
	APIKey      string
	Model       string
	MaxTokens   int
	Temperature float64
}

// MusicAgent handles chat interactions with the AI model.
type MusicAgent struct {
	config     *MusicAgentConfig
	httpClient *http.Client
}

// System prompt for the music agent.
const MusicAgentSystemPrompt = `你是1QFM音乐电台的AI助手"小Q"，一个热爱音乐、博学且有趣的音乐伙伴。

## 你的身份
- 名字：小Q
- 性格：热情、专业、有幽默感
- 专长：音乐知识、歌曲推荐、音乐故事分享

## 你的能力
1. **音乐百科**：熟悉各种音乐风格、乐队历史、专辑信息
2. **个性化推荐**：根据用户喜好推荐歌曲，记住用户的音乐偏好
3. **音乐故事**：分享有趣的音乐幕后故事和冷知识
4. **聊天陪伴**：可以进行轻松的日常对话

## 推荐歌曲格式
当你推荐歌曲时，请使用以下格式方便用户搜索：
🎵 **歌曲名** - 艺术家名
   专辑：专辑名（发行年份）
   风格：音乐风格
   推荐理由：简短说明

## 注意事项
- 保持友好和专业的态度
- 回答要简洁但有深度
- 鼓励用户使用 /netease 歌曲名 命令来搜索和播放推荐的歌曲
- 记住用户之前提到的音乐偏好
- 如果用户想听歌，告诉他们可以切换到"音乐搜索"频道使用 /netease 命令搜索`

// NewMusicAgent creates a new music agent.
func NewMusicAgent(config *MusicAgentConfig) *MusicAgent {
	return &MusicAgent{
		config: config,
		httpClient: &http.Client{
			Timeout: 120 * time.Second, // Longer timeout for streaming
		},
	}
}

// buildMessages constructs the message array for the API call.
func (a *MusicAgent) buildMessages(history []*model.ChatMessage, userMessage string) []model.OpenAIChatMessage {
	messages := make([]model.OpenAIChatMessage, 0, len(history)+2)

	// Add system prompt
	messages = append(messages, model.OpenAIChatMessage{
		Role:    "system",
		Content: MusicAgentSystemPrompt,
	})

	// Add history messages
	for _, msg := range history {
		messages = append(messages, model.OpenAIChatMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	// Add current user message
	messages = append(messages, model.OpenAIChatMessage{
		Role:    "user",
		Content: userMessage,
	})

	return messages
}

// Chat sends a message and returns the complete response.
func (a *MusicAgent) Chat(ctx context.Context, history []*model.ChatMessage, userMessage string) (string, error) {
	messages := a.buildMessages(history, userMessage)

	reqBody := model.OpenAIChatRequest{
		Model:       a.config.Model,
		Messages:    messages,
		MaxTokens:   a.config.MaxTokens,
		Temperature: a.config.Temperature,
		Stream:      false,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", a.config.APIBaseURL+"/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.config.APIKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	var chatResp model.OpenAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("no response choices returned")
	}

	return chatResp.Choices[0].Message.Content, nil
}

// StreamCallback is called for each chunk of the streaming response.
type StreamCallback func(chunk string) error

// ChatStream sends a message and streams the response.
// If streaming fails to produce content, it falls back to non-streaming mode.
func (a *MusicAgent) ChatStream(ctx context.Context, history []*model.ChatMessage, userMessage string, callback StreamCallback) (string, error) {
	// Try streaming first
	result, err := a.chatStreamInternal(ctx, history, userMessage, callback)
	if err != nil {
		logger.Warn("Streaming chat failed, falling back to non-streaming",
			logger.ErrorField(err))
		// Fall back to non-streaming
		return a.Chat(ctx, history, userMessage)
	}

	// If streaming returned empty, fall back to non-streaming
	if result == "" {
		logger.Warn("Streaming returned empty response, falling back to non-streaming")
		nonStreamResult, err := a.Chat(ctx, history, userMessage)
		if err != nil {
			return "", err
		}
		// Send the full response as a single chunk
		if callback != nil {
			callback(nonStreamResult)
		}
		return nonStreamResult, nil
	}

	return result, nil
}

// chatStreamInternal is the internal streaming implementation.
func (a *MusicAgent) chatStreamInternal(ctx context.Context, history []*model.ChatMessage, userMessage string, callback StreamCallback) (string, error) {
	messages := a.buildMessages(history, userMessage)

	reqBody := model.OpenAIChatRequest{
		Model:       a.config.Model,
		Messages:    messages,
		MaxTokens:   a.config.MaxTokens,
		Temperature: a.config.Temperature,
		Stream:      true,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	logger.Info("Sending streaming chat request",
		logger.String("model", a.config.Model),
		logger.Int("historyCount", len(history)),
		logger.String("apiUrl", a.config.APIBaseURL))

	req, err := http.NewRequestWithContext(ctx, "POST", a.config.APIBaseURL+"/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.config.APIKey)
	req.Header.Set("Accept", "text/event-stream")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	logger.Info("Stream response started",
		logger.Int("statusCode", resp.StatusCode),
		logger.String("contentType", resp.Header.Get("Content-Type")))

	var fullContent strings.Builder
	reader := bufio.NewReader(resp.Body)
	lineCount := 0

	for {
		select {
		case <-ctx.Done():
			return fullContent.String(), ctx.Err()
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				logger.Info("Stream ended with EOF",
					logger.Int("linesRead", lineCount),
					logger.Int("contentLength", fullContent.Len()))
				break
			}
			return fullContent.String(), fmt.Errorf("failed to read stream: %w", err)
		}

		lineCount++
		rawLine := line
		line = strings.TrimSpace(line)

		if line == "" {
			continue
		}

		logger.Debug("Stream line received",
			logger.Int("lineNum", lineCount),
			logger.String("rawLine", rawLine),
			logger.String("trimmedLine", line))

		// Skip non-data lines
		if !strings.HasPrefix(line, "data: ") {
			logger.Debug("Skipping non-data line",
				logger.String("line", line))
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		// Check for stream end
		if data == "[DONE]" {
			logger.Info("Stream completed with [DONE]",
				logger.Int("totalLines", lineCount),
				logger.Int("contentLength", fullContent.Len()))
			break
		}

		var chunk model.OpenAIStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			logger.Warn("Failed to parse stream chunk",
				logger.String("data", data),
				logger.ErrorField(err))
			continue
		}

		if len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta
			if delta.Content != "" {
				content := delta.Content
				fullContent.WriteString(content)

				if callback != nil {
					if err := callback(content); err != nil {
						return fullContent.String(), fmt.Errorf("callback error: %w", err)
					}
				}
			}
		}
	}

	logger.Info("ChatStream completed",
		logger.Int("totalLinesRead", lineCount),
		logger.Int("finalContentLength", fullContent.Len()))

	return fullContent.String(), nil
}
