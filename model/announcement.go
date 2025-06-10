package model

import (
	"time"
	"github.com/google/uuid"
)

// Announcement 公告模型
type Announcement struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Version   string    `json:"version"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	CreatedBy *uint     `json:"createdBy"`
	IsActive  bool      `json:"isActive"`
	Priority  int       `json:"priority"`
	
	// 用户相关的虚拟字段（不存储在数据库中）
	IsRead bool `json:"isRead"`
}

// UserAnnouncementRead 用户公告已读记录
type UserAnnouncementRead struct {
	ID             uint      `json:"id"`
	UserID         uint      `json:"userId"`
	AnnouncementID string    `json:"announcementId"`
	ReadAt         time.Time `json:"readAt"`
}

// CreateAnnouncementRequest 创建公告请求
type CreateAnnouncementRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Version string `json:"version"`
	Type    string `json:"type"`
}

// AnnouncementResponse 公告响应（包含用户相关信息）
type AnnouncementResponse struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Version   string    `json:"version"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	IsRead    bool      `json:"isRead"`
}

// ToResponse 转换为响应格式
func (a *Announcement) ToResponse(isRead bool) AnnouncementResponse {
	return AnnouncementResponse{
		ID:        a.ID,
		Title:     a.Title,
		Content:   a.Content,
		Version:   a.Version,
		Type:      a.Type,
		CreatedAt: a.CreatedAt,
		UpdatedAt: a.UpdatedAt,
		IsRead:    isRead,
	}
}

// NewAnnouncement 创建新公告
func NewAnnouncement(req CreateAnnouncementRequest, userID uint) *Announcement {
	return &Announcement{
		ID:        uuid.New().String(),
		Title:     req.Title,
		Content:   req.Content,
		Version:   req.Version,
		Type:      req.Type,
		CreatedBy: &userID,
		IsActive:  true,
		Priority:  0,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}
