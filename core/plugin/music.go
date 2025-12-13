package plugin

// PluginSong 插件统一的歌曲结构
// 用于跨模块传递歌曲信息
type PluginSong struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	Duration int      `json:"duration"` // 毫秒
	CoverURL string   `json:"coverUrl"`
	HLSURL   string   `json:"hlsUrl,omitempty"`
	Source   string   `json:"source"` // "netease", "qq", "spotify" 等
}

// MusicPlugin 音乐插件接口
// 定义音乐搜索、播放等统一操作
type MusicPlugin interface {
	// Search 搜索歌曲
	// query: 搜索关键词
	// limit: 返回数量限制
	Search(query string, limit int) ([]PluginSong, error)

	// GetDetail 获取歌曲详情
	GetDetail(songID string) (*PluginSong, error)

	// GetPlayURL 获取播放地址
	// 返回 HLS 流地址
	GetPlayURL(songID string) (string, error)

	// GetSource 获取插件来源标识
	GetSource() string
}

// MusicPluginManager 音乐插件管理器
type MusicPluginManager struct {
	plugins map[string]MusicPlugin
}

// NewMusicPluginManager 创建插件管理器
func NewMusicPluginManager() *MusicPluginManager {
	return &MusicPluginManager{
		plugins: make(map[string]MusicPlugin),
	}
}

// Register 注册插件
func (m *MusicPluginManager) Register(plugin MusicPlugin) {
	m.plugins[plugin.GetSource()] = plugin
}

// Get 获取指定来源的插件
func (m *MusicPluginManager) Get(source string) MusicPlugin {
	return m.plugins[source]
}

// GetDefault 获取默认插件（网易云）
func (m *MusicPluginManager) GetDefault() MusicPlugin {
	return m.plugins["netease"]
}

// Search 使用默认插件搜索
func (m *MusicPluginManager) Search(query string, limit int) ([]PluginSong, error) {
	plugin := m.GetDefault()
	if plugin == nil {
		return nil, nil
	}
	return plugin.Search(query, limit)
}
