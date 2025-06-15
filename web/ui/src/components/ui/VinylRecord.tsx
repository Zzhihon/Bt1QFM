import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Music2, Play, Pause } from 'lucide-react';

interface VinylRecordProps {
  coverUrl?: string;
  title?: string;
  artist?: string;
  isPlaying?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
}

const VinylRecord: React.FC<VinylRecordProps> = ({
  coverUrl,
  title = '未知歌曲',
  artist = '未知艺术家',
  isPlaying = false,
  size = 'md',
  className = '',
  onClick
}) => {
  const vinylRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLImageElement>(null);
  const rotationRef = useRef<gsap.core.Tween | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // 尺寸配置 - 优化lg尺寸
  const sizeConfig = {
    sm: { vinyl: 'w-32 h-32', cover: 'w-12 h-12', label: 'w-20 h-20' },
    md: { vinyl: 'w-48 h-48', cover: 'w-20 h-20', label: 'w-32 h-32' },
    lg: { vinyl: 'w-72 h-72', cover: 'w-32 h-32', label: 'w-48 h-48' }
  };

  const currentSize = sizeConfig[size];

  // 初始化旋转动画
  useEffect(() => {
    if (!vinylRef.current) return;

    // 创建无限旋转动画，但初始时暂停
    rotationRef.current = gsap.to(vinylRef.current, {
      rotation: 360,
      duration: 3,
      ease: 'none',
      repeat: -1,
      paused: true
    });

    return () => {
      if (rotationRef.current) {
        rotationRef.current.kill();
      }
    };
  }, []);

  // 控制播放/暂停动画
  useEffect(() => {
    if (!rotationRef.current) return;

    if (isPlaying) {
      rotationRef.current.play();
    } else {
      rotationRef.current.pause();
    }
  }, [isPlaying]);

  // 处理图片加载
  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(false);
  };

  return (
    <div 
      className={`relative group cursor-pointer ${className}`}
      onClick={onClick}
    >
      {/* 黑胶唱片外圈 */}
      <div
        ref={vinylRef}
        className={`${currentSize.vinyl} relative rounded-full bg-gradient-to-br from-gray-900 via-black to-gray-800 shadow-2xl transform transition-transform duration-300 group-hover:scale-105`}
        style={{
          background: `
            radial-gradient(circle at 50% 50%, 
              rgba(30, 30, 30, 1) 0%,
              rgba(20, 20, 20, 1) 20%,
              rgba(10, 10, 10, 1) 40%,
              rgba(5, 5, 5, 1) 60%,
              rgba(0, 0, 0, 1) 100%
            )
          `,
          boxShadow: `
            inset 0 0 20px rgba(255, 255, 255, 0.1),
            0 8px 32px rgba(0, 0, 0, 0.8),
            0 0 0 2px rgba(64, 64, 64, 0.5)
          `
        }}
      >
        {/* 黑胶纹理 */}
        <div className="absolute inset-0 rounded-full opacity-30">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full border border-gray-600/20"
              style={{
                top: `${10 + i * 10}%`,
                left: `${10 + i * 10}%`,
                right: `${10 + i * 10}%`,
                bottom: `${10 + i * 10}%`,
              }}
            />
          ))}
        </div>

        {/* 中心标签区域 */}
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${currentSize.label} rounded-full bg-gradient-to-br from-red-900 via-red-800 to-red-700 shadow-lg border-4 border-yellow-400/80`}>
          {/* 标签纹理 */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-transparent via-red-600/30 to-transparent"></div>
          
          {/* 中心孔 */}
          <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${size === 'lg' ? 'w-4 h-4' : 'w-3 h-3'} bg-black rounded-full shadow-inner`}></div>
          
          {/* 歌曲信息 - 只在小尺寸时显示 */}
          {size !== 'lg' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
              <div className="text-yellow-100 font-bold text-xs mb-1 truncate w-full">
                {title}
              </div>
              <div className="text-yellow-200/80 text-xs truncate w-full">
                {artist}
              </div>
            </div>
          )}
        </div>

        {/* 封面图片 */}
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${currentSize.cover} rounded-full overflow-hidden shadow-lg border-2 border-white/20`}>
          {coverUrl && !imageError ? (
            <img
              ref={coverRef}
              src={coverUrl}
              alt={`${title} - ${artist}`}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          ) : null}
          
          {/* 封面加载失败或无封面时的占位符 */}
          {(!coverUrl || imageError || !imageLoaded) && (
            <div className="w-full h-full bg-gradient-to-br from-cyber-primary/30 to-cyber-primary/10 flex items-center justify-center">
              <Music2 className="h-1/2 w-1/2 text-cyber-primary/60" />
            </div>
          )}
        </div>

        {/* 播放状态指示器 */}
        <div className={`absolute ${size === 'lg' ? 'top-4 right-4 p-2' : 'top-2 right-2 p-1'} rounded-full ${isPlaying ? 'bg-green-500' : 'bg-gray-500'} transition-colors duration-300`}>
          {isPlaying ? (
            <Pause className={`${size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'} text-white`} />
          ) : (
            <Play className={`${size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'} text-white`} />
          )}
        </div>

        {/* 光泽效果 */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/10 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300"></div>
      </div>

      {/* 悬浮时的光环效果 */}
      <div className="absolute inset-0 rounded-full bg-cyber-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10"></div>
    </div>
  );
};

export default VinylRecord;
