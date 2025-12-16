# 1QFM 系统架构图

## 完整技术栈架构流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CI/CD Pipeline                              │
│                      (GitHub Actions)                                │
│                                                                       │
│  Code Push → Build → Test → Docker Image → Deploy                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Production Server                           │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                    Nginx (Reverse Proxy)                    │    │
│  │         - SSL Termination                                   │    │
│  │         - Static File Serving                               │    │
│  │         - Load Balancing                                    │    │
│  └──────────────────┬──────────────────────────────────────────┘    │
│                     │                                                │
│         ┌───────────┴──────────┐                                    │
│         │                      │                                    │
│         ▼                      ▼                                    │
│  ┌─────────────┐      ┌──────────────────┐                         │
│  │   React     │      │  Golang Service  │                         │
│  │  Frontend   │      │   (Backend API)  │                         │
│  │             │      │                  │                         │
│  │  - Vite     │      │  - Gorilla Mux   │                         │
│  │  - TypeScript│     │  - GORM          │                         │
│  │  - HLS.js   │      │  - WebSocket     │                         │
│  │  - Tailwind │      │  - FFmpeg        │                         │
│  └─────────────┘      └────────┬─────────┘                         │
│                                 │                                    │
│                     ┌───────────┼───────────┐                       │
│                     │           │           │                       │
│                     ▼           ▼           ▼                       │
│              ┌──────────┐ ┌─────────┐ ┌─────────┐                  │
│              │  MySQL   │ │  Redis  │ │  MinIO  │                  │
│              │          │ │         │ │         │                  │
│              │ - User   │ │ - Cache │ │ - Audio │                  │
│              │ - Album  │ │ - Session│ │ - Images│                  │
│              │ - Track  │ │ - Queue │ │ - Files │                  │
│              │ - Chat   │ │         │ │         │                  │
│              └──────────┘ └─────────┘ └─────────┘                  │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## 数据流向说明

### 1. 用户请求流程
```
User Browser
    │
    ├─→ Static Assets (HTML/CSS/JS)
    │       └─→ Nginx → React Frontend
    │
    └─→ API Requests
            └─→ Nginx → Golang Service
                    │
                    ├─→ MySQL (用户数据、专辑信息)
                    ├─→ Redis (缓存、会话)
                    └─→ MinIO (音频文件、图片)
```

### 2. CI/CD 部署流程
```
Developer Push Code
    │
    ▼
GitHub Repository
    │
    ▼
GitHub Actions Trigger
    │
    ├─→ Frontend Build (npm install → vite build)
    ├─→ Backend Build (go build)
    └─→ Docker Build (Multi-stage)
            │
            ▼
    Docker Registry (Docker Hub + GitHub CR)
            │
            ▼
    SSH to Production Server
            │
            ▼
    Docker Compose Pull & Restart
```

### 3. 音频处理流程
```
User Upload Audio
    │
    ▼
Golang Service (Temporary Storage)
    │
    ▼
FFmpeg Transcoding (HLS Format)
    │
    ▼
MinIO Storage (Persistent)
    │
    ├─→ Redis (Cache URL)
    └─→ MySQL (Metadata)
            │
            ▼
    React Frontend (HLS.js Playback)
```

## 技术栈总览

| 层级 | 技术 | 用途 |
|------|------|------|
| **CI/CD** | GitHub Actions | 自动化构建、测试、部署 |
| **反向代理** | Nginx | SSL终止、负载均衡、静态文件服务 |
| **前端** | React + TypeScript + Vite | 用户界面、音频播放 |
| **后端** | Golang + Gorilla Mux + GORM | API服务、业务逻辑 |
| **数据库** | MySQL 8.0+ | 关系型数据存储 |
| **缓存** | Redis 6.0+ | 高速缓存、会话管理 |
| **对象存储** | MinIO | 音频文件、图片存储 |
| **容器化** | Docker + Docker Compose | 服务编排、部署 |
