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
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react';
import { usePlayer } from '../../contexts/PlayerContext';
import { useToast } from '../../contexts/ToastContext';
import { LyricResponse, ParsedLyricLine, ParsedWord, LyricMetadata } from '../../types';
import VinylRecord from '../ui/VinylRecord';

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
  const [lyricMode, setLyricMode] = useState<'yrc' | 'lrc' | 'translation'>('lrc');
  const [fontSize, setFontSize] = useState(18);
  const [showSettings, setShowSettings] = useState(false);
  
  // 新增：自动滚动控制
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(50); // 改为50%，即屏幕正中间
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout>();
  const scrollCheckTimeoutRef = useRef<NodeJS.Timeout>();
  const lastAutoScrollTime = useRef<number>(0);
  
  // 播放器状态同步相关
  const [localPlayerState, setLocalPlayerState] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isCurrentSong, setIsCurrentSong] = useState(false);
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  
  // 新增：追踪已加载的歌词ID，避免重复加载
  const [loadedSongId, setLoadedSongId] = useState<string | null>(null);
  const [isLyricLoaded, setIsLyricLoaded] = useState(false);
  
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
        if (currentTrack && currentTrack.neteaseId) {
          const playingSongId = currentTrack.neteaseId.toString();
          const isPlaying = playingSongId === id;
          
          setIsCurrentSong(isPlaying);
          setCurrentSongId(playingSongId);
          
          if (isPlaying) {
            setCurrentTime(parsedState.currentTime || 0);
          }
        } else {
          setCurrentSongId(null);
          setIsCurrentSong(false);
        }
      }
    } catch (error) {
      console.error('读取播放器状态失败:', error);
    }
  }, [id]);

  // 获取歌词数据 - 支持动态歌曲ID，但避免重复加载
  const fetchLyricData = useCallback(async (songId?: string, forceReload = false) => {
    const targetSongId = songId || id;
    if (!targetSongId) return;
    
    // 如果歌词已经加载过且不是强制重新加载，则跳过
    if (!forceReload && loadedSongId === targetSongId && isLyricLoaded) {
      console.log('🎵 歌词已加载，跳过重复请求:', targetSongId);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('🎵 正在获取歌词数据，歌曲ID:', targetSongId);
      const response = await fetch(`${getBackendUrl()}/api/netease/lyric/new?id=${targetSongId}`);
      
      if (!response.ok) {
        throw new Error(`获取歌词失败: ${response.status}`);
      }
      
      const data: LyricResponse = await response.json();
      console.log('🎵 歌词API响应成功:', targetSongId);
      
      if (data.code !== 200) {
        throw new Error('歌词服务返回错误');
      }
      
      setLyricData(data);
      
      // 解析歌词
      const parsed = parseLyrics(data);
      setParsedLyrics(parsed);
      
      // 提取元数据
      const meta = extractMetadata(data);
      setMetadata(meta);
      
      // 标记歌词已加载
      setLoadedSongId(targetSongId);
      setIsLyricLoaded(true);
      
      console.log('✅ 歌词加载完成:', targetSongId);
      
    } catch (error) {
      console.error('❌ 获取歌词失败:', error);
      setError(error instanceof Error ? error.message : '获取歌词失败');
      setIsLyricLoaded(false);
      addToast({
        type: 'error',
        message: '获取歌词失败',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, [id, addToast, loadedSongId, isLyricLoaded]);

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

  // 检测当前播放歌曲变化并自动切换歌词
  const handleCurrentSongChange = useCallback(async (newSongId: string) => {
    console.log('🔄 检测到播放歌曲变化:', {
      from: id,
      to: newSongId,
      shouldAutoSwitch: newSongId !== id,
      isAlreadyLoaded: loadedSongId === newSongId
    });

    // 如果当前歌词页面显示的歌曲与正在播放的歌曲不同
    if (newSongId !== id) {
      // 显示切换提示
      addToast({
        type: 'info',
        message: `正在切换到新歌曲的歌词...`,
        duration: 2000,
      });

      // 重置歌词加载状态，因为要切换到新歌曲
      setIsLyricLoaded(false);
      setLoadedSongId(null);

      // 更新URL
      navigate(`/lyric/${newSongId}`, { replace: true });
    }
  }, [id, navigate, addToast, loadedSongId]);

  // 提取元数据 - 增强版本，支持实时更新
  const extractMetadata = useCallback((data: LyricResponse): LyricMetadata => {
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
      console.log('🎵 从localStorage获取歌曲元数据:', {
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album
      });
    } else if (playerState.currentTrack) {
      // 兜底：从PlayerContext获取
      metadata.title = playerState.currentTrack.title;
      metadata.artist = playerState.currentTrack.artist;
      metadata.album = playerState.currentTrack.album;
      console.log('🎵 从PlayerContext获取歌曲元数据:', {
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album
      });
    } else {
      // 最后兜底：使用URL参数中的歌曲ID
      metadata.title = `歌曲 ${id}`;
      metadata.artist = '未知艺术家';
      metadata.album = '未知专辑';
      console.log('🎵 使用默认歌曲元数据');
    }
    
    return metadata;
  }, [localPlayerState, isCurrentSong, playerState.currentTrack, id]);

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
    
    // 查找当前行 - 优化算法减少延迟
    let lineIndex = -1;
    let wordIndex = -1;
    
    // 提前量：提前500毫秒高亮下一行
    const HIGHLIGHT_ADVANCE = 300;
    const adjustedTime = currentTime + HIGHLIGHT_ADVANCE;
    
    for (let i = 0; i < parsedLyrics.length; i++) {
      const line = parsedLyrics[i];
      const nextLine = parsedLyrics[i + 1];
      
      // 计算当前行的结束时间
      let lineEndTime;
      if (nextLine) {
        // 如果有下一行，当前行持续到下一行开始前
        lineEndTime = nextLine.time;
      } else {
        // 如果是最后一行，使用默认持续时间
        lineEndTime = line.time + line.duration;
      }
      
      // 检查当前时间是否在这一行的范围内
      if (adjustedTime >= line.time && adjustedTime < lineEndTime) {
        lineIndex = i;
        
        // 如果有逐字信息且处于逐字模式，查找当前字
        if (line.words && line.words.length > 0 && lyricMode === 'yrc') {
          let foundCurrentWord = false;
          
          for (let j = 0; j < line.words.length; j++) {
            const word = line.words[j];
            const wordEndTime = word.time + word.duration;
            
            if (currentTime >= word.time && currentTime < wordEndTime) {
              wordIndex = j;
              foundCurrentWord = true;
              break;
            }
          }
          
          // 如果没有找到当前字，但时间在这一行内，检查是否应该高亮前面的字
          if (!foundCurrentWord) {
            for (let j = line.words.length - 1; j >= 0; j--) {
              if (currentTime >= line.words[j].time) {
                wordIndex = j;
                break;
              }
            }
          }
        }
        break;
      }
    }
    
    // 如果没有找到匹配的行，尝试找最接近的行（向前查找）
    if (lineIndex === -1) {
      for (let i = parsedLyrics.length - 1; i >= 0; i--) {
        const line = parsedLyrics[i];
        if (adjustedTime >= line.time) {
          lineIndex = i;
          break;
        }
      }
    }
    
    setCurrentLineIndex(lineIndex);
    setCurrentWordIndex(wordIndex);
  }, [currentTime, parsedLyrics, lyricMode, isCurrentSong, localPlayerState, playerState.currentTime]);

  // 监听播放器状态变化 - 增加更频繁的时间更新
  useEffect(() => {
    if (localPlayerState) {
      setCurrentTime(localPlayerState.currentTime || 0);
    }
  }, [localPlayerState]);

  // 增加一个更频繁的时间更新机制
  useEffect(() => {
    if (!isCurrentSong) return;
    
    const updateInterval = setInterval(() => {
      // 从localStorage重新读取最新的播放时间
      try {
        const savedState = localStorage.getItem('playerState');
        if (savedState) {
          const parsedState = JSON.parse(savedState);
          if (parsedState.currentTime !== undefined) {
            setCurrentTime(parsedState.currentTime);
          }
        }
      } catch (error) {
        console.warn('更新播放时间失败:', error);
      }
    }, 100); // 每100毫秒更新一次时间，提高响应速度
    
    return () => clearInterval(updateInterval);
  }, [isCurrentSong]);

  // 检测用户手动滚动 - 改进版本
  const handleUserScroll = useCallback(() => {
    if (!autoScroll) return;
    
    const now = Date.now();
    
    // 如果刚刚进行了自动滚动（500ms内），则忽略这次滚动事件
    if (now - lastAutoScrollTime.current < 500) {
      return;
    }
    
    setIsUserScrolling(true);
    
    // 清除之前的定时器
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    
    if (scrollCheckTimeoutRef.current) {
      clearTimeout(scrollCheckTimeoutRef.current);
    }
    
    // 2秒后恢复自动滚动（延长时间）
    userScrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 2000);
  }, [autoScroll]);

  // 改进的自动滚动到当前行 - 确保始终居中
  useEffect(() => {
    if (
      currentLineIndex >= 0 && 
      currentLineRef.current && 
      lyricContainerRef.current && 
      isCurrentSong && 
      autoScroll && 
      !isUserScrolling
    ) {
      const container = lyricContainerRef.current;
      const currentLine = currentLineRef.current;
      
      const containerHeight = container.clientHeight;
      const lineTop = currentLine.offsetTop;
      const lineHeight = currentLine.clientHeight;
      
      // 计算目标滚动位置：让高亮行始终位于容器正中间
      const targetScrollTop = lineTop - containerHeight / 2 + lineHeight / 2;
      
      // 记录自动滚动时间
      lastAutoScrollTime.current = Date.now();
      
      // 使用更平滑的滚动行为
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
      
      // 滚动完成后短暂延迟，避免触发用户滚动检测
      scrollCheckTimeoutRef.current = setTimeout(() => {
        lastAutoScrollTime.current = Date.now();
      }, 800);
    }
  }, [currentLineIndex, isCurrentSong, autoScroll, isUserScrolling]);

  // 添加滚动事件监听 - 改进版本
  useEffect(() => {
    const container = lyricContainerRef.current;
    if (!container) return;
    
    // 使用防抖处理滚动事件
    let scrollTimeout: NodeJS.Timeout;
    
    const debouncedScrollHandler = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        handleUserScroll();
      }, 100);
    };
    
    container.addEventListener('scroll', debouncedScrollHandler, { passive: true });
    
    return () => {
      container.removeEventListener('scroll', debouncedScrollHandler);
      clearTimeout(scrollTimeout);
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
      if (scrollCheckTimeoutRef.current) {
        clearTimeout(scrollCheckTimeoutRef.current);
      }
    };
  }, [handleUserScroll]);

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
    // 优先显示逐行歌词，简化渲染逻辑
    return <span className={isActive ? 'text-cyber-primary' : 'text-cyber-text'}>{line.text}</span>;
  };

  // 获取歌词
  useEffect(() => {
    fetchLyricData();
  }, [fetchLyricData]);

  // 初始获取歌词 - 只在组件首次加载或URL中的ID变化时执行
  useEffect(() => {
    if (id && (!isLyricLoaded || loadedSongId !== id)) {
      console.log('🎵 初始化或ID变化，加载歌词:', id);
      fetchLyricData(id, true); // 强制重新加载
    }
  }, [id]); // 只依赖 id，移除 fetchLyricData 避免循环

  // 重新提取元数据当播放器状态变化时 - 但不重新加载歌词
  useEffect(() => {
    if (lyricData && isLyricLoaded) {
      const meta = extractMetadata(lyricData);
      setMetadata(meta);
    }
  }, [localPlayerState, isCurrentSong, lyricData, extractMetadata, isLyricLoaded]);

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
    
    // 定期检查播放器状态（兜底机制）- 降低频率
    const interval = setInterval(loadPlayerStateFromStorage, 2000); // 从1秒改为2秒
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [loadPlayerStateFromStorage]);

  // 监听当前播放歌曲变化 - 只有歌曲ID真正变化时才触发
  useEffect(() => {
    if (currentSongId && currentSongId !== id && isLyricLoaded) {
      // 只有在歌词已经加载完成的情况下才处理歌曲切换
      handleCurrentSongChange(currentSongId);
    }
  }, [currentSongId, id, handleCurrentSongChange, isLyricLoaded]);

  // 当URL参数中的歌曲ID变化时重置状态
  useEffect(() => {
    if (id !== loadedSongId) {
      console.log('🔄 URL中的歌曲ID变化，重置加载状态:', { old: loadedSongId, new: id });
      setIsLyricLoaded(false);
      setLoadedSongId(null);
      setError(null);
    }
  }, [id, loadedSongId]);

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
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 sm:space-x-4 flex-1 min-w-0">
              <button
                onClick={() => navigate(-1)}
                className="p-1.5 sm:p-2 text-cyber-secondary hover:text-cyber-primary transition-colors rounded-lg hover:bg-cyber-bg/50 flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>

              <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
                {/* 恢复原有的封面显示 - 移动端隐藏 */}
                {((isCurrentSong && localPlayerState?.currentTrack?.coverArtPath) || playerState.currentTrack?.coverArtPath) && (
                  <img
                    src={(isCurrentSong && localPlayerState?.currentTrack?.coverArtPath) || playerState.currentTrack?.coverArtPath}
                    alt="封面"
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg object-cover hidden sm:block flex-shrink-0"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <h1 className="text-sm sm:text-lg font-semibold text-cyber-primary truncate">
                    {metadata.title || '未知歌曲'}
                  </h1>
                  <p className="text-xs sm:text-sm text-cyber-secondary truncate">
                    {metadata.artist || '未知艺术家'}
                  </p>
                  {/* 同步状态指示器 - 移动端简化 */}
                  <div className="items-center space-x-2 mt-1 hidden sm:flex">
                    {isCurrentSong ? (
                      <>
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-green-500">实时同步</span>
                        {autoScroll && !isUserScrolling && (
                          <span className="text-xs text-blue-500">• 自动跟随</span>
                        )}
                        {isUserScrolling && (
                          <span className="text-xs text-yellow-500">• 手动浏览</span>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                        <span className="text-xs text-gray-500">静态显示</span>
                      </>
                    )}
                    {currentSongId && currentSongId !== id && (
                      <span className="text-xs text-yellow-500 ml-2">
                        (正在播放其他歌曲)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
              {/* 自动跟随开关 */}
              {isCurrentSong && (
                <button
                  onClick={() => {
                    setAutoScroll(!autoScroll);
                    if (!autoScroll) {
                      setIsUserScrolling(false);
                      addToast({
                        type: 'success',
                        message: '已开启自动跟随',
                        duration: 1000,
                      });
                    } else {
                      addToast({
                        type: 'info',
                        message: '已关闭自动跟随',
                        duration: 1000,
                      });
                    }
                  }}
                  className={`p-1.5 sm:p-2 rounded-lg transition-colors ${
                    autoScroll
                      ? 'text-cyber-primary bg-cyber-primary/10 hover:bg-cyber-primary/20'
                      : 'text-cyber-secondary hover:text-cyber-primary hover:bg-cyber-bg/50'
                  }`}
                  title={autoScroll ? '关闭自动跟随' : '开启自动跟随'}
                >
                  {autoScroll ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              )}

              {/* 歌词模式切换 */}
              <div className="flex bg-cyber-bg rounded-lg p-0.5 sm:p-1">
                <button
                  onClick={() => setLyricMode('lrc')}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${
                    lyricMode === 'lrc'
                      ? 'bg-cyber-primary text-cyber-bg-darker'
                      : 'text-cyber-secondary hover:text-cyber-primary'
                  }`}
                >
                  歌词
                </button>
                <button
                  onClick={() => setLyricMode('translation')}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${
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
                className="p-1.5 sm:p-2 text-cyber-secondary hover:text-cyber-primary transition-colors rounded-lg hover:bg-cyber-bg/50"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="sticky top-12 sm:top-16 z-10 bg-cyber-bg-darker/95 backdrop-blur-sm border-b border-cyber-secondary/30">
          <div className="max-w-4xl mx-auto px-3 sm:px-4 py-3 space-y-4">
            {/* 字体大小设置 */}
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
            
            {/* 自动跟随设置 */}
            {isCurrentSong && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-cyber-secondary">自动跟随</span>
                  <button
                    onClick={() => {
                      setAutoScroll(!autoScroll);
                      if (!autoScroll) {
                        setIsUserScrolling(false);
                      }
                    }}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      autoScroll
                        ? 'bg-cyber-primary text-cyber-bg-darker'
                        : 'bg-cyber-bg text-cyber-secondary hover:text-cyber-primary'
                    }`}
                  >
                    {autoScroll ? '已开启' : '已关闭'}
                  </button>
                </div>
                
                {isUserScrolling && (
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
                        <span className="text-sm text-yellow-500">
                          手动浏览中，2秒后恢复自动跟随
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setIsUserScrolling(false);
                          if (userScrollTimeoutRef.current) {
                            clearTimeout(userScrollTimeoutRef.current);
                          }
                        }}
                        className="text-xs text-yellow-500 hover:text-yellow-400 underline"
                      >
                        立即恢复
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            
            {/* 调试信息（开发环境） */}
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <div className="text-xs text-blue-500 space-y-1">
                  <div>当前页面歌曲ID: {id}</div>
                  <div>正在播放歌曲ID: {currentSongId || 'None'}</div>
                  <div>已加载歌词ID: {loadedSongId || 'None'}</div>
                  <div>歌词加载状态: {isLyricLoaded ? '已加载' : '未加载'}</div>
                  <div>是否当前歌曲: {isCurrentSong ? '是' : '否'}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 歌词内容区域 - 响应式布局 */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-8 pb-32">
        {/* 移动端：唱片在上方 */}
        <div className="lg:hidden mb-6">
          <div className="flex flex-col items-center">
            <VinylRecord
              coverUrl={(isCurrentSong && localPlayerState?.currentTrack?.coverArtPath) || playerState.currentTrack?.coverArtPath}
              title={metadata.title || '未知歌曲'}
              artist={metadata.artist || '未知艺术家'}
              isPlaying={isCurrentSong && (localPlayerState?.isPlaying || playerState.isPlaying)}
              size="md"
              className="shadow-xl"
              onClick={() => {
                if (isCurrentSong) {
                  addToast({
                    type: 'info',
                    message: '♪ 享受音乐与歌词的完美结合',
                    duration: 2000,
                  });
                } else {
                  addToast({
                    type: 'info',
                    message: '请先播放此歌曲以启用歌词同步',
                    duration: 3000,
                  });
                }
              }}
            />

            {/* 移动端歌曲信息和同步状态 */}
            <div className="mt-4 text-center">
              <h2 className="text-lg font-bold text-cyber-primary truncate max-w-[80vw]">
                {metadata.title || '未知歌曲'}
              </h2>
              <p className="text-sm text-cyber-secondary truncate max-w-[80vw]">
                {metadata.artist || '未知艺术家'}
              </p>

              {/* 播放状态 */}
              <div className="flex items-center justify-center mt-2 space-x-2">
                {isCurrentSong ? (
                  <>
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-xs text-green-500">
                      {(localPlayerState?.isPlaying || playerState.isPlaying) ? '正在播放' : '已暂停'}
                    </span>
                    {autoScroll && (
                      <span className="text-xs text-blue-500">• 自动跟随</span>
                    )}
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                    <span className="text-xs text-gray-500">静态歌词</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 lg:gap-8">
          {/* 桌面端左侧：黑胶唱片 */}
          <div className="hidden lg:block flex-shrink-0 w-80">
            <div className="sticky top-32">
              <VinylRecord
                coverUrl={(isCurrentSong && localPlayerState?.currentTrack?.coverArtPath) || playerState.currentTrack?.coverArtPath}
                title={metadata.title || '未知歌曲'}
                artist={metadata.artist || '未知艺术家'}
                isPlaying={isCurrentSong && (localPlayerState?.isPlaying || playerState.isPlaying)}
                size="lg"
                className="shadow-2xl"
                onClick={() => {
                  if (isCurrentSong) {
                    addToast({
                      type: 'info',
                      message: '♪ 享受音乐与歌词的完美结合',
                      duration: 2000,
                    });
                  } else {
                    addToast({
                      type: 'info',
                      message: '请先播放此歌曲以启用歌词同步',
                      duration: 3000,
                    });
                  }
                }}
              />
              
              {/* 歌曲信息卡片 */}
              <div className="mt-6 p-4 bg-cyber-bg-darker/50 rounded-xl backdrop-blur-sm border border-cyber-secondary/20">
                <h2 className="text-xl font-bold text-cyber-primary mb-2 truncate">
                  {metadata.title || '未知歌曲'}
                </h2>
                <p className="text-cyber-secondary mb-1 truncate">
                  {metadata.artist || '未知艺术家'}
                </p>
                {metadata.album && (
                  <p className="text-sm text-cyber-secondary/70 truncate">
                    专辑：{metadata.album}
                  </p>
                )}
                
                {/* 播放状态和跟随状态 */}
                <div className="flex items-center mt-4 pt-3 border-t border-cyber-secondary/20">
                  {isCurrentSong ? (
                    <div className="space-y-2 w-full">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-sm text-green-500 font-medium">
                          {(localPlayerState?.isPlaying || playerState.isPlaying) ? '正在播放' : '已暂停'}
                        </span>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        {autoScroll ? (
                          <>
                            <Eye className="w-3 h-3 text-blue-500" />
                            <span className="text-xs text-blue-500">
                              自动居中跟随
                            </span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3 h-3 text-gray-500" />
                            <span className="text-xs text-gray-500">手动浏览模式</span>
                          </>
                        )}
                      </div>
                      
                      {isUserScrolling && (
                        <div className="text-xs text-yellow-500 flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>2秒后恢复跟随</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-gray-500 rounded-full"></div>
                      <span className="text-sm text-gray-500">静态歌词</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 右侧（桌面端）/ 全宽（移动端）：歌词内容 */}
          <div className="flex-1 min-w-0">
            {parsedLyrics.length === 0 ? (
              <div className="text-center py-8 sm:py-16">
                <Music2 className="h-12 w-12 sm:h-16 sm:w-16 text-cyber-secondary mx-auto mb-4" />
                <p className="text-cyber-secondary">暂无歌词</p>
              </div>
            ) : (
              <div className="relative">
                <div
                  ref={lyricContainerRef}
                  className="h-[50vh] lg:h-[80vh] overflow-y-auto scrollbar-thin scrollbar-track-cyber-bg scrollbar-thumb-cyber-secondary/50"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {/* 顶部间距，确保第一行歌词可以滚动到中心 */}

                  <div className="space-y-4 sm:space-y-6">
                    {parsedLyrics.map((line, index) => {
                      const isActive = index === currentLineIndex && isCurrentSong;

                      return (
                        <div
                          key={index}
                          ref={isActive ? currentLineRef : undefined}
                          className={`transition-all duration-500 cursor-pointer px-3 sm:px-6 py-2 sm:py-4 rounded-xl text-center ${
                            isActive
                              ? 'bg-gradient-to-r from-cyber-primary/5 via-cyber-primary/10 to-cyber-primary/5 border-2 border-cyber-primary/30 transform scale-105 sm:scale-110 shadow-2xl shadow-cyber-primary/20'
                              : 'hover:bg-cyber-bg-darker/30 hover:scale-102 sm:hover:scale-105'
                          }`}
                          onClick={() => handleLineClick(line)}
                        >
                          <div
                            className={`leading-relaxed transition-all duration-300 ${
                              isActive
                                ? 'text-cyber-primary font-bold text-shadow-lg'
                                : 'text-cyber-text/80 hover:text-cyber-primary'
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
                            <div className={`text-xs sm:text-sm mt-1 sm:mt-2 italic transition-all duration-300 ${
                              isActive
                                ? 'text-cyber-primary/70 font-medium'
                                : 'text-cyber-secondary/60'
                            }`}>
                              {line.translation}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 底部间距，确保最后一行歌词可以滚动到中心 */}
                  <div className="h-[25vh] lg:h-[40vh]"></div>
                </div>
              </div>
            )}

            {/* 贡献者信息 - 移动端简化 */}
            {metadata.contributors && (
              <div className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-cyber-secondary/30">
                <h3 className="text-base sm:text-lg font-semibold text-cyber-primary mb-3 sm:mb-4">贡献者</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {metadata.contributors.lyricUser && (
                    <div className="flex items-center space-x-3 p-2 sm:p-3 bg-cyber-bg-darker rounded-lg">
                      <User className="h-4 w-4 sm:h-5 sm:w-5 text-cyber-secondary flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-cyber-primary font-medium text-sm truncate">
                          {metadata.contributors.lyricUser.nickname}
                        </p>
                        <p className="text-xs text-cyber-secondary">歌词贡献者</p>
                      </div>
                    </div>
                  )}

                  {metadata.contributors.transUser && (
                    <div className="flex items-center space-x-3 p-2 sm:p-3 bg-cyber-bg-darker rounded-lg">
                      <Globe className="h-4 w-4 sm:h-5 sm:w-5 text-cyber-secondary flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-cyber-primary font-medium text-sm truncate">
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
      </div>
    </div>
  );
};

export default LyricView;
