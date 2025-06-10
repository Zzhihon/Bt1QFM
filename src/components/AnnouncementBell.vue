<template>
  <div class="announcement-bell">
    <button class="bell-btn" @click="toggleDropdown" :class="{ active: showDropdown }">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
      </svg>
      <span v-if="unreadCount > 0" class="badge">{{ unreadCount }}</span>
    </button>
    
    <div v-if="showDropdown" class="dropdown" @click.stop>
      <div class="dropdown-header">
        <span>版本公告</span>
        <button v-if="unreadCount > 0" class="mark-all-btn" @click="markAllAsRead">
          全部已读
        </button>
      </div>
      <div class="dropdown-content">
        <div v-if="announcements.length === 0" class="empty-state">
          暂无公告
        </div>
        <div 
          v-for="announcement in announcements" 
          :key="announcement.id"
          class="announcement-item"
          :class="{ unread: !announcement.isRead }"
          @click="showAnnouncement(announcement)"
        >
          <div class="item-header">
            <span class="title">{{ announcement.title }}</span>
            <span class="version">v{{ announcement.version }}</span>
          </div>
          <div class="item-time">{{ formatTime(announcement.createdAt) }}</div>
          <div v-if="!announcement.isRead" class="unread-dot"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { Announcement } from '../types/announcement';
import { announcementApi } from '../api/announcement';

const showDropdown = ref(false);
const announcements = ref<Announcement[]>([]);

const unreadCount = computed(() => {
  return announcements.value.filter(a => !a.isRead).length;
});

const emit = defineEmits<{
  showAnnouncement: [announcement: Announcement];
}>();

const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value;
  if (showDropdown.value) {
    loadAnnouncements();
  }
};

const loadAnnouncements = async () => {
  try {
    const response = await announcementApi.getAnnouncements();
    announcements.value = response.data;
  } catch (error) {
    console.error('加载公告失败:', error);
  }
};

const markAllAsRead = async () => {
  try {
    const unreadIds = announcements.value.filter(a => !a.isRead).map(a => a.id);
    await Promise.all(unreadIds.map(id => announcementApi.markAsRead(id)));
    announcements.value.forEach(a => a.isRead = true);
  } catch (error) {
    console.error('标记全部已读失败:', error);
  }
};

const showAnnouncement = (announcement: Announcement) => {
  showDropdown.value = false;
  emit('showAnnouncement', announcement);
};

const formatTime = (time: string) => {
  const date = new Date(time);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
};

onMounted(() => {
  loadAnnouncements();
});

// 点击外部关闭下拉框
document.addEventListener('click', () => {
  showDropdown.value = false;
});
</script>

<style scoped>
.announcement-bell {
  position: relative;
}

.bell-btn {
  background: none;
  border: none;
  cursor: pointer;
  position: relative;
  padding: 8px;
  border-radius: 4px;
  color: #666;
  transition: all 0.2s;
}

.bell-btn:hover,
.bell-btn.active {
  background: #f5f5f5;
  color: #1976d2;
}

.badge {
  position: absolute;
  top: 4px;
  right: 4px;
  background: #f44336;
  color: white;
  border-radius: 50%;
  width: 16px;
  height: 16px;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  width: 320px;
  max-height: 400px;
  z-index: 100;
}

.dropdown-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mark-all-btn {
  background: none;
  border: none;
  color: #1976d2;
  cursor: pointer;
  font-size: 12px;
}

.dropdown-content {
  max-height: 300px;
  overflow-y: auto;
}

.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: #999;
}

.announcement-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}

.announcement-item:hover {
  background: #f8f9fa;
}

.announcement-item.unread {
  background: #f0f8ff;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.title {
  font-weight: 500;
  color: #333;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version {
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 10px;
  margin-left: 8px;
}

.item-time {
  font-size: 12px;
  color: #999;
}

.unread-dot {
  position: absolute;
  top: 16px;
  right: 12px;
  width: 8px;
  height: 8px;
  background: #f44336;
  border-radius: 50%;
}
</style>
