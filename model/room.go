package model

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// SongCardList 自定义类型用于 GORM JSON 字段的自动扫描
type SongCardList []SongCard

// Scan 实现 sql.Scanner 接口
func (s *SongCardList) Scan(value interface{}) error {
	if value == nil {
		*s = nil
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		*s = nil
		return nil
	}
	if len(bytes) == 0 || string(bytes) == "null" {
		*s = nil
		return nil
	}
	return json.Unmarshal(bytes, s)
}

// Value 实现 driver.Valuer 接口
func (s SongCardList) Value() (driver.Value, error) {
	if s == nil {
		return nil, nil
	}
	return json.Marshal(s)
}

// Room 聊天室
type Room struct {
	ID         string     `json:"id" gorm:"primaryKey;size:8"`
	Name       string     `json:"name" gorm:"size:100;not null"`
	OwnerID    int64      `json:"ownerId" gorm:"index;not null"`
	MaxMembers int        `json:"maxMembers" gorm:"default:10"`
	Status     string     `json:"status" gorm:"size:20;default:'active';index"` // active, closed
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ClosedAt   *time.Time `json:"closedAt,omitempty"`
}

// TableName 指定表名
func (Room) TableName() string {
	return "rooms"
}

// RoomMember 房间成员
type RoomMember struct {
	ID         int64      `json:"id" gorm:"primaryKey;autoIncrement"`
	RoomID     string     `json:"roomId" gorm:"size:8;index;not null"`
	UserID     int64      `json:"userId" gorm:"index;not null"`
	Role       string     `json:"role" gorm:"size:20;default:'member'"` // owner, admin, member
	Mode       string     `json:"mode" gorm:"size:20;default:'chat'"`   // chat, listen
	CanControl bool       `json:"canControl" gorm:"default:false"`      // 播放控制权限
	JoinedAt   time.Time  `json:"joinedAt"`
	LeftAt     *time.Time `json:"leftAt,omitempty"`
}

// TableName 指定表名
func (RoomMember) TableName() string {
	return "room_members"
}

// RoomMessage 房间消息
type RoomMessage struct {
	ID          int64        `json:"id" gorm:"primaryKey;autoIncrement"`
	RoomID      string       `json:"roomId" gorm:"size:8;index;not null"`
	UserID      int64        `json:"userId" gorm:"not null"`
	Content     string       `json:"content" gorm:"type:text;not null"`
	MessageType string       `json:"messageType" gorm:"size:20;default:'text'"` // text, system, song_add, song_search
	Songs       SongCardList `json:"songs,omitempty" gorm:"type:json"`          // 歌曲卡片列表(JSON)
	CreatedAt   time.Time    `json:"createdAt" gorm:"index"`
}

// TableName 指定表名
func (RoomMessage) TableName() string {
	return "room_messages"
}

// ========== 非持久化结构（用于 Redis 和 WebSocket） ==========

// RoomMemberOnline 在线成员信息（Redis 缓存）
type RoomMemberOnline struct {
	UserID     int64  `json:"userId"`
	Username   string `json:"username"`
	Avatar     string `json:"avatar,omitempty"`
	Role       string `json:"role"`       // owner, admin, member
	Mode       string `json:"mode"`       // chat, listen
	CanControl bool   `json:"canControl"` // 播放控制权限
	JoinedAt   int64  `json:"joinedAt"`   // Unix 时间戳
}

// RoomPlaybackState 播放状态（Redis 缓存）
type RoomPlaybackState struct {
	CurrentIndex int         `json:"currentIndex"`
	CurrentSong  interface{} `json:"currentSong,omitempty"` // PlaylistItem
	Position     float64     `json:"position"`              // 播放进度（秒）
	IsPlaying    bool        `json:"isPlaying"`
	UpdatedAt    int64       `json:"updatedAt"`    // 时间戳毫秒
	UpdatedBy    int64       `json:"updatedBy"`    // 操作者ID
	StateVersion int64       `json:"stateVersion"` // 状态版本号，用于解决并发切歌冲突
}

// RoomInfo 房间完整信息（API 响应用）
type RoomInfo struct {
	Room
	OwnerName   string             `json:"ownerName"`
	MemberCount int                `json:"memberCount"`
	Members     []RoomMemberOnline `json:"members,omitempty"`
}

// RoomMessageWithUser 带用户名的消息（API 响应用）
type RoomMessageWithUser struct {
	ID          int64        `json:"id"`
	RoomID      string       `json:"roomId"`
	UserID      int64        `json:"userId"`
	Username    string       `json:"username"`
	Content     string       `json:"content"`
	MessageType string       `json:"messageType"`
	Songs       SongCardList `json:"songs,omitempty"` // 歌曲卡片列表
	CreatedAt   time.Time    `json:"createdAt"`
}

// UserRoomInfo 用户参与的房间信息（API 响应用）
type UserRoomInfo struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	OwnerID     int64     `json:"ownerId"`
	OwnerName   string    `json:"ownerName"`
	MemberCount int       `json:"memberCount"`
	IsOwner     bool      `json:"isOwner"`
	JoinedAt    time.Time `json:"joinedAt"`
	Status      string    `json:"status"`
}

// ========== 常量定义 ==========

const (
	// 房间状态
	RoomStatusActive = "active"
	RoomStatusClosed = "closed"

	// 成员角色
	RoomRoleOwner  = "owner"
	RoomRoleAdmin  = "admin"
	RoomRoleMember = "member"

	// 成员模式
	RoomModeChat   = "chat"
	RoomModeListen = "listen"

	// 消息类型
	RoomMsgTypeText       = "text"
	RoomMsgTypeSystem     = "system"
	RoomMsgTypeSongAdd    = "song_add"
	RoomMsgTypeSongSearch = "song_search" // 歌曲搜索结果
)
