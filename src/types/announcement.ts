export interface Announcement {
  id: string;
  title: string;
  content: string;
  version: string;
  type: 'info' | 'warning' | 'success' | 'error';
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementRequest {
  title: string;
  content: string;
  version: string;
  type: 'info' | 'warning' | 'success' | 'error';
}
