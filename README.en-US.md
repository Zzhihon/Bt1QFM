# 1QFM - Personal Music Radio System

Web Experience: https://1qfm.tatakal.com

A feature-rich personal music radio service supporting audio stream processing, album management, NetEase Cloud Music integration, and intelligent caching systems. Developed in Go, providing a complete front-end and back-end separation architecture.

## 🚀 Core Features

* **🎵 Audio Stream Processing**: HLS audio transcoding and real-time stream processing based on FFmpeg
* **🗂️ Album Management**: Complete functions for album creation, editing, and track management
* **☁️ Three-level Cache Architecture**: Temporary files → Redis cache → MinIO persistent storage
* **🎧 NetEase Cloud Music Integration**: Search and play NetEase Cloud Music resources, support for dynamic covers
* **📋 Playlist Management**: CRUD operations and drag-and-drop sorting for user-customized playlists
* **⚡ Intelligent Preprocessing**: Automatic preprocessing of the first song in search results to enhance playback experience
* **🔐 User Authentication System**: JWT authentication, supporting user registration and login
* **🌐 Modern Interface**: React front-end, supporting dark theme and responsive design
* **📊 Real-time Stream Transmission**: WebSocket audio stream transmission support
* **🛠️ Command Line Tools**: Complete CLI tools for system management

## 🛠 Technology Stack

### Backend
* **Go 1.19+** - Main programming language
* **MySQL 8.0+** - Primary database
* **Redis 6.0+** - Cache and session management
* **MinIO** - Object storage service
* **FFmpeg** - Audio processing and transcoding
* **JWT** - Identity authentication
* **Gorilla Mux** - HTTP routing
* **Zap** - Structured logging

### Frontend
* **React 18** - Front-end framework
* **TypeScript** - Type safety
* **Tailwind CSS** - Styling framework
* **HLS.js** - Audio stream playback
* **Lucide React** - Icon library


## ⚡ Quick Start

### Environment Requirements

* **Go 1.19+**
* **MySQL 8.0+**
* **Redis 6.0+**
* **FFmpeg 4.0+**
* **MinIO** (Optional, recommended for production environments)
* **Node.js 16+** (Front-end building)

### Installation Configuration

1. **Clone Project**
```bash
git clone <repository-url>
cd Bt1QFM
```

2. **Backend Configuration**
```bash
# Copy configuration file
cp .env.example .env

# Edit configuration file
vim .env
```

3. **Database Initialization**
```bash
# Create database
mysql -u root -p -e "CREATE DATABASE fm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Run the program, automatically create table structures
go run main.go
```

4. **Frontend Building**
```bash
cd web/ui
npm install
npm run build
cd ../..
```

5. **Start Service**
```bash
# Start in development mode
go run main.go

# Or run after building
go build -o 1qfm_server
./1qfm_server
```

Access `http://localhost:8080` to view the interface.


## 🚀 Core Features Details

### Audio Stream Processing System

**Three-level Cache Architecture**:
1. **Temporary File Cache** - Temporary storage for uploaded files, auto-cleanup
2. **Redis Cache** - High-speed cache for hotspot data and playlists
3. **MinIO Storage** - Persistent storage for audio files and metadata

**HLS Stream Processing**:
- Automatically transcode uploaded audio to HLS format
- 4-second segmentation design for optimized loading speed
- Support for multi-bitrate adaptive streaming media
- Asynchronous processing without blocking user operations

**Smart File Management**:
- Secure file naming rules
- Automatic duplicate processing detection
- Failed retry mechanism
- Scheduled cleanup of expired files

### Playlist Management

**Redis Implementation**:
- Efficient sorting based on sorted sets
- Support for drag-and-drop reordering
- Automatic expiration cleanup mechanism
- Support for local tracks and NetEase Cloud Music mixed playback

**Feature Characteristics**:
- Real-time synchronized updates
- Batch operation support
- Playback history records
- Personalized recommendation foundation

### NetEase Cloud Music Integration

