package repository

import (
	"database/sql"
	"fmt"
	"time"
	"Bt1QFM/model"
	"Bt1QFM/db"
)

type AnnouncementRepository struct {
	DB *sql.DB
}

func NewAnnouncementRepository() *AnnouncementRepository {
	return &AnnouncementRepository{DB: db.DB}
}

// GetAnnouncements 获取所有活跃公告（按优先级和创建时间排序）
func (r *AnnouncementRepository) GetAnnouncements() ([]model.Announcement, error) {
	query := `SELECT id, title, content, version, type, created_at, updated_at, created_by, is_active, priority
		FROM announcements 
		WHERE is_active = 1 
		ORDER BY priority DESC, created_at DESC`
	
	rows, err := r.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var announcements []model.Announcement
	for rows.Next() {
		var announcement model.Announcement
		var createdBy sql.NullInt64
		
		err := rows.Scan(
			&announcement.ID,
			&announcement.Title,
			&announcement.Content,
			&announcement.Version,
			&announcement.Type,
			&announcement.CreatedAt,
			&announcement.UpdatedAt,
			&createdBy,
			&announcement.IsActive,
			&announcement.Priority,
		)
		if err != nil {
			return nil, err
		}
		
		if createdBy.Valid {
			createdByUint := uint(createdBy.Int64)
			announcement.CreatedBy = &createdByUint
		}
		
		announcements = append(announcements, announcement)
	}
	
	return announcements, rows.Err()
}

// GetAnnouncementsWithReadStatus 获取公告并标记用户已读状态
func (r *AnnouncementRepository) GetAnnouncementsWithReadStatus(userID uint) ([]model.AnnouncementResponse, error) {
	// 获取所有活跃公告
	announcements, err := r.GetAnnouncements()
	if err != nil {
		return nil, err
	}

	// 获取用户的已读记录
	readMap, err := r.getUserReadMap(userID)
	if err != nil {
		return nil, err
	}

	// 构建响应数据
	var responses []model.AnnouncementResponse
	for _, announcement := range announcements {
		isRead := readMap[announcement.ID]
		responses = append(responses, announcement.ToResponse(isRead))
	}

	return responses, nil
}

// getUserReadMap 获取用户已读记录映射
func (r *AnnouncementRepository) getUserReadMap(userID uint) (map[string]bool, error) {
	query := `SELECT announcement_id FROM user_announcement_reads WHERE user_id = ?`
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	readMap := make(map[string]bool)
	for rows.Next() {
		var announcementID string
		if err := rows.Scan(&announcementID); err != nil {
			return nil, err
		}
		readMap[announcementID] = true
	}
	
	return readMap, rows.Err()
}

// GetUnreadAnnouncements 获取用户未读公告
func (r *AnnouncementRepository) GetUnreadAnnouncements(userID uint) ([]model.AnnouncementResponse, error) {
	query := `SELECT a.id, a.title, a.content, a.version, a.type, a.created_at, a.updated_at, a.created_by, a.is_active, a.priority
		FROM announcements a
		LEFT JOIN user_announcement_reads r ON a.id = r.announcement_id AND r.user_id = ?
		WHERE a.is_active = 1 AND r.announcement_id IS NULL
		ORDER BY a.priority DESC, a.created_at DESC`
	
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var responses []model.AnnouncementResponse
	for rows.Next() {
		var announcement model.Announcement
		var createdBy sql.NullInt64
		
		err := rows.Scan(
			&announcement.ID,
			&announcement.Title,
			&announcement.Content,
			&announcement.Version,
			&announcement.Type,
			&announcement.CreatedAt,
			&announcement.UpdatedAt,
			&createdBy,
			&announcement.IsActive,
			&announcement.Priority,
		)
		if err != nil {
			return nil, err
		}
		
		if createdBy.Valid {
			createdByUint := uint(createdBy.Int64)
			announcement.CreatedBy = &createdByUint
		}
		
		responses = append(responses, announcement.ToResponse(false))
	}
	
	return responses, rows.Err()
}

