<template>
  <div v-if="visible" class="announcement-modal-overlay" @click="closeModal">
    <div class="announcement-modal" @click.stop>
      <div class="modal-header">
        <h3>{{ announcement.title }}</h3>
        <button class="close-btn" @click="closeModal">&times;</button>
      </div>
      <div class="modal-content">
        <div class="version-tag" :class="`tag-${announcement.type}`">
          版本 {{ announcement.version }}
        </div>
        <div class="announcement-content" v-html="announcement.content"></div>
        <div class="announcement-time">
          发布时间: {{ formatTime(announcement.createdAt) }}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" @click="markAsReadAndClose">我知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';
import type { Announcement } from '../types/announcement';
import { announcementApi } from '../api/announcement';

interface Props {
  visible: boolean;
  announcement: Announcement;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  close: [];
  read: [id: string];
}>();

const closeModal = () => {
  emit('close');
};

const markAsReadAndClose = async () => {
  try {
    await announcementApi.markAsRead(props.announcement.id);
    emit('read', props.announcement.id);
    closeModal();
  } catch (error) {
    console.error('标记已读失败:', error);
    closeModal();
  }
};

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('zh-CN');
};
</script>

<style scoped>
.announcement-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.announcement-modal {
  background: white;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
}

.modal-content {
  padding: 20px;
  max-height: 400px;
  overflow-y: auto;
}

.version-tag {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 16px;
}

.tag-info { background: #e1f5fe; color: #0277bd; }
.tag-success { background: #e8f5e8; color: #2e7d32; }
.tag-warning { background: #fff3e0; color: #f57c00; }
.tag-error { background: #ffebee; color: #c62828; }

.announcement-content {
  line-height: 1.6;
  color: #333;
  margin-bottom: 16px;
}

.announcement-time {
  font-size: 12px;
  color: #999;
}

.modal-footer {
  padding: 20px;
  border-top: 1px solid #eee;
  text-align: right;
}

.btn-primary {
  background: #1976d2;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1565c0;
}
</style>
