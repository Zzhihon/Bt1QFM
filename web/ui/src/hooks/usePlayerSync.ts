import { useEffect, useCallback, useRef } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

interface UsePlayerSyncOptions {
  onTimeUpdate?: (currentTime: number) => void;
  onTrackChange?: (trackId: string | null) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onSeek?: (currentTime: number) => void;
  updateInterval?: number; // 更新间隔，默认100ms
}

export const usePlayerSync = (options: UsePlayerSyncOptions = {}) => {
  const { playerState } = usePlayer();
  const {
    onTimeUpdate,
    onTrackChange,
    onPlayStateChange,
    onSeek,
    updateInterval = 100
  } = options;

  const lastTimeRef = useRef<number>(0);
  const lastTrackIdRef = useRef<string | null>(null);
  const lastPlayStateRef = useRef<boolean>(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 检测播放时间变化
  const checkTimeUpdate = useCallback(() => {
    if (!playerState.currentTrack || !onTimeUpdate) return;

    const currentTime = playerState.currentTime;
    const timeDiff = Math.abs(currentTime - lastTimeRef.current);

    // 检测是否是跳转（时间差大于2秒认为是跳转）
    if (timeDiff > 2 && onSeek) {
      onSeek(currentTime);
    }

    // 只有时间实际发生变化时才触发更新
    if (currentTime !== lastTimeRef.current) {
      onTimeUpdate(currentTime);
      lastTimeRef.current = currentTime;
    }
  }, [playerState.currentTime, playerState.currentTrack, onTimeUpdate, onSeek]);

  // 检测歌曲变化
  useEffect(() => {
    const currentTrackId = playerState.currentTrack?.id || null;
    
    if (currentTrackId !== lastTrackIdRef.current) {
      if (onTrackChange) {
        onTrackChange(currentTrackId);
      }
      lastTrackIdRef.current = currentTrackId;
      // 重置时间记录
      lastTimeRef.current = 0;
    }
  }, [playerState.currentTrack?.id, onTrackChange]);

  // 检测播放状态变化
  useEffect(() => {
    if (playerState.isPlaying !== lastPlayStateRef.current) {
      if (onPlayStateChange) {
        onPlayStateChange(playerState.isPlaying);
      }
      lastPlayStateRef.current = playerState.isPlaying;
    }
  }, [playerState.isPlaying, onPlayStateChange]);

  // 设置定时器来监听播放时间
  useEffect(() => {
    if (playerState.isPlaying && onTimeUpdate) {
      intervalRef.current = setInterval(checkTimeUpdate, updateInterval);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [playerState.isPlaying, checkTimeUpdate, updateInterval, onTimeUpdate]);

  // 立即检查一次时间更新（用于暂停状态下的手动跳转）
  useEffect(() => {
    checkTimeUpdate();
  }, [playerState.currentTime]);

  return {
    currentTime: playerState.currentTime,
    currentTrack: playerState.currentTrack,
    isPlaying: playerState.isPlaying,
    duration: playerState.duration
  };
};
