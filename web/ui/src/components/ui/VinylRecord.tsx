import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Music2 } from 'lucide-react';

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

  // 尺寸配置 - 优化封面和标签比例，让封面更大
  const sizeConfig = {
    sm: { vinyl: 'w-32 h-32', cover: 'w-16 h-16', label: 'w-24 h-24' },
    md: { vinyl: 'w-48 h-48', cover: 'w-28 h-28', label: 'w-36 h-36' },
    lg: { vinyl: 'w-72 h-72', cover: 'w-44 h-44', label: 'w-56 h-56' }
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
      style={{
        filter: 'drop-shadow(0 25px 50px rgba(0, 0, 0, 0.4))',
      }}
    >
      {/* 黑胶唱片外圈 */}
      <div
        ref={vinylRef}
        className={`${currentSize.vinyl} relative rounded-full transform transition-all duration-500 group-hover:scale-105 group-hover:rotate-12`}
        style={{
          background: `
            radial-gradient(circle at 50% 50%, 
              rgba(25, 25, 25, 1) 0%,
              rgba(15, 15, 15, 1) 25%,
              rgba(8, 8, 8, 1) 50%,
              rgba(3, 3, 3, 1) 75%,
              rgba(0, 0, 0, 1) 100%
            )
          `,
          boxShadow: `
            inset 0 0 30px rgba(255, 255, 255, 0.08),
            inset 0 0 80px rgba(0, 0, 0, 0.9),
            0 15px 40px rgba(0, 0, 0, 0.6),
            0 5px 15px rgba(0, 0, 0, 0.4),
            0 0 0 1px rgba(80, 80, 80, 0.3)
          `
        }}
      >
        {/* 增强黑胶纹理 */}
        <div className="absolute inset-0 rounded-full opacity-40">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full border border-gray-600/15"
              style={{
                top: `${5 + i * 7.5}%`,
                left: `${5 + i * 7.5}%`,
                right: `${5 + i * 7.5}%`,
                bottom: `${5 + i * 7.5}%`,
              }}
            />
          ))}
        </div>

        {/* 中心标签区域 - 缩小以让封面更大 */}
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${currentSize.label} rounded-full bg-gradient-to-br from-red-900 via-red-800 to-red-700 shadow-2xl border-2 border-yellow-400/60`}>
          {/* 标签纹理 */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-transparent via-red-600/20 to-transparent"></div>
          
          {/* 增强的反光效果 */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-yellow-300/10 via-transparent to-transparent"></div>
          
          {/* 中心孔 */}
          <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${size === 'lg' ? 'w-5 h-5' : size === 'md' ? 'w-4 h-4' : 'w-3 h-3'} bg-black rounded-full shadow-inner border border-gray-800`}></div>
          
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

        {/* 封面图片 - 增大尺寸 */}
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${currentSize.cover} rounded-full overflow-hidden`}
             style={{
               boxShadow: `
                 0 0 20px rgba(0, 0, 0, 0.8),
                 inset 0 0 20px rgba(0, 0, 0, 0.3),
                 0 0 0 2px rgba(255, 255, 255, 0.05)
               `}}>
          {coverUrl && !imageError ? (
            <img
              ref={coverRef}
              src={coverUrl}
              alt={`${title} - ${artist}`}
              className={`w-full h-full object-cover transition-all duration-500 ${
                imageLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
              }`}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          ) : null}
          
          {/* 封面加载失败或无封面时的占位符 */}
          {(!coverUrl || imageError || !imageLoaded) && (
            <div className="w-full h-full bg-gradient-to-br from-cyber-primary/20 to-cyber-primary/5 flex items-center justify-center">
              <Music2 className="h-1/2 w-1/2 text-cyber-primary/40" />
            </div>
          )}
          
          {/* 封面上的光泽效果 */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        </div>

        {/* 增强的光泽效果 */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/5 via-transparent to-transparent opacity-70 group-hover:opacity-90 transition-opacity duration-500"></div>
        
        {/* 旋转时的额外光效 */}
        <div className={`absolute inset-0 rounded-full transition-opacity duration-500 ${isPlaying ? 'opacity-30' : 'opacity-0'}`}
             style={{
               background: `conic-gradient(from 0deg, transparent, rgba(255,255,255,0.1), transparent, rgba(255,255,255,0.05), transparent)`
             }}></div>
      </div>

      {/* 增强的悬浮光环效果 */}
      <div className="absolute inset-0 rounded-full bg-cyber-primary/15 blur-2xl opacity-0 group-hover:opacity-100 transition-all duration-700 -z-10 scale-110"></div>
      
      {/* 播放时的脉冲效果 */}
      {isPlaying && (
        <div className="absolute inset-0 rounded-full bg-green-500/20 blur-xl opacity-50 animate-pulse -z-20 scale-125"></div>
      )}
    </div>
  );
};

export default VinylRecord;
