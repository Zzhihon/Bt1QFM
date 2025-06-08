# 1QFM - 个人音乐电台系统

网页体验:https://1qfm.tatakal.com

一个功能丰富的个人音乐电台服务，支持音频流处理、专辑管理、网易云音乐集成和智能缓存系统。基于Go语言开发，提供完整的前后端分离架构。

## 🚀 核心特性

* **🎵 音频流处理**: 基于FFmpeg的HLS音频转码和实时流处理
* **🗂️ 专辑管理**: 完整的专辑创建、编辑和曲目管理功能
* **☁️ 三级缓存架构**: 临时文件 → Redis缓存 → MinIO持久化存储
* **🎧 网易云音乐集成**: 搜索、播放网易云音乐资源，支持动态封面
* **📋 播放列表管理**: 用户个性化播放列表的CRUD操作和拖拽排序
* **⚡ 智能预处理**: 搜索结果首歌自动预处理，提升播放体验
* **🔐 用户认证系统**: JWT身份认证，支持用户注册和登录
* **🌐 现代化界面**: React前端，支持暗色主题和响应式设计
* **📊 实时流传输**: WebSocket音频流传输支持
* **🛠️ 命令行工具**: 完整的CLI工具支持系统管理

## 🛠 技术栈

### 后端
* **Go 1.19+** - 主要开发语言
* **MySQL 8.0+** - 主数据库
* **Redis 6.0+** - 缓存和会话管理
* **MinIO** - 对象存储服务
* **FFmpeg** - 音频处理和转码
* **JWT** - 身份认证
* **Gorilla Mux** - HTTP路由
* **Zap** - 结构化日志

### 前端
* **React 18** - 前端框架
* **TypeScript** - 类型安全
* **Tailwind CSS** - 样式框架
* **HLS.js** - 音频流播放
* **Lucide React** - 图标库


## ⚡ 快速开始

### 环境要求

* **Go 1.19+**
* **MySQL 8.0+**
* **Redis 6.0+**
* **FFmpeg 4.0+**
* **MinIO** (可选，建议用于生产环境)
* **Node.js 16+** (前端构建)

### 安装配置

1. **克隆项目**
```bash
git clone <repository-url>
cd Bt1QFM
```

2. **后端配置**
```bash
# 复制配置文件
cp .env.example .env

# 编辑配置文件
vim .env
```

3. **数据库初始化**
```bash
# 创建数据库
mysql -u root -p -e "CREATE DATABASE fm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 运行程序，自动创建表结构
go run main.go
```

4. **前端构建**
```bash
cd web/ui
npm install
npm run build
cd ../..
```

5. **启动服务**
```bash
# 开发模式启动
go run main.go

# 或构建后运行
go build -o 1qfm_server
./1qfm_server
```

访问 `http://localhost:8080` 查看界面。


## 🚀 核心功能详解

### 音频流处理系统

**三级缓存架构**：
1. **临时文件缓存** - 上传文件的临时存储，自动清理
2. **Redis缓存** - 热点数据和播放列表的高速缓存
3. **MinIO存储** - 音频文件和元数据的持久化存储

**HLS流处理**：
- 自动将上传的音频转码为HLS格式
- 4秒分片设计，优化加载速度
- 支持多码率自适应流媒体
- 异步处理，不阻塞用户操作

**智能文件管理**：
- 安全的文件命名规则
- 自动重复处理检测
- 失败重试机制
- 定时清理过期文件

### 播放列表管理

**Redis实现**：
- 基于有序集合的高效排序
- 支持拖拽重排序
- 自动过期清理机制
- 支持本地曲目和网易云音乐混合播放

**功能特点**：
- 实时同步更新
- 批量操作支持
- 播放历史记录
- 个性化推荐基础

### 网易云音乐集成

**搜索功能**：
- 实时搜索API集成
- 歌曲详情自动获取
- 动态封面视频支持
- 智能缓存减少API调用

**播放支持**：
- 无缝集成到播放列表
- 自动预处理热门结果
- 错误处理和降级方案

### 用户系统

**认证机制**：
- JWT Token认证
- 密码bcrypt加密存储
- 支持用户名/邮箱登录
- 自动Token刷新

