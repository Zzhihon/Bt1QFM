<template>
  <div class="announcement-manage">
    <div class="page-header">
      <h2>公告管理</h2>
      <button class="btn-primary" @click="showCreateForm = true">发布公告</button>
    </div>

    <div class="announcement-list">
      <div v-if="announcements.length === 0" class="empty-state">
        暂无公告
      </div>
      <div v-for="announcement in announcements" :key="announcement.id" class="announcement-card">
        <div class="card-header">
          <h3>{{ announcement.title }}</h3>
          <div class="actions">
            <button class="btn-danger" @click="deleteAnnouncement(announcement.id)">
              删除
            </button>
          </div>
        </div>
        <div class="card-content">
          <div class="meta">
            <span class="version">版本 {{ announcement.version }}</span>
            <span class="type" :class="`type-${announcement.type}`">
              {{ getTypeText(announcement.type) }}
            </span>
            <span class="time">{{ formatTime(announcement.createdAt) }}</span>
          </div>
          <div class="content" v-html="announcement.content"></div>
        </div>
      </div>
    </div>

    <!-- 创建公告表单 -->
    <div v-if="showCreateForm" class="modal-overlay" @click="showCreateForm = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>发布新公告</h3>
          <button class="close-btn" @click="showCreateForm = false">&times;</button>
        </div>
        <form @submit.prevent="createAnnouncement" class="form">
          <div class="form-group">
            <label>标题</label>
            <input v-model="form.title" type="text" required>
          </div>
          <div class="form-group">
            <label>版本号</label>
            <input v-model="form.version" type="text" placeholder="例如: 1.2.0" required>
          </div>
          <div class="form-group">
            <label>类型</label>
            <select v-model="form.type" required>
              <option value="info">信息</option>
              <option value="success">成功</option>
              <option value="warning">警告</option>
              <option value="error">错误</option>
            </select>
          </div>
          <div class="form-group">
            <label>内容</label>
            <textarea v-model="form.content" rows="6" required></textarea>
          </div>
          <div class="form-actions">
            <button type="button" @click="showCreateForm = false">取消</button>
            <button type="submit" class="btn-primary" :disabled="creating">
              {{ creating ? '发布中...' : '发布公告' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Announcement, CreateAnnouncementRequest } from '../types/announcement';
import { announcementApi } from '../api/announcement';

const announcements = ref<Announcement[]>([]);
const showCreateForm = ref(false);
const creating = ref(false);

const form = ref<CreateAnnouncementRequest>({
  title: '',
  content: '',
  version: '',
  type: 'info'
});

const loadAnnouncements = async () => {
  try {
    const response = await announcementApi.getAnnouncements();
    announcements.value = response.data;
  } catch (error) {
    console.error('加载公告失败:', error);
  }
};

const createAnnouncement = async () => {
  creating.value = true;
  try {
    await announcementApi.createAnnouncement(form.value);
    showCreateForm.value = false;
    form.value = { title: '', content: '', version: '', type: 'info' };
    await loadAnnouncements();
  } catch (error) {
    console.error('创建公告失败:', error);
  } finally {
    creating.value = false;
  }
};

const deleteAnnouncement = async (id: string) => {
  if (!confirm('确定要删除这个公告吗？')) return;
  
  try {
    await announcementApi.deleteAnnouncement(id);
    await loadAnnouncements();
  } catch (error) {
    console.error('删除公告失败:', error);
  }
};

const getTypeText = (type: string) => {
  const typeMap = {
    info: '信息',
    success: '成功',
    warning: '警告',
    error: '错误'
  };
  return typeMap[type as keyof typeof typeMap] || type;
};

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('zh-CN');
};

onMounted(() => {
  loadAnnouncements();
});
</script>

<style scoped>
.announcement-manage {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.btn-primary {
  background: #1976d2;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-danger {
  background: #f44336;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.announcement-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 16px;
  overflow: hidden;
}

.card-header {
  padding: 16px;
  background: #f8f9fa;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e0e0e0;
}

.card-content {
  padding: 16px;
}

.meta {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 12px;
}

.version {
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 8px;
  border-radius: 12px;
}

.type {
  padding: 2px 8px;
  border-radius: 12px;
}

.type-info { background: #e1f5fe; color: #0277bd; }
.type-success { background: #e8f5e8; color: #2e7d32; }
.type-warning { background: #fff3e0; color: #f57c00; }
.type-error { background: #ffebee; color: #c62828; }

.content {
  line-height: 1.6;
  color: #333;
}

.modal-overlay {
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

.modal {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
}

.form {
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-weight: 500;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.empty-state {
  text-align: center;
  padding: 64px 16px;
  color: #999;
}
</style>
