 📂 模块职责分析

  1️⃣ 核心层（core/）

  core/
  ├── audio/          # 音频处理核心
  │   ├── FFmpeg 转码
  │   ├── HLS 流式处理
  │   ├── Pipeline 流水线
  │   └── 预热服务
  ├── room/           # 房间协同核心
  │   ├── RoomHub (WebSocket 中枢)
  │   ├── RoomManager (业务逻辑)
  │   └── Subscription (发布订阅)
  ├── agent/          # AI 对话核心
  │   └── MusicAgent (流式聊天)
  ├── netease/        # 网易云音乐集成
  │   ├── 歌曲搜索
  │   ├── 歌单管理
  │   └── 歌词获取
  ├── plugin/         # 插件系统
  │   └── MusicPlugin 接口
  └── auth/           # 认证授权
      └── JWT Token

  2️⃣ 数据层（repository/ + model/）

  repository/        # 数据访问层（DAO）
  ├── track_repository.go      # 歌曲 CRUD
  ├── album_repository.go      # 专辑 CRUD
  ├── user_repository.go       # 用户 CRUD
  ├── room_repository.go       # 房间 CRUD
  └── chat_repository.go       # 聊天记录

  model/            # 数据模型（Entity）
  ├── track.go      # 歌曲实体
  ├── album.go      # 专辑实体
  ├── user.go       # 用户实体
  ├── room.go       # 房间实体
  └── chat.go       # 聊天记录

  3️⃣ 接口层（server/）

  server/
  ├── server.go              # 路由注册 + 服务启动
  ├── track_handlers.go      # 歌曲管理接口
  ├── album_handler.go       # 专辑管理接口
  ├── user_handler.go        # 用户管理接口
  ├── room_handler.go        # 房间管理接口
  ├── chat_handler.go        # AI 聊天接口
  ├── stream_handler.go      # 流媒体服务
  └── ws_stream.go           # WebSocket 流式推送

  4️⃣ 存储层（storage/ + cache/）

  storage/
  └── minio.go              # MinIO 对象存储封装

  cache/
  ├── redis.go              # Redis 连接管理
  ├── segment_cache.go      # 音频分片缓存
  ├── playlist_cache.go     # 播放列表缓存
  └── room_cache.go         # 房间状态缓存

  5️⃣ 基础设施（db/ + logger/ + config/）

  db/
  ├── database.go           # MySQL 连接池
  └── gorm.go              # GORM ORM 封装

  logger/
  └── logger.go            # 结构化日志（zap）

  config/
  └── config.go            # 配置管理

  ---
  🔄 请求处理流程图

  graph TB
      subgraph "前端客户端"
          A[React App]
          B[WebSocket Client]
      end

      subgraph "网关层 (server.go:145-240)"
          C[Gorilla Mux Router]
          D[CORS Middleware]
          E[Auth Middleware]
      end

      subgraph "接口层 (server/)"
          F1[Track Handler]
          F2[Album Handler]
          F3[Room Handler]
          F4[Chat Handler]
          F5[Stream Handler]
          F6[Netease Handler]
      end

      subgraph "核心业务层 (core/)"
          G1[Audio Processor]
          G2[Room Manager]
          G3[Music Agent]
          G4[Netease Client]
          G5[Room Hub]
      end

      subgraph "数据访问层 (repository/)"
          H1[Track Repo]
          H2[Album Repo]
          H3[Room Repo]
          H4[User Repo]
          H5[Chat Repo]
      end

      subgraph "存储层"
          I1[(MySQL)]
          I2[(Redis)]
          I3[MinIO]
      end

      subgraph "外部服务"
          J1[网易云音乐 API]
          J2[OpenAI 兼容 API]
      end

      A -->|HTTP REST| C
      B -->|WebSocket| C
      C --> D
      D --> E
      E --> F1 & F2 & F3 & F4 & F5 & F6

      F1 --> G1
      F2 --> G1
      F3 --> G2
      F4 --> G3
      F5 --> G1
      F6 --> G4

      G1 --> H1 & H2
      G2 --> H3 & H4
      G3 --> H5
      G2 --> G5

      H1 & H2 & H3 & H4 & H5 --> I1
      G1 --> I2 & I3
      G2 --> I2
      G4 --> J1
      G3 --> J2

      G5 -->|实时推送| B

  ---
  📊 典型业务流程示例

  🎵 音乐播放流程

  sequenceDiagram
      participant U as 用户
      participant R as Router
      participant SH as Stream Handler
      participant AP as Audio Processor
      participant C as Redis Cache
      participant M as MinIO
      participant N as Netease API

      U->>R: GET /streams/netease/{id}/playlist.m3u8
      R->>SH: 转发请求

      alt 缓存命中
          SH->>C: 查询 m3u8
          C-->>SH: 返回缓存
          SH-->>U: 返回播放列表
      else 缓存未命中
          SH->>N: 获取歌曲 URL
          N-->>SH: 返回音频 URL
          SH->>AP: 启动渐进式转码
          AP->>AP: FFmpeg 实时转码

          par 并行处理
              AP->>C: 写入分片缓存
          and
              AP->>M: 上传分片到 MinIO
          end

          AP-->>SH: 返回首个分片
          SH->>SH: 生成动态 m3u8
          SH-->>U: 返回播放列表（EVENT 类型）

          Note over AP,U: 后续分片持续生成
          AP->>C: 持续写入新分片
          AP->>M: 持续上传分片

          AP->>SH: 转码完成通知
          SH->>SH: 更新 m3u8 为 VOD 类型
      end

  ---
  🏠 房间协同流程

  sequenceDiagram
      participant U1 as 房主
      participant U2 as 成员
      participant WS as WebSocket
      participant RH as Room Hub
      participant RM as Room Manager
      participant Sub as Subscription Mgr
      participant C as Redis Cache

      U1->>WS: 创建房间
      WS->>RM: CreateRoom()
      RM->>C: 写入房间状态
      RM-->>U1: 返回房间 ID

      U2->>WS: 加入房间
      WS->>RM: JoinRoom()
      RM->>C: 添加成员
      RM->>RH: BroadcastMemberJoin()
      RH-->>U1: 推送成员加入消息

      U1->>WS: 切换到听歌模式
      WS->>RM: SwitchMode(listen)
      RM->>Sub: SetMaster(U1)
      RM->>C: 更新用户模式

      U2->>WS: 切换到听歌模式
      WS->>RM: SwitchMode(listen)
      RM->>Sub: Subscribe(U2)

      loop 播放状态同步
          U1->>WS: MasterReport (播放状态)
          WS->>RM: handleMasterReport()
          RM->>C: SetPlaybackState()
          RM->>Sub: Publish(state)
          Sub-->>U2: 推送播放状态
      end

      alt 授权用户切歌
          U2->>WS: SongChange (新歌曲)
          WS->>RM: handleSongChange()
          RM->>RM: 验证权限
          RM->>C: 更新状态（版本号 +1）
          RM->>Sub: BroadcastSongChange()
          Sub-->>U1: 通知房主切歌
          Sub-->>U2: 确认切歌成功
      end

  ---
  🤖 AI 聊天流程

  sequenceDiagram
      participant U as 用户
      participant WS as WebSocket
      participant CH as Chat Handler
      participant MA as Music Agent
      participant AI as OpenAI API
      participant MP as Music Plugin
      participant N as Netease API

      U->>WS: 连接 /ws/chat
      WS->>CH: 建立连接

      U->>WS: "我想听周杰伦的稻香"
      WS->>CH: 处理消息
      CH->>MA: ChatStream()

      MA->>AI: POST /chat/completions (stream=true)

      loop SSE 流式回复
          AI-->>MA: chunk: "好的！"
          MA-->>CH: callback(chunk)
          CH-->>U: 推送文本

          AI-->>MA: chunk: "<search_music>稻香
  周杰伦</search_music>"
          MA-->>CH: callback(chunk)
          CH-->>U: 推送文本
      end

      MA->>MA: ParseSearchMusic()
      MA->>MP: Search("稻香 周杰伦", 3)
      MP->>N: 搜索歌曲
      N-->>MP: 返回搜索结果
      MP-->>MA: 返回歌曲列表

      MA-->>CH: 返回完整回复 + 歌曲列表
      CH->>CH: 保存聊天记录
      CH-->>U: 推送歌曲卡片

  ---
  🔧 启动流程（server.go:28-302）

  graph TD
      A[Start] --> B[加载配置]
      B --> C[初始化日志系统]
      C --> D[连接 MinIO]
      D --> E[连接 MySQL]
      E --> F[连接 Redis]
      F --> G[连接 GORM]
      G --> H[数据库迁移]
      H --> I[创建必要目录]
      I --> J[初始化处理器]

      J --> J1[AudioProcessor]
      J --> J2[StreamProcessor]
      J --> J3[NeteaseHandler]
      J --> J4[ChatHandler]
      J --> J5[RoomManager]
      J --> J6[PreheatService]

      J1 & J2 & J3 & J4 & J5 & J6 --> K[注册路由]

      K --> K1[API 路由]
      K --> K2[WebSocket 路由]
      K --> K3[静态文件服务]

      K1 & K2 & K3 --> L[启动 HTTP Server]
      L --> M[启动 RoomHub]
      L --> N[启动 PreheatService]
      L --> O[启动清理协程]

      M & N & O --> P[等待中断信号]
      P --> Q[优雅关闭]

  ---
  💡 关键设计亮点

  1. 分层架构清晰

  接口层 (Handler) → 业务层 (Manager/Processor) → 数据层
  (Repository) → 存储层 (Cache/DB)

  2. 依赖注入

  // server.go:91-130
  roomRepo := repository.NewGormRoomRepository(db.GormDB)
  roomCache := cache.NewRoomCache()
  roomHub := room.NewRoomHub()
  roomManager := room.NewRoomManager(roomRepo, roomCache, roomHub)
  roomHandler := NewRoomHandler(roomManager)

  3. 单例模式

  // subscription.go:22-34
  var subscriptionManager *PlaybackSubscription
  var subscriptionOnce sync.Once

  func GetSubscriptionManager() *PlaybackSubscription {
      subscriptionOnce.Do(func() { ... })
  }

  4. 中间件链

  // server.go:148-163
  router.Use(CORSMiddleware)
  router.HandleFunc("/api/*", AuthMiddleware(handler))

  5. 优雅关闭

  // server.go:281-301
  <-stop  // 等待中断信号
  preheatService.Stop()
  roomHub.Stop()
  server.Shutdown(ctx)