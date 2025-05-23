import React, { useState } from 'react';
import { UploadCloud, Loader2, Music2, Image } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

interface UploadFormProps {
  onUploadSuccess?: () => void;
  onCancel?: () => void;
  albumId?: number;
  isBatch?: boolean;
}

interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
  coverFile?: File | null;
}

const UploadForm: React.FC<UploadFormProps> = ({ onUploadSuccess, onCancel, albumId, isBatch = false }) => {
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{[key: string]: number}>({});
  const [trackMetadata, setTrackMetadata] = useState<TrackMetadata>({
    title: '',
    artist: '',
    album: '',
    coverFile: null
  });

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

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter(file => {
      if (!validateFileType(file)) {
        addToast(`不支持的文件类型: ${file.name}`, 'error');
        return false;
      }
      return true;
    });

    setSelectedFiles(validFiles);
    
    // 如果是单个文件，尝试从文件名中提取标题
    if (validFiles.length === 1 && !isBatch) {
      const fileName = validFiles[0].name;
      const title = fileName.substring(0, fileName.lastIndexOf('.'));
      setTrackMetadata(prev => ({ ...prev, title }));
    }
  };

  // 处理封面选择
  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        addToast('请选择图片文件', 'error');
        return;
      }
      setTrackMetadata(prev => ({ ...prev, coverFile: file }));
    }
  };

  // 处理上传
  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsUploading(true);
    const formData = new FormData();
    
    // 添加音频文件
    for (const file of selectedFiles) {
      formData.append('trackFile', file);
    }

    // 添加元数据
    formData.append('title', trackMetadata.title);
    formData.append('artist', trackMetadata.artist);
    formData.append('album', trackMetadata.album);

    // 添加封面文件（如果有）
    if (trackMetadata.coverFile) {
      formData.append('coverFile', trackMetadata.coverFile);
    }

    // 如果是专辑上传，添加专辑ID
    if (albumId) {
      formData.append('albumId', albumId.toString());
      formData.append('isBatch', isBatch.toString());
    }

    try {
      const endpoint = albumId ? '/api/albums/upload-tracks' : '/api/upload';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('上传失败');
      }

      const data = await response.json();
      addToast('歌曲上传成功', 'success');
      setSelectedFiles([]);
      setTrackMetadata({
        title: '',
        artist: '',
        album: '',
        coverFile: null
      });
      onUploadSuccess?.();
    } catch (error) {
      console.error('Error uploading tracks:', error);
      addToast('上传失败', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-cyber-bg-darker p-6 rounded-lg border-2 border-cyber-primary">
      <h2 className="text-2xl font-bold text-cyber-primary mb-4">上传歌曲</h2>
      <div className="space-y-4">
        {/* 文件上传区域 */}
        <div className="border-2 border-dashed border-cyber-secondary rounded-lg p-4">
          <input
            type="file"
            multiple={isBatch}
            accept="audio/*"
            onChange={handleFileSelect}
            className="hidden"
            id="track-upload"
          />
          <label
            htmlFor="track-upload"
            className="flex flex-col items-center justify-center cursor-pointer"
          >
            <UploadCloud className="w-12 h-12 text-cyber-primary mb-2" />
            <span className="text-cyber-secondary">
              {selectedFiles.length > 0
                ? `已选择 ${selectedFiles.length} 个文件`
                : isBatch ? '点击或拖拽多个文件到此处' : '点击或拖拽文件到此处'}
            </span>
          </label>
        </div>

        {/* 元数据表单 */}
        {!isBatch && (
          <div className="space-y-4">
            <div>
              <label className="block text-cyber-secondary mb-2">歌曲标题</label>
              <input
                type="text"
                value={trackMetadata.title}
                onChange={(e) => setTrackMetadata(prev => ({ ...prev, title: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
                required
              />
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">艺术家</label>
              <input
                type="text"
                value={trackMetadata.artist}
                onChange={(e) => setTrackMetadata(prev => ({ ...prev, artist: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
              />
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">专辑</label>
              <input
                type="text"
                value={trackMetadata.album}
                onChange={(e) => setTrackMetadata(prev => ({ ...prev, album: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
              />
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">封面图片</label>
              <div className="flex items-center space-x-4">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleCoverSelect}
                  className="hidden"
                  id="cover-upload"
                />
                <label
                  htmlFor="cover-upload"
                  className="flex items-center px-4 py-2 bg-cyber-secondary text-cyber-bg-darker rounded cursor-pointer hover:bg-cyber-hover-secondary transition-colors"
                >
                  <Image className="mr-2 h-5 w-5" />
                  {trackMetadata.coverFile ? '更换封面' : '选择封面'}
                </label>
                {trackMetadata.coverFile && (
                  <span className="text-cyber-text">
                    {trackMetadata.coverFile.name}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 已选文件列表 */}
        {selectedFiles.length > 0 && (
          <div className="space-y-2">
            {selectedFiles.map((file, index) => (
              <div key={index} className="flex items-center justify-between text-sm text-cyber-secondary">
                <span className="truncate">{file.name}</span>
                <span>{Math.round(file.size / 1024)} KB</span>
              </div>
            ))}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-cyber-bg text-cyber-secondary rounded hover:bg-cyber-hover-secondary transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleUpload}
            disabled={isUploading || selectedFiles.length === 0 || (!isBatch && !trackMetadata.title)}
            className={`px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors ${
              (isUploading || selectedFiles.length === 0 || (!isBatch && !trackMetadata.title)) ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isUploading ? (
              <>
                <Loader2 className="inline-block animate-spin mr-2" />
                上传中...
              </>
            ) : '上传'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UploadForm; 