**权限控制**：
- 基于中间件的权限验证
- 用户数据隔离
- API访问频率限制

## 📊 性能特性

* **高并发处理**: 支持1000+并发用户
* **智能缓存**: Redis缓存命中率99%+
* **异步处理**: 音频转码不阻塞用户操作
* **自动伸缩**: 基于负载的资源分配
* **错误恢复**: 完善的错误处理和重试机制
* **监控告警**: 结构化日志和性能监控

## 🔐 安全特性

* **身份认证**: JWT Token + 密码加密
* **输入验证**: 严格的数据验证和过滤
* **文件安全**: 文件类型检查和大小限制
* **API保护**: 请求频率限制和防护
* **CORS配置**: 跨域请求安全控制
* **SQL注入防护**: 参数化查询

### 添加新功能流程

1. **数据模型** - 在`model/`中定义结构体
2. **数据访问** - 在`repository/`中实现CRUD操作
3. **业务逻辑** - 在`core/`中编写核心逻辑
4. **API接口** - 在`server/`中添加HTTP处理器
5. **前端界面** - 在`web/ui/src/`中添加React组件
6. **测试验证** - 编写单元测试和集成测试

### 配置管理

```go
// 配置加载示例
cfg := config.Load()
dbHost := cfg.DBHost // 自动加载环境变量或默认值
```

## 🐳 Docker部署

```dockerfile
# Dockerfile示例
FROM golang:1.19-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o 1qfm_server

FROM alpine:latest
RUN apk add --no-cache ffmpeg
COPY --from=builder /app/1qfm_server /usr/local/bin/
EXPOSE 8080
CMD ["1qfm_server"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - DB_HOST=mysql
      - REDIS_HOST=redis
    depends_on:
      - mysql
      - redis
      - minio
  
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: password
      MYSQL_DATABASE: fm
    volumes:
      - mysql_data:/var/lib/mysql
  
  redis:
    image: redis:6.0-alpine
    volumes:
      - redis_data:/data
  
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data

volumes:
  mysql_data:
  redis_data:
  minio_data:
```


## 📈 监控和维护

### 健康检查

```bash
# 检查服务状态
curl http://localhost:8080/health

# 检查数据库连接
curl http://localhost:8080/health/db

# 检查Redis连接
curl http://localhost:8080/health/redis
```

### 性能监控

系统提供以下监控指标：
- API响应时间
- 数据库连接池状态
- Redis缓存命中率
- 音频处理队列长度
- 内存和CPU使用率

### 日志分析

```bash
# 查看错误日志
tail -f logs/app.log | grep "level\":\"error"

# 分析API性能
grep "api_duration" logs/app.log | sort -k5 -nr

# 监控用户活动
grep "user_action" logs/app.log | tail -100
```

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



## 🤝 贡献指南

### 开发环境设置

1. Fork项目到个人仓库
2. 克隆到本地开发环境
3. 安装开发依赖
4. 配置Git hooks

```bash
# 安装pre-commit hooks
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
pre-commit install
```

### 代码规范

- 遵循Go语言标准格式化 (`go fmt`)
- 使用golangci-lint进行代码检查
- 编写单元测试，覆盖率>80%
- 遵循semantic commit message规范

### 提交流程

1. 创建特性分支 (`git checkout -b feature/amazing-feature`)
2. 编写代码和测试
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建Pull Request

## 📄 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🎵 致谢
* [FFmpeg](https://ffmpeg.org/) - 强大的音频视频处理工具
* [Redis](https://redis.io/) - 高性能内存数据库
* [MinIO](https://min.io/) - 高性能对象存储
* [网易云音乐API](https://github.com/Binaryify/NeteaseCloudMusicApi) - 提供音乐数据源
* [Gorilla Mux](https://github.com/gorilla/mux) - HTTP路由库
* [Zap](https://github.com/uber-go/zap) - 高性能日志库

---

**📧 联系方式**: 如有问题或建议，请提交Issue或发送邮件。

**🌟 Star支持**: 如果这个项目对您有帮助，请给个Star支持一下！
