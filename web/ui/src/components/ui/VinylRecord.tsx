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

  // 尺寸配置 - 简化为只有黑胶外圈和封面
  const sizeConfig = {
    sm: { vinyl: 'w-32 h-32', cover: 'w-20 h-20' },
    md: { vinyl: 'w-48 h-48', cover: 'w-32 h-32' },
    lg: { vinyl: 'w-72 h-72', cover: 'w-48 h-48' }
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
        filter: 'drop-shadow(0 25px 50px rgba(33, 1, 32, 0.4))',
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

        {/* 中心孔 - 直接在黑胶上 */}
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${size === 'lg' ? 'w-6 h-6' : size === 'md' ? 'w-5 h-5' : 'w-4 h-4'} bg-black rounded-full shadow-inner border border-gray-800`}></div>

        {/* 封面图片 - 增大尺寸，直接贴在黑胶上 */}
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${currentSize.cover} rounded-full overflow-hidden`}
             style={{
               boxShadow: `
                 0 0 25px rgba(0, 0, 0, 0.9),
                 inset 0 0 15px rgba(0, 0, 0, 0.4),
                 0 0 0 3px rgba(255, 255, 255, 0.08)
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
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/15 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
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