// CreateAnnouncement 创建公告
func (r *AnnouncementRepository) CreateAnnouncement(announcement *model.Announcement) error {
	query := `INSERT INTO announcements (id, title, content, version, type, created_at, updated_at, created_by, is_active, priority)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	var createdBy interface{}
	if announcement.CreatedBy != nil {
		createdBy = *announcement.CreatedBy
	}
	
	_, err := r.DB.Exec(query,
		announcement.ID,
		announcement.Title,
		announcement.Content,
		announcement.Version,
		announcement.Type,
		announcement.CreatedAt,
		announcement.UpdatedAt,
		createdBy,
		announcement.IsActive,
		announcement.Priority,
	)
	
	return err
}

// DeleteAnnouncement 软删除公告（设置is_active为false）
func (r *AnnouncementRepository) DeleteAnnouncement(id string) error {
	query := `UPDATE announcements SET is_active = 0, updated_at = ? WHERE id = ?`
	_, err := r.DB.Exec(query, time.Now(), id)
	return err
}

// GetAnnouncementByID 根据ID获取公告
func (r *AnnouncementRepository) GetAnnouncementByID(id string) (*model.Announcement, error) {
	query := `SELECT id, title, content, version, type, created_at, updated_at, created_by, is_active, priority
		FROM announcements 
		WHERE id = ? AND is_active = 1`
	
	var announcement model.Announcement
	var createdBy sql.NullInt64
	
	err := r.DB.QueryRow(query, id).Scan(
		&announcement.ID,
		&announcement.Title,
		&announcement.Content,
		&announcement.Version,
		&announcement.Type,
		&announcement.CreatedAt,
		&announcement.UpdatedAt,
		&createdBy,
		&announcement.IsActive,
		&announcement.Priority,
	)
	
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("公告不存在")
		}
		return nil, err
	}
	
	if createdBy.Valid {
		createdByUint := uint(createdBy.Int64)
		announcement.CreatedBy = &createdByUint
	}
	
	return &announcement, nil
}

// MarkAsRead 标记公告为已读
func (r *AnnouncementRepository) MarkAsRead(userID uint, announcementID string) error {
	// 检查是否已经标记为已读
	var count int
	checkQuery := `SELECT COUNT(*) FROM user_announcement_reads WHERE user_id = ? AND announcement_id = ?`
	err := r.DB.QueryRow(checkQuery, userID, announcementID).Scan(&count)
	if err != nil {
		return err
	}
	
	// 如果没有已读记录，创建新记录
	if count == 0 {
		insertQuery := `INSERT INTO user_announcement_reads (user_id, announcement_id, read_at) VALUES (?, ?, ?)`
		_, err = r.DB.Exec(insertQuery, userID, announcementID, time.Now())
		return err
	}
	
	// 如果已经存在记录，不做任何操作
	return nil
}

// IsUserRead 检查用户是否已读公告
func (r *AnnouncementRepository) IsUserRead(userID uint, announcementID string) (bool, error) {
	var count int
	query := `SELECT COUNT(*) FROM user_announcement_reads WHERE user_id = ? AND announcement_id = ?`
	err := r.DB.QueryRow(query, userID, announcementID).Scan(&count)
	return count > 0, err
}

// GetUserReadCount 获取用户已读公告数量统计
func (r *AnnouncementRepository) GetUserReadCount(userID uint) (int64, error) {
	var count int64
	query := `SELECT COUNT(*) FROM user_announcement_reads WHERE user_id = ?`
	err := r.DB.QueryRow(query, userID).Scan(&count)
	return count, err
}

// GetAnnouncementStats 获取公告统计信息
func (r *AnnouncementRepository) GetAnnouncementStats() (map[string]interface{}, error) {
	var totalCount, activeCount int64
	
	// 总公告数
	err := r.DB.QueryRow(`SELECT COUNT(*) FROM announcements`).Scan(&totalCount)
	if err != nil {
		return nil, err
	}
	
	// 活跃公告数
	err = r.DB.QueryRow(`SELECT COUNT(*) FROM announcements WHERE is_active = 1`).Scan(&activeCount)
	if err != nil {
		return nil, err
	}
	
	stats := map[string]interface{}{
		"total_announcements":  totalCount,
		"active_announcements": activeCount,
	}
	
	return stats, nil
}
