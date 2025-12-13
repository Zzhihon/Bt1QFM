package repository

import (
	"context"
	"time"

	"Bt1QFM/model"

	"gorm.io/gorm"
)

// RoomRepository 房间数据访问接口
type RoomRepository interface {
	// 房间 CRUD
	Create(ctx context.Context, room *model.Room) error
	GetByID(ctx context.Context, id string) (*model.Room, error)
	Update(ctx context.Context, room *model.Room) error
	Close(ctx context.Context, id string) error
	ExistsByID(ctx context.Context, id string) (bool, error)

	// 成员管理
	AddMember(ctx context.Context, member *model.RoomMember) error
	GetMember(ctx context.Context, roomID string, userID int64) (*model.RoomMember, error)
	UpdateMember(ctx context.Context, member *model.RoomMember) error
	RemoveMember(ctx context.Context, roomID string, userID int64) error
	GetActiveMembers(ctx context.Context, roomID string) ([]*model.RoomMember, error)
	CountActiveMembers(ctx context.Context, roomID string) (int64, error)

	// 权限管理
	TransferOwner(ctx context.Context, roomID string, fromUserID, toUserID int64) error
	GrantControl(ctx context.Context, roomID string, userID int64, canControl bool) error
	UpdateMemberMode(ctx context.Context, roomID string, userID int64, mode string) error

	// 消息管理
	CreateMessage(ctx context.Context, msg *model.RoomMessage) error
	GetMessages(ctx context.Context, roomID string, limit, offset int) ([]*model.RoomMessage, error)
}

// gormRoomRepository GORM 实现
type gormRoomRepository struct {
	db *gorm.DB
}

// NewGormRoomRepository 创建 GORM 房间仓库
func NewGormRoomRepository(db *gorm.DB) RoomRepository {
	return &gormRoomRepository{db: db}
}

// ========== 房间 CRUD ==========

// Create 创建房间
func (r *gormRoomRepository) Create(ctx context.Context, room *model.Room) error {
	return r.db.WithContext(ctx).Create(room).Error
}

// GetByID 根据ID获取房间
func (r *gormRoomRepository) GetByID(ctx context.Context, id string) (*model.Room, error) {
	var room model.Room
	err := r.db.WithContext(ctx).
		Where("id = ? AND status = ?", id, model.RoomStatusActive).
		First(&room).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &room, nil
}

// Update 更新房间
func (r *gormRoomRepository) Update(ctx context.Context, room *model.Room) error {
	return r.db.WithContext(ctx).Save(room).Error
}

// Close 关闭房间
func (r *gormRoomRepository) Close(ctx context.Context, id string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.Room{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":    model.RoomStatusClosed,
			"closed_at": now,
		}).Error
}

// ExistsByID 检查房间ID是否存在
func (r *gormRoomRepository) ExistsByID(ctx context.Context, id string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Room{}).
		Where("id = ?", id).
		Count(&count).Error
	return count > 0, err
}

// ========== 成员管理 ==========

// AddMember 添加成员
func (r *gormRoomRepository) AddMember(ctx context.Context, member *model.RoomMember) error {
	return r.db.WithContext(ctx).Create(member).Error
}

// GetMember 获取成员信息
func (r *gormRoomRepository) GetMember(ctx context.Context, roomID string, userID int64) (*model.RoomMember, error) {
	var member model.RoomMember
	err := r.db.WithContext(ctx).
		Where("room_id = ? AND user_id = ? AND left_at IS NULL", roomID, userID).
		First(&member).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &member, nil
}

// UpdateMember 更新成员信息
func (r *gormRoomRepository) UpdateMember(ctx context.Context, member *model.RoomMember) error {
	return r.db.WithContext(ctx).Save(member).Error
}

// RemoveMember 移除成员（软删除，设置离开时间）
func (r *gormRoomRepository) RemoveMember(ctx context.Context, roomID string, userID int64) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.RoomMember{}).
		Where("room_id = ? AND user_id = ? AND left_at IS NULL", roomID, userID).
		Update("left_at", now).Error
}

// GetActiveMembers 获取活跃成员列表
func (r *gormRoomRepository) GetActiveMembers(ctx context.Context, roomID string) ([]*model.RoomMember, error) {
	var members []*model.RoomMember
	err := r.db.WithContext(ctx).
		Where("room_id = ? AND left_at IS NULL", roomID).
		Order("joined_at ASC").
		Find(&members).Error
	return members, err
}

// CountActiveMembers 统计活跃成员数量
func (r *gormRoomRepository) CountActiveMembers(ctx context.Context, roomID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.RoomMember{}).
		Where("room_id = ? AND left_at IS NULL", roomID).
		Count(&count).Error
	return count, err
}

// ========== 权限管理 ==========

// TransferOwner 转移房主权限
func (r *gormRoomRepository) TransferOwner(ctx context.Context, roomID string, fromUserID, toUserID int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 更新房间 owner_id
		if err := tx.Model(&model.Room{}).
			Where("id = ?", roomID).
			Update("owner_id", toUserID).Error; err != nil {
			return err
		}

		// 更新原房主角色为 member，移除控制权限
		if err := tx.Model(&model.RoomMember{}).
			Where("room_id = ? AND user_id = ? AND left_at IS NULL", roomID, fromUserID).
			Updates(map[string]interface{}{
				"role":        model.RoomRoleMember,
				"can_control": false,
			}).Error; err != nil {
			return err
		}

		// 更新新房主角色为 owner，授予控制权限
		if err := tx.Model(&model.RoomMember{}).
			Where("room_id = ? AND user_id = ? AND left_at IS NULL", roomID, toUserID).
			Updates(map[string]interface{}{
				"role":        model.RoomRoleOwner,
				"can_control": true,
			}).Error; err != nil {
			return err
		}

		return nil
	})
}

// GrantControl 授予或撤销播放控制权限
func (r *gormRoomRepository) GrantControl(ctx context.Context, roomID string, userID int64, canControl bool) error {
	return r.db.WithContext(ctx).Model(&model.RoomMember{}).
		Where("room_id = ? AND user_id = ? AND left_at IS NULL", roomID, userID).
		Update("can_control", canControl).Error
}

// UpdateMemberMode 更新成员模式
func (r *gormRoomRepository) UpdateMemberMode(ctx context.Context, roomID string, userID int64, mode string) error {
	return r.db.WithContext(ctx).Model(&model.RoomMember{}).
		Where("room_id = ? AND user_id = ? AND left_at IS NULL", roomID, userID).
		Update("mode", mode).Error
}

// ========== 消息管理 ==========

// CreateMessage 创建消息
func (r *gormRoomRepository) CreateMessage(ctx context.Context, msg *model.RoomMessage) error {
	return r.db.WithContext(ctx).Create(msg).Error
}

// GetMessages 获取消息列表（按时间倒序获取，返回时按时间正序）
func (r *gormRoomRepository) GetMessages(ctx context.Context, roomID string, limit, offset int) ([]*model.RoomMessage, error) {
	var messages []*model.RoomMessage
	err := r.db.WithContext(ctx).
		Where("room_id = ?", roomID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error

	if err != nil {
		return nil, err
	}

	// 反转为时间正序
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, nil
}