**Search Function**:
- Real-time search API integration
- Automatic retrieval of song details
- Dynamic cover video support
- Smart cache to reduce API calls

**Playback Support**:
- Seamless integration into playlists
- Automatic preprocessing of popular results
- Error handling and downgrade solutions

### User System

**Authentication Mechanism**:
- JWT Token authentication
- Password bcrypt encryption storage
- Support for username/email login
- Automatic Token refresh

**Permission Control**:
- Permission verification based on middleware
- User data isolation
- API access rate limiting

## 📊 Performance Features

* **High Concurrency Processing**: Supports 1000+ concurrent users
* **Intelligent Cache**: Redis cache hit rate 99%+
* **Asynchronous Processing**: Audio transcoding does not block user operations
* **Automatic Scaling**: Resource allocation based on load
* **Error Recovery**: Complete error handling and retry mechanisms
* **Monitoring and Alerts**: Structured logs and performance monitoring

## 🔐 Security Features

* **Identity Authentication**: JWT Token + Password Encryption
* **Input Validation**: Strict data validation and filtering
* **File Security**: File type checking and size limits
* **API Protection**: Request frequency limiting and protection
* **CORS Configuration**: Cross-domain request secure control
- **SQL Injection Protection**: Parameterized queries

### Adding New Features Process

1. **Data Model** - Define structs in `model/`
2. **Data Access** - Implement CRUD operations in `repository/`
3. **Business Logic** - Write core logic in `core/`
4. **API Interface** - Add HTTP handlers in `server/`
5. **Front-end Interface** - Add React components in `web/ui/src/`
6. **Test Verification** - Write unit tests and integration tests

### Configuration Management

```go
// Configuration loading example
cfg := config.Load()
dbHost := cfg.DBHost // Automatically load environment variables or default values
```

## 🐳 Docker Deployment

```dockerfile
# Dockerfile example
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


## 📈 Monitoring and Maintenance

### Health Checks

```bash
# Check service status
curl http://localhost:8080/health

# Check database connection
curl http://localhost:8080/health/db

# Check Redis connection
curl http://localhost:8080/health/redis
```

### Performance Monitoring

The system provides the following monitoring metrics:
- API response time
- Database connection pool status
- Redis cache hit rate
- Audio processing queue length
- Memory and CPU usage

### Log Analysis

```bash
# View error logs
tail -f logs/app.log | grep "level\":\"error"

# Analyze API performance
grep "api_duration" logs/app.log | sort -k5 -nr

