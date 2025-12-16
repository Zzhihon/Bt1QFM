# 1QFM - Intelligent Music Radio System

---

## I. Project Overview & Design Philosophy

### 1.1 Project Vision & Goals

**1QFM** is a modern personal music radio platform designed for music enthusiasts and digital album collectors. The core objective is to create a **lightweight, intelligent, and personalized** music management and playback ecosystem, providing users with a complete music asset management solution.

**Core Design Principles:**

- **Extremely Lightweight**: Abandoning bloated commercial music software design, focusing on core functionality, with frontend compressed to under 2MB
- **Local-First**: Supporting complete management of local music files (such as ripped FLAC, WAV lossless audio), breaking free from cloud dependency
- **AI-Enhanced**: Natural language music search and recommendations through AI assistant "XiaoQ", reducing user operation costs
- **Social Innovation**: Chat room shared listening feature, making music no longer a solitary experience
- **Technology Forward**: Adopting modern tech stack including HLS streaming protocol, three-tier cache architecture, WebSocket real-time communication

### 1.2 Project Roadmap

**Short-term Goals (Current Version):**
- [Completed] Complete local music library management (albums, playlists, track management)
- [Completed] Implement AI intelligent assistant chat and music recommendation
- [Completed] Establish stable audio streaming and caching system
- [Completed] Complete user authentication and data isolation system

**Mid-term Goals (Next 6-12 months):**
- [Planned] Real-time multi-user synchronized listening in chat rooms (WebSocket room system)
- [Planned] Music social features (playlist sharing, comment system, user following)
- [Planned] Advanced audio processing (EQ equalizer, audio tag editing, format conversion)
- [Planned] Native mobile applications (iOS/Android)

**Long-term Vision:**
- [Research] Establish decentralized music sharing network (P2P music transmission)
- [Research] AI music analysis and auto-tagging (emotion recognition, style classification)
- [Research] Cross-platform synchronization and cloud backup
- [Research] Music creator support platform (direct connection between artists and listeners)

---

## II. Core Feature System

### 2.1 Local Music Asset Management System

**Pain Point Analysis:**
Mainstream music platforms (Apple Music, Spotify, NetEase Cloud Music) are all centered on streaming subscription business models, with insufficient support for local music files:
- **Apple Music**: Local music mixed with cloud library, chaotic album management
- **Spotify**: Extremely weak local file support, unable to customize album covers and metadata
- **NetEase Cloud Music**: Local music playback functionality exists in name only, no album grouping

**Our Solution:**

#### 2.1.1 Album Management
- **Batch Upload**: Support drag-and-drop upload of entire album audio files
- **Metadata Editing**: Customize album name, artist, cover image, release year
- **Track Sorting**: Drag to adjust track order, support multi-disc album management
- **Format Support**: FLAC, WAV, MP3, AAC, OGG and other mainstream audio formats

#### 2.1.2 Intelligent Three-Tier Cache Architecture
To ensure high-concurrency playback performance, the system adopts a layered caching strategy:

1. **L1 - Temporary File Cache**
   - Uploaded audio files immediately enter temporary storage (`/tmp` directory)
   - Support resumable upload and concurrent uploads
   - Automatic cleanup of expired files (24-hour TTL)

