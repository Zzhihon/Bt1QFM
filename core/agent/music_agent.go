package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"Bt1QFM/core/plugin"
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
	config      *MusicAgentConfig
	httpClient  *http.Client
	musicPlugin plugin.MusicPlugin
}

// ToolCall 工具调用结构
type ToolCall struct {
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args"`
}

// SongSearchResult 歌曲搜索结果回调
type SongSearchResult struct {
	Query string             `json:"query"`
	Songs []plugin.PluginSong `json:"songs"`
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
5. **歌曲搜索**：可以直接搜索歌曲并展示给用户播放

## 歌曲搜索工具
当用户想听歌、让你推荐歌曲、问某首歌、或者表达想听音乐的意图时，你可以使用歌曲搜索工具。

使用格式（必须严格遵守）：
<search_music>歌曲名或关键词</search_music>

示例：
- 用户说"我想听周杰伦的歌" → 你回复包含 <search_music>周杰伦</search_music>
- 用户说"放首稻香" → 你回复包含 <search_music>稻香 周杰伦</search_music>
- 用户说"有什么治愈的歌推荐吗" → 你回复包含 <search_music>治愈 轻音乐</search_music>
- 用户问"起风了这首歌怎么样" → 你回复包含 <search_music>起风了</search_music>

重要规则：
1. 当检测到用户有听歌意图时，必须使用 <search_music> 标签
2. 标签内只放搜索关键词，不要放其他内容
3. 可以在标签前后添加你的评论或介绍
4. 每次最多使用一个 <search_music> 标签

## 回复示例
用户：我想听点轻松的歌
你：好的！给你找一首轻松愉快的歌～ <search_music>轻松 愉快 流行</search_music> 希望能让你心情更好！

用户：周杰伦的晴天好听吗
你：《晴天》是周杰伦2003年发行的经典之作，旋律优美，歌词充满青春回忆，绝对值得一听！<search_music>晴天 周杰伦</search_music>

## 注意事项
- 保持友好和专业的态度
- 回答要简洁但有深度
- 主动使用搜索工具为用户找歌
- 记住用户之前提到的音乐偏好`

// NewMusicAgent creates a new music agent.
func NewMusicAgent(config *MusicAgentConfig) *MusicAgent {
	return &MusicAgent{
		config: config,
		httpClient: &http.Client{
			Timeout: 120 * time.Second, // Longer timeout for streaming
		},
		musicPlugin: plugin.NewNeteasePlugin(),
	}
}

// searchMusicPattern 用于匹配 <search_music>...</search_music> 标签
var searchMusicPattern = regexp.MustCompile(`<search_music>(.*?)</search_music>`)

// ParseSearchMusic 解析回复中的音乐搜索标签
// 返回：清理后的文本、搜索关键词（如果有）
func (a *MusicAgent) ParseSearchMusic(content string) (string, string) {
	matches := searchMusicPattern.FindStringSubmatch(content)
	if len(matches) < 2 {
		return content, ""
	}

	query := strings.TrimSpace(matches[1])
	// 移除标签，保留前后文本
	cleanContent := searchMusicPattern.ReplaceAllString(content, "")
	cleanContent = strings.TrimSpace(cleanContent)

	return cleanContent, query
}

// SearchMusic 执行音乐搜索
func (a *MusicAgent) SearchMusic(query string, limit int) ([]plugin.PluginSong, error) {
	if a.musicPlugin == nil {
		return nil, fmt.Errorf("music plugin not initialized")
	}

	if limit <= 0 {
		limit = 3
	}

	logger.Info("[MusicAgent] 执行音乐搜索",
		logger.String("query", query),
		logger.Int("limit", limit))

	return a.musicPlugin.Search(query, limit)
}

// GetMusicPlugin 获取音乐插件实例
func (a *MusicAgent) GetMusicPlugin() plugin.MusicPlugin {
	return a.musicPlugin
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
		logger.Int("maxTokens", a.config.MaxTokens),
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
						// 记录错误但继续处理流，不要因为单次写入失败就中断
						logger.Warn("Callback error during streaming, continuing",
							logger.ErrorField(err),
							logger.Int("contentLenSoFar", fullContent.Len()))
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
