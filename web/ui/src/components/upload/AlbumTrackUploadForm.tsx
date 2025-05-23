import React, { useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

interface AlbumTrackUploadFormProps {
  onUploadSuccess?: () => void;
  onCancel?: () => void;
  albumId: number;
  isBatch?: boolean;
}

const AlbumTrackUploadForm: React.FC<AlbumTrackUploadFormProps> = ({ 
  onUploadSuccess, 
  onCancel, 
  albumId, 
  isBatch = false 
}) => {
  const { authToken } = useAuth();
  const { addToast } = useToast();
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

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
  };

  // 处理上传
  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsUploading(true);
    const formData = new FormData();
    
    // 添加音频文件
    for (const file of selectedFiles) {
      formData.append('files', file);
    }

    // 添加专辑ID和批量上传标志
    formData.append('albumId', albumId.toString());
    formData.append('isBatch', isBatch.toString());

    try {
      const response = await fetch('/api/albums/upload-tracks', {
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
      onUploadSuccess?.();
    } catch (error) {
      console.error('Error uploading tracks:', error);
      addToast('上传失败', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
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
          disabled={isUploading || selectedFiles.length === 0}
          className={`px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors ${
            (isUploading || selectedFiles.length === 0) ? 'opacity-50 cursor-not-allowed' : ''
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
  );
};

export default AlbumTrackUploadForm; 