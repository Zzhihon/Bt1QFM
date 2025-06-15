import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Music2, 
  User, 
  Globe, 
  Clock,
  Settings,
  Download,
  Share,
  Heart,
  Loader2
} from 'lucide-react';
import { usePlayer } from '../../contexts/PlayerContext';
import { useToast } from '../../contexts/ToastContext';
import { LyricResponse, ParsedLyricLine, ParsedWord, LyricMetadata } from '../../types';

// 获取后端 URL
const getBackendUrl = () => {
  if (typeof window !== 'undefined' && (window as any).__ENV__?.BACKEND_URL) {
    return (window as any).__ENV__.BACKEND_URL;
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
};

const LyricView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playerState, seekTo } = usePlayer();
  const { addToast } = useToast();
  
  const [lyricData, setLyricData] = useState<LyricResponse | null>(null);
  const [parsedLyrics, setParsedLyrics] = useState<ParsedLyricLine[]>([]);
  const [metadata, setMetadata] = useState<LyricMetadata>({});
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lyricMode, setLyricMode] = useState<'yrc' | 'lrc' | 'translation'>('yrc');
  const [fontSize, setFontSize] = useState(18);
  const [showSettings, setShowSettings] = useState(false);
  
  // 播放器状态同步相关
  const [localPlayerState, setLocalPlayerState] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isCurrentSong, setIsCurrentSong] = useState(false);
  
  const lyricContainerRef = useRef<HTMLDivElement>(null);
  const currentLineRef = useRef<HTMLDivElement>(null);

  // 从localStorage读取播放器状态
  const loadPlayerStateFromStorage = useCallback(() => {
    try {
      const savedState = localStorage.getItem('playerState');
      if (savedState) {
        const parsedState = JSON.parse(savedState);
        setLocalPlayerState(parsedState);
        
        // 检查当前歌词页面的歌曲是否是正在播放的歌曲
        const currentTrack = parsedState.currentTrack;
        if (currentTrack && currentTrack.neteaseId && id) {
          const isPlaying = currentTrack.neteaseId.toString() === id;
          setIsCurrentSong(isPlaying);
          
          if (isPlaying) {
            setCurrentTime(parsedState.currentTime || 0);
            console.log('🎵 检测到当前歌词页面正在播放，同步播放时间:', parsedState.currentTime);
          }
        }
      }
    } catch (error) {
      console.error('读取播放器状态失败:', error);
    }
  }, [id]);

  // 监听localStorage变化
  useEffect(() => {
    // 初始加载
    loadPlayerStateFromStorage();
    
    // 监听localStorage变化事件
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'playerState') {
        loadPlayerStateFromStorage();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // 定期检查播放器状态（兜底机制，因为同一页面的localStorage变化不会触发storage事件）
    const interval = setInterval(loadPlayerStateFromStorage, 1000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [loadPlayerStateFromStorage]);

  // 获取歌词数据
  const fetchLyricData = useCallback(async () => {
    if (!id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('正在获取歌词数据，歌曲ID:', id);
      const response = await fetch(`${getBackendUrl()}/api/netease/lyric/new?id=${id}`);
      
      if (!response.ok) {
        throw new Error(`获取歌词失败: ${response.status}`);
      }
      
      const data: LyricResponse = await response.json();
      console.log('歌词API响应:', data);
      
      if (data.code !== 200) {
        throw new Error('歌词服务返回错误');
      }
      
      setLyricData(data);
      
      // 解析歌词
      const parsed = parseLyrics(data);
      setParsedLyrics(parsed);
      console.log('解析后的歌词:', parsed.slice(0, 5));
      
      // 提取元数据
      const meta = extractMetadata(data);
      setMetadata(meta);
      
    } catch (error) {
      console.error('获取歌词失败:', error);
      setError(error instanceof Error ? error.message : '获取歌词失败');
      addToast({
        type: 'error',
        message: '获取歌词失败',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, [id, addToast]);

  // 解析歌词函数
  const parseLyrics = (data: LyricResponse): ParsedLyricLine[] => {
    const lines: ParsedLyricLine[] = [];
    
    // 优先使用逐字歌词(yrc)，否则使用普通歌词(lrc)
    const lyricSource = data.yrc?.lyric || data.lrc?.lyric || '';
    const translationSource = data.ytlrc?.lyric || data.tlyric?.lyric || '';
    const romaSource = data.yromalrc?.lyric || data.romalrc?.lyric || '';
    
    if (!lyricSource) return lines;
    
    // 解析翻译歌词映射
    const translationMap = new Map<number, string>();
    if (translationSource) {
      const translationLines = translationSource.split('\n');
      translationLines.forEach(line => {
        const timeMatch = line.match(/\[(\d+):(\d+)\.(\d+)\]/);
        if (timeMatch) {
          const time = parseInt(timeMatch[1]) * 60000 + parseInt(timeMatch[2]) * 1000 + parseInt(timeMatch[3]) * 10;
          const text = line.replace(/\[\d+:\d+\.\d+\]/, '').trim();
          if (text) {
            translationMap.set(time, text);
          }
        }
      });
    }
    
    // 解析主歌词
    const lyricLines = lyricSource.split('\n');
    
    lyricLines.forEach(line => {
      line = line.trim();
      if (!line) return;
      
      try {
        // 检查是否是逐字歌词格式 [time,duration](word_info)text
        const yrcMatch = line.match(/^\[(\d+),(\d+)\](.*)$/);
        if (yrcMatch) {
          const startTime = parseInt(yrcMatch[1]);
          const duration = parseInt(yrcMatch[2]);
          const content = yrcMatch[3];
          
          // 解析逐字信息
          const words: ParsedWord[] = [];
          let currentText = '';
          
          // 匹配所有的 (time,duration,param)text 格式
          const wordMatches = content.matchAll(/\((\d+),(\d+),(\d+)\)([^(]*)/g);
          
          for (const match of wordMatches) {
            const wordTime = parseInt(match[1]);
            const wordDuration = parseInt(match[2]) * 10; // 厘秒转毫秒
            const wordText = match[4];
            
            if (wordText) {
              words.push({
                time: wordTime,
                duration: wordDuration,
                text: wordText
              });
              currentText += wordText;
            }
          }
          
          // 如果没有逐字信息，提取纯文本
          if (words.length === 0) {
            currentText = content.replace(/\([^)]+\)/g, '');
          }
          
          if (currentText.trim()) {
            lines.push({
              time: startTime,
              duration: duration,
              text: currentText.trim(),
              words: words.length > 0 ? words : undefined,
              translation: translationMap.get(startTime)
            });
          }
        } else {
          // 标准LRC格式 [mm:ss.xxx]text
          const lrcMatch = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/);
          if (lrcMatch) {
            const minutes = parseInt(lrcMatch[1]);
            const seconds = parseInt(lrcMatch[2]);
            const milliseconds = parseInt(lrcMatch[3]) * 10;
            const text = lrcMatch[4].trim();
            const time = minutes * 60000 + seconds * 1000 + milliseconds;
            
            if (text) {
              lines.push({
                time,
                duration: 3000, // 默认3秒持续时间
                text,
                translation: translationMap.get(time)
              });
            }
          }
        }
      } catch (error) {
        console.warn('解析歌词行失败:', line, error);
      }
    });
    
    // 按时间排序
    return lines.sort((a, b) => a.time - b.time);
  };

  // 提取元数据
  const extractMetadata = (data: LyricResponse): LyricMetadata => {
    const metadata: LyricMetadata = {
      contributors: {
        lyricUser: data.lyricUser,
        transUser: data.transUser
      }
    };
    
    // 优先从localStorage的播放器状态获取歌曲信息
    if (localPlayerState?.currentTrack && isCurrentSong) {
      metadata.title = localPlayerState.currentTrack.title;
      metadata.artist = localPlayerState.currentTrack.artist;
      metadata.album = localPlayerState.currentTrack.album;
    } else if (playerState.currentTrack) {
      // 兜底：从PlayerContext获取
      metadata.title = playerState.currentTrack.title;
      metadata.artist = playerState.currentTrack.artist;
      metadata.album = playerState.currentTrack.album;
    }
    
    return metadata;
  };

  // 根据当前播放时间更新高亮
  useEffect(() => {
    if (!parsedLyrics.length) return;
    
    // 优先使用localStorage的时间，如果不是当前播放歌曲则不高亮
    let timeToUse = 0;
    if (isCurrentSong && localPlayerState) {
      timeToUse = localPlayerState.currentTime || 0;
    } else if (isCurrentSong && playerState.currentTrack) {
      timeToUse = playerState.currentTime || 0;
    } else {
      // 如果不是当前播放的歌曲，重置高亮状态
      setCurrentLineIndex(-1);
      setCurrentWordIndex(-1);
      return;
    }
    
    const currentTime = timeToUse * 1000; // 转换为毫秒
    
    // 查找当前行
    let lineIndex = -1;
    let wordIndex = -1;
    
    for (let i = 0; i < parsedLyrics.length; i++) {
      const line = parsedLyrics[i];
      const lineEndTime = line.time + line.duration;
      
      if (currentTime >= line.time && currentTime < lineEndTime) {
        lineIndex = i;
        
        // 如果有逐字信息，查找当前字
        if (line.words && lyricMode === 'yrc') {
          for (let j = 0; j < line.words.length; j++) {
            const word = line.words[j];
            const wordEndTime = word.time + word.duration;
            
            if (currentTime >= word.time && currentTime < wordEndTime) {
              wordIndex = j;
              break;
            }
          }
        }
        break;
      }
    }
    
    setCurrentLineIndex(lineIndex);
    setCurrentWordIndex(wordIndex);
  }, [currentTime, parsedLyrics, lyricMode, isCurrentSong, localPlayerState, playerState.currentTime]);

  // 监听播放器状态变化
  useEffect(() => {
    if (localPlayerState) {
      setCurrentTime(localPlayerState.currentTime || 0);
    }
  }, [localPlayerState]);

  // 自动滚动到当前行
  useEffect(() => {
    if (currentLineIndex >= 0 && currentLineRef.current && lyricContainerRef.current && isCurrentSong) {
      const container = lyricContainerRef.current;
      const currentLine = currentLineRef.current;
      
      const containerHeight = container.clientHeight;
      const lineTop = currentLine.offsetTop;
      const lineHeight = currentLine.clientHeight;
      
      // 滚动到当前行居中位置
      const scrollTop = lineTop - containerHeight / 2 + lineHeight / 2;
      
      container.scrollTo({
        top: scrollTop,
        behavior: 'smooth'
      });
    }
  }, [currentLineIndex, isCurrentSong]);

  // 点击歌词行跳转到对应时间
  const handleLineClick = (line: ParsedLyricLine) => {
    if (isCurrentSong) {
      seekTo(line.time / 1000); // 转换为秒
    } else {
      addToast({
        type: 'info',
        message: '请先播放此歌曲以启用歌词同步',
        duration: 3000,
      });
    }
  };

  // 渲染逐字歌词
  const renderWordByWord = (line: ParsedLyricLine, isActive: boolean) => {
    if (!line.words || lyricMode !== 'yrc') {
      return <span>{line.text}</span>;
    }
    
    return (
      <span>
        {line.words.map((word, index) => (
          <span
            key={index}
            className={`transition-all duration-200 ${
              isActive && index === currentWordIndex
                ? 'text-cyber-primary bg-cyber-primary/20 rounded px-1'
                : isActive && index < currentWordIndex
                ? 'text-cyber-primary'
                : 'text-cyber-text'
            }`}
          >
            {word.text}
          </span>
        ))}
      </span>
    );
  };

  // 获取歌词
  useEffect(() => {
    fetchLyricData();
  }, [fetchLyricData]);

  // 重新提取元数据当播放器状态变化时
  useEffect(() => {
    if (lyricData) {
      const meta = extractMetadata(lyricData);
      setMetadata(meta);
    }
  }, [localPlayerState, isCurrentSong, lyricData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cyber-bg flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-cyber-primary mx-auto mb-4" />
          <p className="text-cyber-secondary">正在加载歌词...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-cyber-bg flex items-center justify-center">
        <div className="text-center">
          <Music2 className="h-16 w-16 text-cyber-red mx-auto mb-4" />
          <p className="text-cyber-red mb-4">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cyber-bg">
      {/* 顶部导航栏 */}
      <div className="sticky top-0 z-10 bg-cyber-bg-darker/90 backdrop-blur-sm border-b border-cyber-secondary/30">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 text-cyber-secondary hover:text-cyber-primary transition-colors rounded-lg hover:bg-cyber-bg/50"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              
              <div className="flex items-center space-x-3">
                {/* 显示歌曲封面 - 优先从localStorage获取 */}
                {(isCurrentSong && localPlayerState?.currentTrack?.coverArtPath) || playerState.currentTrack?.coverArtPath ? (
                  <img
                    src={(isCurrentSong && localPlayerState?.currentTrack?.coverArtPath) || playerState.currentTrack?.coverArtPath}
                    alt="封面"
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 bg-cyber-bg rounded-lg flex items-center justify-center">
                    <Music2 className="h-5 w-5 text-cyber-primary" />
                  </div>
                )}
                
                <div>
                  <h1 className="text-lg font-semibold text-cyber-primary truncate">
                    {metadata.title || '未知歌曲'}
                  </h1>
                  <p className="text-sm text-cyber-secondary truncate">
                    {metadata.artist || '未知艺术家'}
                  </p>
                  {/* 同步状态指示器 */}
                  {isCurrentSong && (
                    <div className="flex items-center space-x-1 mt-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="text-xs text-green-500">实时同步</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              {/* 歌词模式切换 */}
              <div className="flex bg-cyber-bg rounded-lg p-1">
                <button
                  onClick={() => setLyricMode('yrc')}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    lyricMode === 'yrc' 
                      ? 'bg-cyber-primary text-cyber-bg-darker' 
                      : 'text-cyber-secondary hover:text-cyber-primary'
                  }`}
                >
                  逐字
                </button>
                <button
                  onClick={() => setLyricMode('lrc')}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    lyricMode === 'lrc' 
                      ? 'bg-cyber-primary text-cyber-bg-darker' 
                      : 'text-cyber-secondary hover:text-cyber-primary'
                  }`}
                >
                  普通
                </button>
                <button
                  onClick={() => setLyricMode('translation')}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    lyricMode === 'translation' 
                      ? 'bg-cyber-primary text-cyber-bg-darker' 
                      : 'text-cyber-secondary hover:text-cyber-primary'
                  }`}
                >
                  译文
                </button>
              </div>
              
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 text-cyber-secondary hover:text-cyber-primary transition-colors rounded-lg hover:bg-cyber-bg/50"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="sticky top-16 z-10 bg-cyber-bg-darker/95 backdrop-blur-sm border-b border-cyber-secondary/30">
          <div className="max-w-4xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-cyber-secondary">字体大小</span>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setFontSize(Math.max(12, fontSize - 2))}
                  className="px-2 py-1 text-xs bg-cyber-bg text-cyber-secondary hover:text-cyber-primary rounded"
                >
                  A-
                </button>
                <span className="text-sm text-cyber-primary min-w-[3rem] text-center">
                  {fontSize}px
                </span>
                <button
                  onClick={() => setFontSize(Math.min(32, fontSize + 2))}
                  className="px-2 py-1 text-xs bg-cyber-bg text-cyber-secondary hover:text-cyber-primary rounded"
                >
                  A+
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 歌词内容 */}
      <div className="max-w-4xl mx-auto px-4 py-8 pb-32">
        {parsedLyrics.length === 0 ? (
          <div className="text-center py-16">
            <Music2 className="h-16 w-16 text-cyber-secondary mx-auto mb-4" />
            <p className="text-cyber-secondary">暂无歌词</p>
          </div>
        ) : (
          <div
            ref={lyricContainerRef}
            className="space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto"
            style={{ fontSize: `${fontSize}px` }}
          >
            {parsedLyrics.map((line, index) => {
              const isActive = index === currentLineIndex && isCurrentSong;
              const showTranslation = lyricMode === 'translation' && line.translation;
              
              return (
                <div
                  key={index}
                  ref={isActive ? currentLineRef : undefined}
                  className={`transition-all duration-300 cursor-pointer px-4 py-3 rounded-lg ${
                    isActive
                      ? 'bg-cyber-primary/10 border-l-4 border-cyber-primary transform scale-105'
                      : 'hover:bg-cyber-bg-darker/50'
                  }`}
                  onClick={() => handleLineClick(line)}
                >
                  <div
                    className={`leading-relaxed transition-all duration-200 ${
                      isActive
                        ? 'text-cyber-primary font-medium'
                        : 'text-cyber-text hover:text-cyber-primary'
                    }`}
                  >
                    {lyricMode === 'translation' && line.translation ? (
                      line.translation
                    ) : (
                      renderWordByWord(line, isActive)
                    )}
                  </div>
                  
                  {/* 显示翻译（非翻译模式下） */}
                  {lyricMode !== 'translation' && line.translation && (
                    <div className="text-sm text-cyber-secondary/70 mt-2 italic">
                      {line.translation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        
        {/* 贡献者信息 */}
        {metadata.contributors && (
          <div className="mt-12 pt-8 border-t border-cyber-secondary/30">
            <h3 className="text-lg font-semibold text-cyber-primary mb-4">贡献者</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {metadata.contributors.lyricUser && (
                <div className="flex items-center space-x-3 p-3 bg-cyber-bg-darker rounded-lg">
                  <User className="h-5 w-5 text-cyber-secondary" />
                  <div>
                    <p className="text-cyber-primary font-medium">
                      {metadata.contributors.lyricUser.nickname}
                    </p>
                    <p className="text-xs text-cyber-secondary">歌词贡献者</p>
                  </div>
                </div>
              )}
              
              {metadata.contributors.transUser && (
                <div className="flex items-center space-x-3 p-3 bg-cyber-bg-darker rounded-lg">
                  <Globe className="h-5 w-5 text-cyber-secondary" />
                  <div>
                    <p className="text-cyber-primary font-medium">
                      {metadata.contributors.transUser.nickname}
                    </p>
                    <p className="text-xs text-cyber-secondary">翻译贡献者</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LyricView;
