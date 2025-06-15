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
              rgba(35, 35, 35, 1) 0%,
              rgba(25, 25, 25, 1) 15%,
              rgba(15, 15, 15, 1) 35%,
              rgba(8, 8, 8, 1) 60%,
              rgba(3, 3, 3, 1) 80%,
              rgba(0, 0, 0, 1) 100%
            )
          `,
          boxShadow: `
            inset 0 0 40px rgba(255, 255, 255, 0.12),
            inset 0 0 100px rgba(0, 0, 0, 0.9),
            0 20px 50px rgba(0, 0, 0, 0.7),
            0 8px 25px rgba(0, 0, 0, 0.5),
            0 0 0 2px rgba(100, 100, 100, 0.4)
          `
        }}
      >
        {/* 外围明亮纹理圈 - 模拟真实黑胶唱片 */}
        <div className="absolute inset-0 rounded-full">
          {/* 最外层明亮边缘 */}
          <div className="absolute inset-0 rounded-full" 
               style={{
                 background: `
                   radial-gradient(circle at 50% 50%, 
                     transparent 85%,
                     rgba(180, 180, 180, 0.6) 88%,
                     rgba(200, 200, 200, 0.8) 90%,
                     rgba(9, 9, 9, 0.4) 92%,
                     transparent 94%
                   )
                 `}}></div>
          
          {/* 第二层明亮圈 */}
          <div className="absolute inset-0 rounded-full"
               style={{
                 background: `
                   radial-gradient(circle at 50% 50%, 
                     transparent 75%,
                     rgba(18, 17, 17, 0.3) 78%,
                     rgba(12, 12, 12, 0.5) 80%,
                     rgba(160, 160, 160, 0.3) 82%,
                     transparent 84%
                   )
                 `}}></div>
          
          {/* 第三层明亮圈 */}
          <div className="absolute inset-0 rounded-full"
               style={{
                 background: `
                   radial-gradient(circle at 50% 50%, 
                     transparent 65%,
                     rgba(9, 9, 9, 0.2) 68%,
                     rgba(10, 10, 10, 0.4) 70%,
                     rgba(140, 140, 140, 0.2) 72%,
                     transparent 74%
                   )
                 `}}></div>
        </div>

        {/* 增强黑胶纹理 - 更多圈数和更细腻的效果 */}
        <div className="absolute inset-0 rounded-full opacity-50">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full border"
              style={{
                top: `${2 + i * 4.8}%`,
                left: `${2 + i * 4.8}%`,
                right: `${2 + i * 4.8}%`,
                bottom: `${2 + i * 4.8}%`,
                borderColor: i % 3 === 0 
                  ? 'rgba(120, 120, 120, 0.25)' 
                  : i % 2 === 0 
                    ? 'rgba(80, 80, 80, 0.2)' 
                    : 'rgba(60, 60, 60, 0.15)',
                borderWidth: i % 4 === 0 ? '0.5px' : '0.25px'
              }}
            />
          ))}
        </div>

        {/* 反光效果增强 */}
        <div className="absolute inset-0 rounded-full"
             style={{
               background: `
                 conic-gradient(from 45deg, 
                   transparent 0deg,
                   rgba(255, 255, 255, 0.08) 60deg,
                   rgba(255, 255, 255, 0.15) 90deg,
                   rgba(255, 255, 255, 0.08) 120deg,
                   transparent 180deg,
                   rgba(255, 255, 255, 0.05) 240deg,
                   rgba(255, 255, 255, 0.1) 270deg,
                   rgba(255, 255, 255, 0.05) 300deg,
                   transparent 360deg
                 )
               `,
               opacity: 0.7
             }}></div>

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
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/8 via-transparent to-transparent opacity-60 group-hover:opacity-85 transition-opacity duration-500"></div>
        
        {/* 旋转时的额外光效 - 增强效果 */}
        <div className={`absolute inset-0 rounded-full transition-opacity duration-500 ${isPlaying ? 'opacity-40' : 'opacity-0'}`}
             style={{
               background: `
                 conic-gradient(from 0deg, 
                   transparent, 
                   rgba(255,255,255,0.15), 
                   transparent, 
                   rgba(255,255,255,0.08), 
                   transparent,
                   rgba(255,255,255,0.12),
                   transparent
                 )
               `}}></div>
      </div>

      {/* 增强的悬浮光环效果 */}
      <div className="absolute inset-0 rounded-full bg-cyber-primary/20 blur-3xl opacity-0 group-hover:opacity-100 transition-all duration-700 -z-10 scale-115"></div>
      
      {/* 播放时的脉冲效果 - 增强 */}
      {isPlaying && (
        <>
          <div className="absolute inset-0 rounded-full bg-green-500/15 blur-2xl opacity-60 animate-pulse -z-20 scale-130"></div>
          <div className="absolute inset-0 rounded-full bg-green-400/10 blur-xl opacity-40 animate-pulse -z-21 scale-140" 
               style={{ animationDelay: '0.5s' }}></div>
        </>
      )}
    </div>
  );
};

export default VinylRecord;
