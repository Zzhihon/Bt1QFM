import { ApiResponse } from './types';
import type { Announcement, CreateAnnouncementRequest } from '../types/announcement';

const API_BASE = '/api';

// 检查响应是否为JSON格式
const parseResponse = async (response: Response): Promise<any> => {
  const text = await response.text();
  
  if (!text) {
    throw new Error('服务器返回空响应');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('解析响应失败:', text);
    throw new Error('服务器返回了无效的JSON响应');
  }
};

export const announcementApi = {
  // 获取公告列表
  getAnnouncements: async (): Promise<ApiResponse<Announcement[]>> => {
    const response = await fetch(`${API_BASE}/announcements`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await parseResponse(response);
  },

  // 获取未读公告
  getUnreadAnnouncements: async (): Promise<ApiResponse<Announcement[]>> => {
    const response = await fetch(`${API_BASE}/announcements/unread`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await parseResponse(response);
  },

  // 标记公告为已读
  markAsRead: async (id: string): Promise<ApiResponse<void>> => {
    const response = await fetch(`${API_BASE}/announcements/${id}/read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await parseResponse(response);
  },

  // 创建公告（管理员）
  createAnnouncement: async (data: CreateAnnouncementRequest): Promise<ApiResponse<Announcement>> => {
    const response = await fetch(`${API_BASE}/announcements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await parseResponse(response);
  },

  // 删除公告（管理员）
  deleteAnnouncement: async (id: string): Promise<ApiResponse<void>> => {
    const response = await fetch(`${API_BASE}/announcements/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await parseResponse(response);
  },

  // 获取公告统计信息（管理员）
  getStats: async (): Promise<ApiResponse<any>> => {
    const response = await fetch(`${API_BASE}/announcements/stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await parseResponse(response);
  }
};
