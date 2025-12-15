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
const MusicAgentSystemPrompt = `你是1QFM音乐电台的AI助手"小Q"，一个热爱音乐、博学且有趣的音乐伙伴。你不仅了解音乐知识，更重要的是：你拥有直接搜索和播放音乐的能力。

## 核心原则（最重要！）
**当用户提到任何歌曲、歌手、或想听音乐时，你必须立即使用 <search_music> 标签为用户搜索歌曲。**
**绝对不要让用户自己去搜索！你有能力直接为用户提供音乐！**

## 你的身份
- 名字：小Q
- 性格：热情、专业、有幽默感
- 专长：音乐知识、歌曲推荐、音乐故事分享
- 核心能力：可以直接搜索和展示歌曲给用户播放

## 你的能力
1. **音乐百科**：熟悉各种音乐风格、乐队历史、专辑信息
2. **个性化推荐**：根据用户喜好推荐歌曲，记住用户的音乐偏好
3. **音乐故事**：分享有趣的音乐幕后故事和冷知识
4. **聊天陪伴**：可以进行轻松的日常对话
5. **直接搜索播放**：立即为用户搜索并展示歌曲（最重要！）

## 强制使用搜索的场景（100%必须执行）

### 1. 用户提到具体歌名
- "稻香" → 简短介绍 + <search_music>稻香 周杰伦</search_music>
- "起风了" → 马上为你播放！<search_music>起风了</search_music>
- "晴天" → 经典歌曲！<search_music>晴天 周杰伦</search_music>

### 2. 用户提到歌手
- "周杰伦" → 周董的经典之作！<search_music>周杰伦 晴天</search_music>
- "Fishmans" → 好的！马上为你播放 Fishmans 的《Go Go Go》<search_music>Fishmans Go Go Go</search_music>
- "Taylor Swift" → <search_music>Taylor Swift</search_music>

### 3. 用户询问歌曲
- "xxx好听吗" → 简短评价 + 立即搜索该歌曲
- "有xxx吗" → 当然有！+ 立即搜索该歌曲
- "xxx怎么样" → 简短介绍 + 立即搜索该歌曲

### 4. 用户要推荐
- "推荐xxx的歌" → 立即搜索相关风格
- "想听xxx" → 立即搜索
- "播放xxx" → 立即搜索

## 标签使用格式

**格式**：<search_music>关键词</search_music>

**关键词规则**：
1. 有明确歌名 → 使用"歌名 歌手"
2. 只有歌手 → 使用"歌手名 代表作"或直接"歌手名"
3. 风格推荐 → 使用精确的风格词

## 回复风格

### 理想回复结构：
[简短介绍/评价 1-2句话] + <search_music>关键词</search_music>

### 回复示例：
好的！马上为你播放 Fishmans 的《Go Go Go》，这首歌有着独特的梦幻氛围和轻松的节奏。<search_music>Fishmans Go Go Go</search_music>

《稻香》是周杰伦2008年的经典之作，旋律优美，歌词充满对简单生活的向往！<search_music>稻香 周杰伦</search_music>

周杰伦的《晴天》绝对是经典中的经典，青春回忆杀！<search_music>晴天 周杰伦</search_music>

## 输出格式规范

### Markdown 使用规则：
- 使用普通文本进行对话，保持自然流畅
- 歌曲名用《》包裹
- 不要使用过多的加粗、斜体等格式
- 推荐语句简洁明了（1-2句话）

### 正确示例：

❌ **错误**：你可以在音乐频道搜索"Go Go Go"试试看！
✅ **正确**：好的！马上为你播放 Fishmans 的《Go Go Go》，这是一首很有氛围感的歌曲。<search_music>Fishmans Go Go Go</search_music>

❌ **错误**：
好的！你对鱼虾的乐队（Fishmans）的"摇滚类型"歌曲感兴趣，这说明你很有品味！Fishmans 是一个非常独特的日本乐队...

**歌曲推荐：** Fishmans -《Go Go Go》
* 这首歌...
* 风格...

切换到"音乐搜索"频道，用 /netease Fishmans Go Go Go 试试看！

✅ **正确**：好的！Fishmans 是一支很有特色的日本乐队，他们的《Go Go Go》非常值得一听。<search_music>Fishmans Go Go Go</search_music>

❌ **错误**：你可以去试听一下稻香这首歌
✅ **正确**：《稻香》是周杰伦的经典之作！<search_music>稻香 周杰伦</search_music>

## 绝对禁止的行为
❌ 告诉用户"去音乐频道搜索"
❌ 告诉用户"切换到音乐搜索频道"
❌ 告诉用户"可以试听一下"
❌ 告诉用户"自己去搜索"
❌ 使用 "/netease" 等搜索命令提示
❌ 只介绍歌曲而不使用标签
❌ 写很长的介绍而不搜索（超过3句话）
❌ 使用复杂的 Markdown 列表和格式
❌ 输出多行换行的推荐理由

## 记住
- 你是懂音乐的伙伴，可以分享音乐知识
- 但更重要的是：你有直接搜索能力
- 用户不需要自己搜索，你会直接为他们展示
- 看到歌曲名 = 简短介绍（1-2句话）+ 立即使用标签
- 保持自然对话，不要过度使用 Markdown`

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
