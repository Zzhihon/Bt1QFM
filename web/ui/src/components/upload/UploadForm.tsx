import React, { useState } from 'react';
import { UploadCloud, Loader2, Music2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

interface UploadFormProps {
  onUploadSuccess?: () => void;
  onCancel?: () => void;
  isBatch?: boolean;
}

const UploadForm: React.FC<UploadFormProps> = ({ onUploadSuccess, onCancel, isBatch = false }) => {
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  
  // 单文件上传状态
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [trackFile, setTrackFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // 批量上传状态
  const [uploadProgress, setUploadProgress] = useState(0);

  // 定义支持的文件类型
  const SUPPORTED_AUDIO_TYPES = {
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
    'audio/aac': '.aac',
    'audio/mp4': '.m4a'
  };

  // 验证文件类型
  const validateFileType = (file: File): boolean => {
    if (SUPPORTED_AUDIO_TYPES[file.type as keyof typeof SUPPORTED_AUDIO_TYPES]) {
      return true;
    }
    const extension = file.name.toLowerCase().split('.').pop();
    return extension === 'mp3' || extension === 'wav' || extension === 'flac' || extension === 'aac' || extension === 'm4a';
  };

  // 提取元数据
  const extractMetadata = async (file: File): Promise<{
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    picture?: {
      format: string;
      data: Uint8Array;
    };
  }> => {
    return new Promise((resolve, reject) => {
      // 首先尝试从文件名提取基本信息
      const fileName = file.name;
      const fileNameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));
      const defaultMetadata = {
        title: fileNameWithoutExt,
        artist: '',
        album: '',
        year: '',
        genre: '',
        picture: undefined
      };

      // 如果文件类型不支持元数据，直接返回文件名作为标题
      if (!['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a'].includes(file.type)) {
        console.log('文件类型不支持元数据，使用文件名作为标题');
        resolve(defaultMetadata);
        return;
      }

      if (!window.jsmediatags) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js';
        script.onload = () => {
          readMetadata();
        };
        script.onerror = () => {
          console.warn('无法加载jsmediatags库，使用文件名作为标题');
          resolve(defaultMetadata);
        };
        document.head.appendChild(script);
      } else {
        readMetadata();
      }

      function readMetadata() {
        window.jsmediatags.read(file, {
          onSuccess: (tag) => {
            try {
              const metadata = {
                title: tag.tags.title || defaultMetadata.title,
                artist: tag.tags.artist || defaultMetadata.artist,
                album: tag.tags.album || defaultMetadata.album,
                year: tag.tags.year || defaultMetadata.year,
                genre: tag.tags.genre || defaultMetadata.genre,
                picture: tag.tags.picture
              };
              console.log('成功读取元数据:', metadata);
              resolve(metadata);
            } catch (error) {
              console.warn('解析元数据时出错，使用默认值:', error);
              resolve(defaultMetadata);
            }
          },
          onError: (error) => {
            console.warn('读取元数据失败，使用文件名作为标题:', error);
            resolve(defaultMetadata);
          }
        });
      }
    });
  };

  // 处理文件选择
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, isBatch: boolean = false) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const file = files[0];
      if (!validateFileType(file)) {
        addToast('不支持的文件类型', 'error');
        return;
      }

      if (isBatch) {
        const metadata = await extractMetadata(file);
        const form = e.target.form;
        if (form) {
          const artistInput = form.querySelector('input[name="artist"]') as HTMLInputElement;
          const albumInput = form.querySelector('input[name="album"]') as HTMLInputElement;
          if (artistInput) artistInput.value = metadata.artist || '';
          if (albumInput) albumInput.value = metadata.album || '';
        }
      } else {
        const metadata = await extractMetadata(file);
        setTitle(metadata.title || '');
        setArtist(metadata.artist || '');
        setAlbum(metadata.album || '');
        
        if (metadata.picture) {
          try {
            const blob = new Blob([metadata.picture.data], { type: metadata.picture.format });
            const coverFile = new File([blob], 'cover.jpg', { type: metadata.picture.format });
            setCoverFile(coverFile);
          } catch (error) {
            console.warn('无法处理封面图片:', error);
          }
        }
      }
    } catch (error) {
      console.error('处理文件时出错:', error);
      addToast('处理文件时出错，请检查文件格式是否正确', 'warning');
    }
  };

  // 单文件上传处理
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackFile || !title) {
      setUploadError("标题和音频文件是必需的。");
      return;
    }
    if (!currentUser) {
      setUploadError("请先登录后再上传。");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('album', album);
    formData.append('trackFile', trackFile);
    if (coverFile) {
      formData.append('coverFile', coverFile);
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || `上传失败，状态码：${response.status}`);
      }

      setUploadSuccess(result.message || `歌曲 '${result.title || title}' 上传成功！`);
      onUploadSuccess?.();
      
      // 重置表单
      setTitle('');
      setArtist('');
      setAlbum('');
      setTrackFile(null);
      setCoverFile(null);

    } catch (err: any) {
      console.error("Upload error:", err);
      setUploadError(err.message || '上传过程中发生错误。请查看控制台获取详细信息。');
    } finally {
      setUploading(false);
    }
  };

  // 批量上传处理
  const handleBatchUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    const artist = formData.get('artist') as string;
    const album = formData.get('album') as string;
    const coverFile = formData.get('cover') as File;
    const audioFiles = formData.getAll('audioFiles') as File[];

    if (!artist || !album || !coverFile || audioFiles.length === 0) {
      addToast('请填写所有必要信息', 'error');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // 1. 先上传封面到static/cover目录
      const coverFormData = new FormData();
      coverFormData.append('cover', coverFile);
      coverFormData.append('artist', artist);
      coverFormData.append('album', album);
      coverFormData.append('targetDir', 'static/cover'); // 添加目标目录参数

      // 添加重试机制
      let retryCount = 0;
      const maxRetries = 3;
      let coverUploadSuccess = false;
      let coverPath = '';

      while (retryCount < maxRetries && !coverUploadSuccess) {
        try {
          const coverResponse = await fetch('/api/upload/cover', {
            method: 'POST',
            body: coverFormData,
            headers: {
              ...(authToken && { 'Authorization': `Bearer ${authToken}` })
            }
          });

          if (!coverResponse.ok) {
            const errorData = await coverResponse.json();
            throw new Error(errorData.error || `封面上传失败: ${coverResponse.status}`);
          }

          const coverResult = await coverResponse.json();
          console.log('封面上传成功:', coverResult);
          coverPath = coverResult.coverPath;
          coverUploadSuccess = true;
        } catch (error) {
          retryCount++;
          console.warn(`封面上传失败，第${retryCount}次重试:`, error);
          if (retryCount === maxRetries) {
            throw new Error('封面上传失败，请稍后重试');
          }
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }

      // 2. 上传音频文件
      const totalFiles = audioFiles.length;
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < totalFiles; i++) {
        const file = audioFiles[i];
        const trackFormData = new FormData();
        trackFormData.append('title', file.name.replace(/\.[^/.]+$/, ''));
        trackFormData.append('artist', artist);
        trackFormData.append('album', album);
        trackFormData.append('trackFile', file);
        if (coverPath) {
          trackFormData.append('coverPath', coverPath); // 添加封面路径
        }

        try {
          const response = await fetch('/api/upload', {
            method: 'POST',
            body: trackFormData,
            headers: {
              ...(authToken && { 'Authorization': `Bearer ${authToken}` })
            }
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `上传失败: ${response.status}`);
          }

          const result = await response.json();
          console.log(`文件 ${i + 1}/${totalFiles} 上传成功:`, result);
          successCount++;
        } catch (error) {
          console.error(`文件 ${i + 1}/${totalFiles} 上传失败:`, error);
          failCount++;
        }

        // 更新进度
        setUploadProgress(Math.round(((i + 1) / totalFiles) * 100));
      }

      // 显示最终结果
      if (successCount === totalFiles) {
        addToast(`所有文件上传成功！`, 'success');
      } else {
        addToast(`上传完成：${successCount}个成功，${failCount}个失败`, 'warning');
      }

      onUploadSuccess?.();
    } catch (error: any) {
      console.error('批量上传失败:', error);
      addToast(error.message || '上传过程中发生错误', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  if (isBatch) {
    return (
      <div className="bg-cyber-bg-darker p-6 rounded-lg w-full max-w-2xl">
        <h2 className="text-xl font-bold text-cyber-primary mb-4">批量上传专辑</h2>
        <form onSubmit={handleBatchUploadSubmit} className="space-y-4">
          <div>
            <label className="block text-cyber-text mb-2">艺术家</label>
            <input
              type="text"
              name="artist"
              required
              className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
            />
          </div>
          <div>
            <label className="block text-cyber-text mb-2">专辑名称</label>
            <input
              type="text"
              name="album"
              required
              className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
            />
          </div>
          <div>
            <label className="block text-cyber-text mb-2">专辑封面</label>
            <input
              type="file"
              name="cover"
              accept="image/*"
              required
              className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
            />
          </div>
          <div>
            <label className="block text-cyber-text mb-2">音频文件（可多选）</label>
            <input
              type="file"
              name="audioFiles"
              accept="audio/*,.flac,.wav,.mp3,.aac,.m4a"
              multiple
              required
              onChange={(e) => handleFileSelect(e, true)}
              className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
            />
          </div>
          {uploadProgress > 0 && (
            <div className="w-full bg-cyber-bg rounded-full h-2.5">
              <div
                className="bg-cyber-primary h-2.5 rounded-full"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          )}
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-cyber-text hover:text-cyber-primary transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="bg-cyber-primary text-cyber-bg-darker px-4 py-2 rounded hover:bg-cyber-hover-primary transition-colors disabled:opacity-50"
            >
              {uploading ? '上传中...' : '上传'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-cyber-bg-darker p-6 rounded-lg shadow-xl border border-cyber-primary">
      <h3 className="text-2xl font-semibold mb-4 text-cyber-primary">上传新歌曲</h3>
      <form onSubmit={handleUploadSubmit} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-cyber-secondary">标题:</label>
          <input 
            type="text" 
            id="title" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)} 
            required 
            className="mt-1 block w-full bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-cyber-primary focus:border-cyber-primary sm:text-sm placeholder-cyber-muted" 
          />
        </div>
        <div>
          <label htmlFor="artist" className="block text-sm font-medium text-cyber-secondary">艺术家:</label>
          <input 
            type="text" 
            id="artist" 
            value={artist} 
            onChange={(e) => setArtist(e.target.value)} 
            className="mt-1 block w-full bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-cyber-primary focus:border-cyber-primary sm:text-sm placeholder-cyber-muted" 
          />
        </div>
        <div>
          <label htmlFor="album" className="block text-sm font-medium text-cyber-secondary">专辑:</label>
          <input 
            type="text" 
            id="album" 
            value={album} 
            onChange={(e) => setAlbum(e.target.value)} 
            className="mt-1 block w-full bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-cyber-primary focus:border-cyber-primary sm:text-sm placeholder-cyber-muted" 
          />
        </div>
        <div>
          <label htmlFor="trackFile" className="block text-sm font-medium text-cyber-secondary">音频文件 (WAV/MP3/FLAC/AAC/M4A):</label>
          <input 
            type="file" 
            id="trackFile" 
            onChange={(e) => {
              if (e.target.files) {
                setTrackFile(e.target.files[0]);
                handleFileSelect(e);
              }
            }} 
            accept=".wav,.mp3,.flac,.aac,.m4a" 
            required 
            className="mt-1 block w-full text-sm text-cyber-text file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyber-primary file:text-cyber-bg-darker hover:file:bg-cyber-hover-primary file:cursor-pointer" 
          />
        </div>
        <div>
          <label htmlFor="coverFile" className="block text-sm font-medium text-cyber-secondary">封面图片 (JPG, PNG):</label>
          <input 
            type="file" 
            id="coverFile" 
            onChange={(e) => setCoverFile(e.target.files ? e.target.files[0] : null)} 
            accept="image/jpeg,image/png" 
            className="mt-1 block w-full text-sm text-cyber-text file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyber-primary file:text-cyber-bg-darker hover:file:bg-cyber-hover-primary file:cursor-pointer" 
          />
        </div>
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-cyber-text hover:text-cyber-primary transition-colors"
          >
            取消
          </button>
          <button 
            type="submit" 
            disabled={uploading} 
            className="flex items-center justify-center bg-cyber-green hover:bg-green-400 text-cyber-bg-darker font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline disabled:opacity-50 transition-colors duration-300"
          >
            {uploading && <Loader2 className="animate-spin mr-2 h-5 w-5" />} 
            {uploading ? '上传中...' : '上传'}
          </button>
        </div>
        {uploadError && <p className="mt-2 text-sm text-center text-cyber-red">{uploadError}</p>}
        {uploadSuccess && <p className="mt-2 text-sm text-center text-cyber-green">{uploadSuccess}</p>}
      </form>
    </div>
  );
};

export default UploadForm; 