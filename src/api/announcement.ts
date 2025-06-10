import { request } from './request';
import type { Announcement, CreateAnnouncementRequest } from '../types/announcement';

export const announcementApi = {
  // 获取公告列表
  getAnnouncements: () => {
    return request<Announcement[]>({
      url: '/api/announcements',
      method: 'GET'
    });
  },

  // 获取未读公告
  getUnreadAnnouncements: () => {
    return request<Announcement[]>({
      url: '/api/announcements/unread',
      method: 'GET'
    });
  },

  // 标记公告为已读
  markAsRead: (id: string) => {
    return request({
      url: `/api/announcements/${id}/read`,
      method: 'PUT'
    });
  },

  // 创建公告（管理员）
  createAnnouncement: (data: CreateAnnouncementRequest) => {
    return request<Announcement>({
      url: '/api/announcements',
      method: 'POST',
      data
    });
  },

  // 删除公告（管理员）
  deleteAnnouncement: (id: string) => {
    return request({
      url: `/api/announcements/${id}`,
      method: 'DELETE'
    });
  }
};
