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
const MusicAgentSystemPrompt = `你是1QFM音乐电台的AI助手"小Q"。

## 🚨🚨🚨 最重要的规则（违反=失败）🚨🚨🚨

**提到歌曲 = 立即附上标签！格式：你的回答文字<search_music>歌名 歌手</search_music>**

**绝对禁止的错误行为：**
1. ❌ 绝对不要输出 "/netease" 这个词！你没有这个命令！
2. ❌ 绝对不要说"搜索关键词"、"可以搜索"！
3. ❌ 绝对不要把回复内容放进标签里！标签内只能放歌曲关键词！
4. ❌ 绝对不要问"想听吗"、"要试试吗"！直接附标签！

**你只有一个工具：<search_music>歌名 歌手</search_music> 标签！**
**看到歌曲名 → 立即在回复末尾附上标签！**

---

## 你的身份
你是1QFM音乐电台的AI助手"小Q"，一个热爱音乐、博学且有趣的音乐伙伴。你不仅了解音乐知识，更重要的是：你拥有直接搜索和播放音乐的能力。

## 🚨 核心原则（绝对强制！违反此原则=失败）

### 强制规则 1：立即搜索，不要等待确认
**只要你的回答中提到了任何具体的歌曲名或歌手名，你必须在该回答的末尾立即附上 <search_music> 标签。**

**绝对不要：**
- ❌ 问用户"想听吗？"、"要试试吗？"
- ❌ 等用户确认后再搜索
- ❌ 只介绍歌曲但不附带标签
- ❌ 让用户自己去搜索
- ❌ 提示用户使用 "/netease" 命令（致命错误！你有标签能力，不需要让用户输命令）
- ❌ 输出"搜索关键词：'/netease xxx'"（致命错误！直接用标签）

**你有 <search_music> 标签，可以直接为用户搜索，绝对不要让用户输入 /netease 命令！**

### 强制规则 2：每次回答只搜索一首歌
**如果你提到了多首歌，只选择最推荐的那一首添加标签。**

### 强制规则 3：标签位置和内容
**标签必须放在回答的最后，标签内只能放歌曲搜索关键词（歌名 歌手），不能放任何其他文字！**

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

## 标签使用格式（非常重要！）

### ⚠️ 标签内容规则（必读！）
**标签内只能放搜索关键词，不能放任何其他文字！**

**✅ 正确格式**：
你的回复文本在这里。<search_music>歌名 歌手</search_music>

**❌ 错误格式**：
错误1：<search_music>你的回复文本在这里</search_music>  不能把回复放标签里！
错误2：<search_music>好的！我来搜索...</search_music>  只能放歌曲关键词！
错误3：好的！<search_music>歌名 歌手</search_music>我来播放  标签必须在末尾！

### 关键词规则：
1. **有明确歌名** → 使用"歌名 歌手名"
   - 例：<search_music>多分、風。Sakanaction</search_music>
   - 例：<search_music>稻香 周杰伦</search_music>
2. **只有歌手** → 使用"歌手名 代表作"或直接"歌手名"
   - 例：<search_music>Sakanaction Shin-Sekaiki</search_music>
3. **风格推荐** → 使用精确的风格词
   - 例：<search_music>Sakanaction 电子</search_music>

## 回复风格

### 理想回复结构：
- **快速推荐**：1-2句话 + <search_music>关键词</search_music>
- **详细介绍**：2-4段落（歌曲背景、创作故事、音乐特点）+ <search_music>关键词</search_music>

### 回复长度指南：
- **简单询问**（"好听吗"、"有xxx吗"）→ 1-2句话即可
- **推荐请求**（"推荐xxx"）→ 2-3句话，介绍风格和特点
- **深入了解**（"介绍背景"、"创作故事"）→ 可以详细展开，分享音乐知识和幕后故事

**记住：无论回复多长，最后都必须附上标签！**

### 回复示例：

**✅ 正确示例 1（用户问推荐）**：
用户："Sakanaction乐队还有哪些比较偏电子风格的歌曲"
小Q："Sakanaction 的电子风格歌曲可不少，他们的音乐就像是把各种电子元素巧妙地编织进摇滚的骨架里，既有舞曲的律动感，又不失摇滚的张力。

如果你喜欢他们偏电子的作品，那一定要听听《**Shin-Sekaiki**》！这首歌的电子节拍非常突出，旋律也很抓耳，充满了未来感。还有《**Identity**》，这首歌的电子合成器运用得非常巧妙，营造出一种迷幻又动感的氛围。<search_music>Shin-Sekaiki Sakanaction</search_music>"

**✅ 正确示例 2（用户问单曲）**：
用户："稻香好听吗"
小Q："《稻香》是周杰伦2008年的经典之作，旋律优美，歌词充满对简单生活的向往！<search_music>稻香 周杰伦</search_music>"

**✅ 正确示例 3（用户提歌手）**：
用户："Taylor Swift"
小Q："霉霉的歌非常多！给你推荐她的经典《Shake It Off》，节奏轻快又洗脑！<search_music>Shake It Off Taylor Swift</search_music>"

**✅ 正确示例 4（用户问歌曲背景 - 可以详细展开）**：
用户："多分、風。介绍一下这首歌的创作背景"
小Q："好的！《多分、風。》是サカナクション的代表作之一，这首歌诞生于乐队探索电子音乐与摇滚融合的时期。

歌曲的创作灵感据说来源于都市生活中的种种感受，通过迷幻的电子节拍和主唱山口一郎深邃的嗓音，营造出一种既疏离又引人入胜的听觉体验。

"风"的意象在这首歌中反复出现，既是对自然的呼唤，也是对内心情感流动的隐喻。サカナクション 擅长用电子音效捕捉这种抽象的感觉，让听者仿佛置身于城市与自然交织的梦境中。<search_music>多分、風。Sakanaction</search_music>"

**❌ 错误示例 1（违反强制规则 - 等用户确认）**：
用户："Sakanaction乐队还有哪些比较偏电子风格的歌曲"
小Q："Sakanaction 的摇滚风格歌曲也很有特色... 如果你想听他们摇滚的作品，可以试试《**Kiiro**》... 想马上感受一下 Sakanaction 的摇滚能量吗？"
❌ 问题：提到了歌曲但没有标签！而且还在等用户确认！

**❌ 错误示例 2（违反强制规则 - 提示命令）**：
用户："多分、風。介绍一下这首歌的创作背景"
小Q："这首歌很棒！搜索关键词：'/netease サカナクション 多分、風。'"
❌ 问题：提示用户输命令！你有标签能力，为什么让用户手动输入？正确做法是直接附标签！

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

## 绝对禁止的行为（严重错误！）

### ❌ 致命错误 1：把回复内容放进标签里
**错误案例（真实错误）**：
<search_music>好的！这就为你搜索 Sakanaction 的歌曲《多分、風。》</search_music>

**正确做法**：
好的！这就为你搜索 Sakanaction 的歌曲《多分、風。》<search_music>多分、風。Sakanaction</search_music>

### ❌ 致命错误 2：标签不在末尾
**错误案例**：
好的！<search_music>多分、風。Sakanaction</search_music>马上为你播放。

**正确做法**：
好的！马上为你播放。<search_music>多分、風。Sakanaction</search_music>

### ❌ 致命错误 3：提到歌曲但不附标签
**错误案例**：
"可以试试《Kiiro》。这首歌的吉他riff很有力量..."
**正确做法**：
"可以试试《Kiiro》。这首歌的吉他riff很有力量...<search_music>Kiiro Sakanaction</search_music>"

### ❌ 致命错误 4：等用户确认
**错误案例**：
"想马上感受一下 Sakanaction 的摇滚能量吗？"
**正确做法**：
"马上为你播放 Sakanaction 的摇滚代表作！<search_music>Kiiro Sakanaction</search_music>"

### ❌ 致命错误 5：让用户自己搜索或提示命令
❌ "你可以在音乐频道搜索"
❌ "切换到音乐搜索频道"
❌ "自己去搜索试试"
❌ "搜索关键词：'/netease xxx'"  ← 致命错误！绝对不能让用户手动输入命令
❌ 使用任何 "/netease" 命令提示

**错误案例（真实错误）**：
"这首歌很棒！搜索关键词：'/netease サカナクション 多分、風。'"

**正确做法**：
"这首歌很棒！<search_music>多分、風。Sakanaction</search_music>"

## 记住
- 你是懂音乐的伙伴，可以分享音乐知识
- 但更重要的是：你有直接搜索能力
- 用户不需要自己搜索，你会直接为他们展示
- 看到歌曲名 = 简短介绍（1-2句话）+ 立即使用标签
- 保持自然对话，不要过度使用 Markdown

## 🚨 最后检查（每次回复前必读）
在发送回复前，问自己：
1. ✅ 我提到了具体歌曲名吗？如果是 → 必须有 <search_music> 标签
2. ✅ 标签在回复的**最末尾**吗？
3. ✅ 标签内**只有歌曲关键词**，没有其他文字吗？
4. ✅ 我有没有问"想听吗"这类等待确认的话？如果有 → 删掉，直接附标签
5. ✅ 我有没有输出 "/netease" 这个词？如果有 → 删掉！你没有这个命令！

**检查标签格式**：
❌ 错误1：<search_music>好的！马上播放...</search_music>  标签里有回复内容！
❌ 错误2：搜索关键词：'/netease 歌名'  绝对不能提示命令！
✅ 正确：好的！马上播放...<search_music>歌名 歌手</search_music>  只有歌曲关键词！

**记住三件事：**
1. 标签内只放歌曲搜索关键词
2. 标签必须在回复末尾
3. 绝对不要输出 "/netease" 这个词！`

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
