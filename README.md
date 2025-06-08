# Bt1QFM - Web Music Player

一个现代化地极致轻量的网页音乐播放器前端，支持本地音乐和网易云音乐。
本意是用来管理抓轨出来的音频，后面又添加了一个新功能bot

## 🎵 功能特性

### 🎧 播放功能
- **HLS 流媒体播放** - 支持 HLS 协议播放本地音频文件
- **网易云音乐** - 集成网易云音乐搜索和播放功能
- **播放模式** - 顺序播放、循环播放、单曲循环、随机播放
- **播放控制** - 播放/暂停、上一首/下一首、进度控制、音量控制

### 📚 音乐管理
- **音乐库** - 管理本地上传的音乐文件
- **专辑管理** - 创建、编辑专辑，批量上传歌曲
- **播放列表** - 创建和管理播放列表
- **Bot 助手** - 通过聊天界面搜索和播放网易云音乐

### 🎨 界面设计
- **多主题支持** - 赛博朋克、极简主义、暗夜模式、复古风格
- **响应式设计** - 适配桌面端和移动端
- **Discord 风格** - Bot 视图采用类似 Discord 的聊天界面

## 🛠️ 技术栈

- **框架**: React 18 + TypeScript + Vite
- **样式**: Tailwind CSS + 自定义 CSS 变量
- **音频**: HLS.js + Web Audio API
- **图标**: Lucide React
- **路由**: React Router DOM
- **工具**: Lodash + Papaparse

## 📁 项目结构

```
src/
├── components/
│   ├── auth/           # 登录注册组件
│   ├── common/         # 通用组件
│   ├── layout/         # 布局组件
│   ├── player/         # 播放器组件
│   ├── upload/         # 上传相关组件
│   └── views/          # 页面视图组件
├── contexts/           # React Context
│   ├── AuthContext     # 用户认证
│   ├── PlayerContext   # 播放器状态
│   └── ToastContext    # 消息提示
├── types/              # TypeScript 类型定义
└── utils/              # 工具函数
```

## 🚀 快速开始

### 环境要求
- Node.js 16+
- 现代浏览器（支持 HLS）

### 安装依赖
```bash
npm install
```

### 开发运行
```bash
npm run dev
```

### 构建生产版本
```bash
npx vite build --mode production
```

## ⚙️ 配置

### 环境变量
```bash
VITE_BACKEND_URL=http://localhost:8080  # 后端API地址
```

### 运行时配置
项目支持通过 `window.__ENV__` 进行运行时动态注入配置：

```javascript
// public/config/env-config.js
window.__ENV__ = {
  BACKEND_URL: 'http://localhost:8080'
};
```

## 🎯 核心功能

### 播放器 (Player)
- 底部固定播放控制栏
- 支持 HLS 流媒体播放
- 播放进度记忆（页面刷新后恢复）
- 多种播放模式切换

### 音乐库 (Music Library)
- 网格布局展示音乐文件
- 封面图片显示
- 点击播放和添加到播放列表

### Bot 助手 (Bot View)
- Discord 风格的聊天界面
- 通过 `/netease [歌曲名]` 搜索音乐
- 直接播放或添加到播放列表

### 主题系统
- 4 种预设主题
- CSS 变量动态切换
- 主题设置持久化

## 🔌 API 集成

### 后端接口
- `/api/auth/*` - 用户认证
- `/api/tracks` - 音乐文件管理
- `/api/playlist` - 播放列表管理
- `/api/albums` - 专辑管理
- `/api/netease/*` - 网易云音乐接口

### 音频流
- `/streams/{id}/playlist.m3u8` - HLS 播放列表
- `/streams/netease/{id}/playlist.m3u8` - 网易云音乐流

## 🎨 主题定制

项目使用 CSS 变量系统，可轻松定制主题：

```css
:root {
  --cyber-bg: #FFFFFF;
  --cyber-bg-darker: #F5F5F5;
  --cyber-text: #333333;
  --cyber-primary: #2563EB;
  --cyber-secondary: #64748B;
  --cyber-hover-primary: #1D4ED8;
  --cyber-hover-secondary: #475569;
}
```

## 📱 响应式设计

- 桌面端：完整功能展示
- 移动端：优化的播放控制和导航
- 自适应布局，支持各种屏幕尺寸

## 🔧 开发说明

### 路由配置
项目支持子路径部署，在 `App.tsx` 中配置 `basename="/1qfm"`。

### 状态管理
使用 React Context 进行状态管理，支持播放状态持久化。

### 类型安全
完整的 TypeScript 类型定义，确保代码质量。

---

**注意**: 本项目需要配合对应的后端 API 服务使用。
