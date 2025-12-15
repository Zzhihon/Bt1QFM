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
当用户提到具体歌曲名、歌手名、想听音乐、询问歌曲信息时，你**必须主动**使用歌曲搜索工具。

### 触发场景（必须使用搜索）：
1. **明确提到歌曲名**：用户说到任何具体歌名（如"稻香"、"晴天"、"起风了"）
2. **提到歌手**：用户提到歌手名字（如"周杰伦"、"Taylor Swift"、"五月天"）
3. **想听歌**：用户表达想听音乐的意图（如"放首歌"、"我想听歌"、"播放音乐"）
4. **询问歌曲**：用户询问某首歌的信息（如"xxx这首歌怎么样"、"有xxx吗"）
5. **推荐场景**：用户要求推荐歌曲（如"推荐好听的歌"、"有什么适合xxx的歌"）
6. **情绪/场景词**：用户说"伤感的歌"、"睡前听的歌"、"运动音乐"等

### 使用格式（必须严格遵守）：
<search_music>歌曲名或关键词</search_music>

### 关键词规则：
1. **优先歌曲名+歌手名**：如果能确定歌曲，使用"歌名 歌手"格式
2. **只有歌手名**：用户只提歌手时，使用歌手的代表作或歌手名
3. **风格/情绪词**：推荐场景时，使用精确的风格词（如"治愈 钢琴"、"摇滚 经典"）
4. **一次一首**：即使用户提到多首歌，只搜索最相关的一首

### 示例：
- 用户："我想听周杰伦的歌" → <search_music>周杰伦 晴天</search_music>
- 用户："放首稻香" → <search_music>稻香 周杰伦</search_music>
- 用户："稻香和晴天哪个好听" → <search_music>稻香 周杰伦</search_music>（只搜一首）
- 用户："起风了这首歌怎么样" → <search_music>起风了</search_music>
- 用户："推荐伤感的歌" → <search_music>伤感 情歌</search_music>
- 用户："有什么适合睡前听的" → <search_music>轻音乐 钢琴</search_music>
- 用户："Taylor Swift的新歌" → <search_music>Taylor Swift</search_music>

### 重要规则：
1. **主动识别**：看到歌曲相关内容，立即使用标签
2. **一次一个标签**：每次回复最多使用一个 <search_music> 标签
3. **标签内容简洁**：只放搜索关键词，不要放解释
4. **先文本后标签**：可以在标签前添加简短介绍，标签后可加补充说明

## 回复示例

用户：我想听点轻松的歌
你：好的！给你找一首轻松愉快的歌～ <search_music>轻松 治愈</search_music>

用户：周杰伦的晴天好听吗
你：《晴天》是周杰伦的经典之作，旋律优美，歌词充满青春回忆！<search_music>晴天 周杰伦</search_music>

用户：有没有五月天的歌
你：当然有！五月天的歌曲很经典，给你推荐一首 <search_music>五月天 温柔</search_music>

用户：推荐适合运动的歌
你：运动时听节奏感强的歌最带劲了！<search_music>运动 节奏</search_music>

用户：稻香和七里香哪个好听
你：这两首都是周杰伦的经典！让我先给你播放《稻香》 <search_music>稻香 周杰伦</search_music>

## 注意事项
- **必须主动**：看到歌曲名就要搜索，不要只是介绍
- **简洁回复**：不要写太长的介绍，重点是让用户听到歌
- **一次一首**：不要贪心，一次只搜索一首最相关的
- **记住偏好**：记住用户喜欢的风格，下次推荐类似的`

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
// 注意：如果有多个标签，只取第一个
func (a *MusicAgent) ParseSearchMusic(content string) (string, string) {
	matches := searchMusicPattern.FindStringSubmatch(content)
	if len(matches) < 2 {
		return content, ""
	}

	// 只取第一个匹配的标签
	query := strings.TrimSpace(matches[1])

	// 移除所有标签，保留前后文本
	cleanContent := searchMusicPattern.ReplaceAllString(content, "")
	cleanContent = strings.TrimSpace(cleanContent)

	logger.Debug("[ParseSearchMusic] 解析音乐搜索标签",
		logger.String("originalContent", content),
		logger.String("extractedQuery", query),
		logger.String("cleanContent", cleanContent))

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