2. **L2 - Redis Hot Data Cache**
   - Playlist state (user's current track, progress)
   - Search result cache (NetEase Cloud API responses, 30-minute TTL)
   - User session data (JWT Token validation results)

3. **L3 - MinIO Object Storage**
   - Audio file persistent storage
   - HLS segment file storage (`.m3u8` and `.ts` files)
   - Album cover image storage
   - Support cross-region backup and CDN acceleration

#### 2.1.3 HLS Streaming Processing Engine
Automatic audio transcoding system based on FFmpeg:

```
Original Audio File → FFmpeg Transcoding → HLS Segments (4s/segment) → MinIO Storage
           ↓
     Async Task Queue (prevent blocking user uploads)
           ↓
     Redis Cache Playback URL → Client HLS.js Playback
```

**Technical Advantages:**
- Support lossless audio real-time transcoding to network-suitable bitrates
- 4-second segment design balances first-play latency and smoothness
- Client adaptive bitrate adjustment (based on network conditions)

---

### 2.2 AI Intelligent Assistant "XiaoQ"

**Market Gap Analysis:**
Existing music platforms' search and recommendation systems have the following problems:
- **Mechanical Keyword Matching**: Unable to understand natural language expressions (e.g., "quiet songs suitable for rainy days")
- **Recommendation Algorithm Black Box**: Users cannot intervene in recommendation logic, lacking transparency
- **No Emotional Interaction**: Cold UI interface, lacking sense of companionship

**"XiaoQ" Innovation Design:**

#### 2.2.1 Natural Language Music Search
- **Contextual Queries**: "Recommend electronic music suitable for night driving"
- **Emotion Recognition**: "I'm feeling down, want to listen to something healing"
- **Vague Descriptions**: "That song with 'starry sky' and 'wandering' in the lyrics"

#### 2.2.2 Streaming Conversation Response
Using WebSocket to implement typewriter effect for AI responses:
```
User Input → WebSocket Connection → AI Streaming Generation → Character-by-Character Display
                          ↓
                   Detect <search_music> Tag → Real-time Trigger Search
                          ↓
                   Return Song Card → Click to Play
```

**Key Technical Details:**
- **Layered Timeout Handling**: Soft timeout (8s) prompts "thinking", hard timeout (30s) suggests retry
- **Tag Parsing Engine**: Real-time parsing of `<search_music>song name artist</search_music>` tags in AI responses
- **Duplicate Prevention**: Ensure only 1 song search per conversation, avoiding traffic waste

#### 2.2.3 Conversation History Persistence
- Database storage of complete user conversation records (ChatMessage table)
- Support cross-session context recovery (SessionID association)
- Song card data persistence (JSON format stored in Songs field)

---

### 2.3 Chat Room Shared Listening Feature (Future Feature)

**Innovation Explanation:**

Existing music software all lack **real-time synchronized listening social functionality**. Although some products have "listen together" features, they have the following problems:
- **Spotify Group Session**: Premium subscribers only, requires same physical location
- **Apple Music SharePlay**: Apple ecosystem only, requires FaceTime call
- **QQ Music Listen Together**: Requires friend relationship, no public chat rooms

**Our Design (Technical Pre-research):**

#### 2.3.1 WebSocket Room System Architecture
```
User A Creates Room → Generate Room ID → Share Link
                    ↓
Users B, C, D Join → WebSocket Subscribe to Room Channel
                    ↓
User A Plays Song → Broadcast Play Command (Track ID + Timestamp)
                    ↓
All Users Sync Play → Real-time Sync Progress Bar (Heartbeat Mechanism)
```

#### 2.3.2 Time Synchronization Algorithm
NTP-style time calibration mechanism:
```
Client Time - Server Time = Time Offset
Playback Position = Base Timestamp + (Current Time - Start Time) - Offset
```

#### 2.3.3 Real-time Chat & Danmaku
- Text chat (Emoji support)
- Music comment danmaku (scrolling display)
- Song request mechanism (voting system)

---

## III. Technical Architecture Deep Dive

### 3.1 Backend Tech Stack

#### 3.1.1 Core Framework & Language
- **Golang 1.24+**: High concurrency performance, goroutine model naturally fits WebSocket and stream processing
- **Gorilla Mux**: Lightweight HTTP routing, RESTful design support
- **GORM**: ORM framework, MySQL connection pool and transaction management support

#### 3.1.2 Data Layer
**MySQL 8.0+** (Relational Database)
- Users table: User authentication information (bcrypt password encryption)
- Albums table: Album metadata
- Tracks table: Audio file information and HLS addresses
- Chat sessions table: AI conversation session management
- Chat messages table: Complete conversation records and song card data

**Redis 6.0+** (Cache & Session)
- Playlist (Sorted Set): User's current playback queue
- JWT Token blacklist (String + TTL): Logout token management
- Search result cache (Hash + TTL): Reduce external API calls

**MinIO** (Object Storage)
- Audio file persistent storage
- HLS segment file storage
- Image resource storage (covers, avatars)

#### 3.1.3 Audio Processing
- **FFmpeg 4.0+**: Audio transcoding engine
  - Input formats: FLAC, WAV, MP3, AAC
  - Output format: HLS (HTTP Live Streaming)
  - Encoding parameters: AAC 128kbps ~ 320kbps, 4-second segments

#### 3.1.4 Logging & Monitoring
- **Zap Logger**: Structured logging, log level and rotation support
- **Lumberjack**: Log file cutting and compression

### 3.2 Frontend Tech Stack

#### 3.2.1 Core Framework
- **React 18**: Declarative UI framework
- **TypeScript**: Type safety, reduce runtime errors
- **Vite**: Build tool, native ESM support, fast hot reload

#### 3.2.2 UI & Interaction
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Lightweight icon library (tree-shaking friendly)
- **HLS.js**: Browser-side HLS playback library
- **Lottie React**: Animation rendering (loading animations, music visualization)

#### 3.2.3 State Management
- **React Context API**:
  - `AuthContext`: User login state
  - `PlayerContext`: Player state (current track, play mode, volume)
  - `ToastContext`: Global message notifications

#### 3.2.4 Routing & Pages
- **React Router DOM 7**: Client-side routing
- Page structure:
  - `/login`: Login/register page
  - `/library`: Music library page (album grid display)
  - `/bot`: AI assistant chat page (Discord-style UI)
  - `/playlist`: Playlist management
  - `/settings`: User settings (theme switching, account management)

### 3.3 DevOps & Deployment Architecture

#### 3.3.1 CI/CD Pipeline
**GitHub Actions Automated Pipeline:**

1. **Code Push Trigger** (master branch)
2. **Frontend Build**:
   - `npm install` → `vite build`
   - Artifact compression and optimization (Gzip + Brotli)
3. **Backend Compilation**:
   - Go multi-stage build (reduce image size)
   - Compilation optimization parameters: `-ldflags="-s -w"`
4. **Docker Image Build**:
   - Base image: `golang:1.24-alpine` (build stage)
   - Runtime image: `alpine:latest` + `ffmpeg`
   - Multi-architecture support: `linux/amd64` (reserved arm64 support)
5. **Image Push**:
   - Docker Hub: `zzhihong/1qfm:latest`
   - GitHub Container Registry: `ghcr.io/zzhihon/bt1qfm:latest`
6. **Automatic Deployment**:
   - SSH connect to production server
   - Pull latest image
   - `docker compose up -d` rolling update
   - Clean up old images

#### 3.3.2 Production Environment Architecture
```
User Request → Nginx Reverse Proxy (SSL termination, Gzip compression)
            ↓
       1QFM Backend Service (Docker container)
            ↓
    +-------+-------+-------+
    |       |       |       |
  MySQL   Redis   MinIO  FFmpeg
(Persist) (Cache) (Storage)(Transcode)
```

**Nginx Configuration Highlights:**
- HTTP/2 support
- WebSocket proxy (`Upgrade` header handling)
- Static resource caching (frontend bundle cached for 7 days)
- Audio stream file caching (HLS segments cached for 1 hour)

#### 3.3.3 Docker Compose Orchestration
```yaml
services:
  backend:
    image: zzhihong/1qfm:latest
    depends_on:
      - mysql
      - redis
      - minio
    volumes:
      - ./cache:/app/cache  # Temporary file cache
      - ./logs:/app/logs    # Log persistence
    environment:
      - DB_HOST=mysql
      - REDIS_HOST=redis
      - MINIO_ENDPOINT=minio:9000

  mysql:
    image: mysql:8.0
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:6.0-alpine

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
```

---

## IV. Market Demand Analysis & Competitive Differentiation

### 4.1 Target User Profile

**Core User Groups:**
1. **Audiophiles**: Own large collections of FLAC/WAV lossless music files, need professional management tools
2. **Digital Album Collectors**: Purchase digital albums from Bandcamp, Beatport, need unified playback platform
3. **CD Ripping Enthusiasts**: Use EAC, dBpoweramp to rip CD tracks, need local player
4. **Privacy-Conscious Users**: Don't trust cloud music platforms' copyright censorship and data collection
5. **Tech Geeks**: Prefer self-hosted services, have preference for open-source software

### 4.2 Market Gap & Opportunities

#### 4.2.1 Local Music Management Gap
| Platform | Local Music Support | Album Management | Metadata Editing | Lossless Format |
|----------|---------------------|------------------|------------------|-----------------|
| **Apple Music** | Limited | Chaotic | Not Supported | Supported |
| **Spotify** | Extremely Weak | None | Not Supported | Not Supported |
| **NetEase Cloud** | In Name Only | No Grouping | Not Supported | Online Only |
| **1QFM** | Complete | Professional | Complete | Complete |

#### 4.2.2 AI Music Assistant Gap
Existing music platforms' "smart recommendations" are essentially collaborative filtering algorithms, unable to understand natural language:
- Cannot answer "what songs are suitable for rainy days"
- Cannot adjust in real-time based on user emotions
- Recommendation results lack explainability

**1QFM AI Assistant Advantages:**
- Natural language understanding (LLM-based)
- Context memory (conversation history analysis)
- Recommendation explainability (explain reasoning)

#### 4.2.3 Social Listening Feature Gap
Although some platforms have "listen together" features, they have many restrictions:
- **Spotify Group Session**: Premium users only, requires same WiFi
- **Apple SharePlay**: Requires FaceTime call, Apple devices only
- **QQ Music Listen Together**: Requires friend relationship, no public rooms

**1QFM Design Advantages:**
- Public chat rooms (no friend relationship required)
- Cross-platform support (Web + Mobile)
- Real-time danmaku interaction

---

## V. Creative Genesis & Product Evolution

### 5.1 Project Origin Story

**Phase 1: Personal CD Ripping Needs (Early 2023)**

The project founder is a classical music enthusiast with a large CD collection. After using EAC to rip CD tracks, discovered that no music software could properly manage local FLAC files:
- Apple Music's "Match" feature incorrectly identifies albums
- NetEase Cloud Music's local player has a crude interface
- Foobar2000, while professional, has an outdated interface and lacks modern features

**Initial Requirements:**
> "I need a modern web music player that can perfectly manage my ripped FLAC files, support album covers, metadata editing, and be accessible from any device."

**Phase 2: Technology Selection & Prototype (Mid-2023)**

- Chose Go language for backend (considering concurrency performance and deployment convenience)
- Chose React for frontend (mature ecosystem, efficient component development)
- Introduced HLS streaming technology (solving large file transfer and cross-platform compatibility)
- Developed first version of album upload and playback functionality

**Phase 3: AI Assistant Inspiration (Late 2023)**

After ChatGPT went viral, team members proposed:
> "Why can't we use AI to help search and recommend music? Traditional search boxes are too mechanical, I want to express my needs in natural language."

**Technical Research & Implementation:**
- Integrated OpenAI API (later changed to multi-model compatibility)
- Designed `<search_music>` tag system (allowing AI output to be parseable commands)
- Implemented WebSocket streaming conversation (enhancing user experience)
- Developed conversation history persistence (cross-session memory)

**Phase 4: Social Listening Concept (2024)**

While using Discord voice channels, team members realized:
> "Why can't there be a chat room like Discord, where everyone can listen to music together and interact in real-time?"

**Proof of Concept:**
- Technical pre-research on WebSocket room system
- Designed time synchronization algorithm
- Prototype developed danmaku system

**Current Status:**
Chat room functionality has completed technical pre-research, planned for official launch in v2.0.

### 5.2 Product Philosophy

**Core Values:**
1. **User Data Sovereignty**: Users own their music files, not dependent on any cloud service
2. **Technical Openness**: Open-source core code, allowing community contributions
3. **Experience First**: Even for niche needs, pursue ultimate experience
4. **Community-Driven**: Listen to user feedback, rapid iteration

**Design Principles:**
- **Minimalism**: Only do necessary functions, reject feature bloat
- **Performance Priority**: 3 seconds to complete page load, 1 second to start playback
- **Accessibility**: Support keyboard navigation and screen readers
- **Responsive Design**: Perfect adaptation for desktop, tablet, mobile

---

## VI. Technical Innovation Summary

### 6.1 Architectural Innovation
- **Three-Tier Cache System**: Balance performance and cost, hit rate reaches 99%+
- **HLS Streaming**: Support lossless audio real-time transcoding and adaptive bitrate
- **WebSocket Long Connection**: AI conversation streaming response and real-time music synchronization

### 6.2 Functional Innovation
- **AI Music Assistant**: Natural language search and emotional recommendations
- **Tag Parsing Engine**: Real-time parsing of AI output music search commands
- **Chat Room Synchronized Listening**: Multi-user real-time synchronized playback (future feature)

### 6.3 Engineering Innovation
- **GitHub Actions Fully Automated Deployment**: Code push to production in only 5 minutes
- **Docker Multi-Stage Build**: Image size optimized to 150MB
- **Frontend-Backend Separation Architecture**: Independent deployment and scaling

---

## VII. Future Development Roadmap

### 7.1 Near-term Goals (Within 3 months)
- [ ] Complete chat room functionality (WebSocket room system)
- [ ] Mobile responsive optimization (PWA support)
- [ ] Advanced audio processing (EQ equalizer)
- [ ] Lyrics display and synchronization

### 7.2 Mid-term Goals (6-12 months)
- [ ] iOS/Android native applications
- [ ] Music social features (playlist sharing, comments)
- [ ] Cross-device synchronization (playback progress, playlists)
- [ ] Advanced AI features (emotion recognition, music generation)

### 7.3 Long-term Vision (1+ years)
- [ ] Decentralized music network (P2P transmission)
- [ ] Music creator platform (direct artist connection)
- [ ] Open API ecosystem (third-party plugins)
- [ ] Multi-language internationalization support

---

## VIII. Conclusion

**1QFM** is not just a music player, but a reflection and challenge to existing music platform business models. We believe:

> **Music should belong to users, not platforms.**
> **Technology should serve experience, not commercialization.**
> **Communities should co-build and share, not passively consume.**

In the streaming era, we choose to stand with music lovers, creating a music platform that truly serves users.

---
**Author**: 1QFM Development Team