# Monitor user activity
grep "user_action" logs/app.log | tail -100
```

# Bt1QFM - Web Music Player

A modern ultra-lightweight web music player front-end, supporting local music and NetEase Cloud Music.
Originally intended for managing crawled audio files, later added a new feature bot.

## 🎵 Feature Set

### 🎧 Playback Features
- **HLS Stream Media Playback** - Supports HLS protocol playback of local audio files
- **NetEase Cloud Music** - Integrated search and playback functionality for NetEase Cloud Music
- **Playback Modes** - Sequential playback, loop playback, single loop, random playback
- **Playback Controls** - Play/pause, previous/next, progress control, volume control

### 📚 Music Management
- **Music Library** - Manage local uploaded music files
- **Album Management** - Create, edit albums, batch upload songs
- **Playlists** - Create and manage playlists
- **Bot Assistant** - Search and play NetEase Cloud Music through chat interface

### 🎨 Interface Design
- **Multi-theme Support** - Cyberpunk, Minimalist, Dark Mode, Retro Style
- **Responsive Design** - Adapted for desktop and mobile端
- **Discord Style** - Bot view adopts a chat interface similar to Discord

## 🛠️ Technology Stack

- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + Custom CSS Variables
- **Audio**: HLS.js + Web Audio API
- **Icons**: Lucide React
- **Routing**: React Router DOM
- **Tools**: Lodash + Papaparse

## 📁 Project Structure

```
src/
├── components/
│   ├── auth/           # Login/Register components
│   ├── common/         # Common components
│   ├── layout/         # Layout components
│   ├── player/         # Player components
│   ├── upload/         # Upload related components
│   └── views/          # Page view components
├── contexts/           # React Context
│   ├── AuthContext     # User authentication
│   ├── PlayerContext   # Player state
│   └── ToastContext    # Message prompts
├── types/              # TypeScript type definitions
└── utils/              # Utility functions
```

## 🚀 Quick Start

### Environment Requirements
- Node.js 16+
- Modern browsers (supporting HLS)

### Install Dependencies
```bash
npm install
```

### Development Run
```bash
npm run dev
```

### Build Production Version
```bash
npx vite build --mode production
```

## ⚙️ Configuration

### Environment Variables
```bash
VITE_BACKEND_URL=http://localhost:8080  # Backend API address
```

### Runtime Configuration
The project supports dynamic injection of configuration at runtime through `window.__ENV__`:

```javascript
// public/config/env-config.js
window.__ENV__ = {
  BACKEND_URL: 'http://localhost:8080'
};
```

## 🎯 Core Features

### Player (Player)
- Fixed player control bar at the bottom
- Support for HLS stream media playback
- Playback progress memory (restored after page refresh)
- Multiple playback mode switching

### Music Library (Music Library)
- Grid layout display of music files
- Album artwork display
- Click to play and add to playlist

### Bot Assistant (Bot View)
- Discord-style chat interface
- Search music through `/netease [song name]`
- Direct playback or add to playlist

### Theme System
- 4 preset themes
- Dynamic CSS variable switching
- Theme settings persistence

## 🔌 API Integration

### Backend Interface
- `/api/auth/*` - User authentication
- `/api/tracks` - Music file management
- `/api/playlist` - Playlist management
- `/api/albums` - Album management
- `/api/netease/*` - NetEase Cloud Music interface

### Audio Stream
- `/streams/{id}/playlist.m3u8` - HLS playback list
- `/streams/netease/{id}/playlist.m3u8` - NetEase Cloud Music stream

## 🎨 Theme Customization

The project uses a CSS variable system, allowing easy theme customization:

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

## 📱 Responsive Design

- Desktop: Full feature display
- Mobile: Optimized playback controls and navigation
- Adaptive layout, supporting various screen sizes

## 🔧 Development Notes

### Route Configuration
The project supports subdirectory deployment, configured in `App.tsx` as `basename="/1qfm"`.

### State Management
Uses React Context for state management, supporting player state persistence.

### Type Safety
Complete TypeScript type definitions to ensure code quality.

---

**Note**: This project requires corresponding backend API services to work together.



## 🤝 Contribution Guide

### Development Environment Setup

1. Fork the project to your personal repository
2. Clone to local development environment
3. Install development dependencies
4. Configure Git hooks

```bash
# Install pre-commit hooks
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
pre-commit install
```

### Code Specifications

- Follow Go language standard formatting (`go fmt`)
- Use golangci-lint for code checking
- Write unit tests, coverage >80%
- Follow semantic commit message specifications

### Submission Process

1. Create a feature branch (`git checkout -b feature/amazing-feature`)
2. Write code and tests
3. Submit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Create Pull Request

## 📄 License

This project uses MIT License - See [LICENSE](LICENSE) file for details.

## 🎵 Acknowledgements
* [FFmpeg](https://ffmpeg.org/) - Powerful audio video processing tool
* [Redis](https://redis.io/) - High-performance in-memory database
* [MinIO](https://min.io/) - High-performance object storage
* [NetEase Cloud Music API](https://github.com/Binaryify/NeteaseCloudMusicApi) - Provides music data sources
* [Gorilla Mux](https://github.com/gorilla/mux) - HTTP routing library
* [Zap](https://github.com/uber-go/zap) - High-performance logging library

---

**📧 Contact**: For questions or suggestions, please submit an Issue or send an email.

**🌟 Star Support**: If this project has been helpful to you, please give it a Star!
