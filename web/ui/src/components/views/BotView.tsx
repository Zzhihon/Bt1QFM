import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { useToast } from '../../contexts/ToastContext';
import { Music2, Search, PlayCircle } from 'lucide-react';

interface NeteaseSong {
  id: number;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string; picUrl: string };
  duration: number;
  url: string;
}

const BotView: React.FC = () => {
  const { currentUser } = useAuth();
  const { playTrack } = usePlayer();
  const { addToast } = useToast();
  const [command, setCommand] = useState('');
  const [searchResults, setSearchResults] = useState<NeteaseSong[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    // 检查是否是网易云音乐命令
    if (!command.startsWith('/netease ')) {
      addToast('请输入正确的命令格式: /netease [歌曲名称]', 'error');
      return;
    }

    const keyword = command.replace('/netease ', '').trim();
    if (!keyword) {
      addToast('请输入要搜索的歌曲名称', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/netease/search?q=${encodeURIComponent(keyword)}`);
      if (!response.ok) {
        throw new Error('搜索失败');
      }
      const data = await response.json();
      if (data.success && data.data) {
        setSearchResults(data.data.slice(0, 3)); // 只显示前3个结果
      } else {
        throw new Error(data.error || '搜索失败');
      }
    } catch (error: any) {
      addToast(error.message || '搜索失败', 'error');
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = async (song: NeteaseSong) => {
    try {
      console.log('开始获取播放地址，歌曲ID:', song.id);
      
      // 获取播放URL
      const response = await fetch(`/api/netease/command?command=/netease ${song.id}`);
      console.log('API响应状态:', response.status);
      
      if (!response.ok) {
        throw new Error('获取播放地址失败');
      }
      
      const data = await response.json();
      console.log('API返回数据:', data);
      
      // 检查返回的数据结构
      if (!data.success) {
        console.error('API返回失败:', data);
        throw new Error('获取播放地址失败');
      }

      if (!Array.isArray(data.data) || data.data.length === 0) {
        console.error('API返回数据格式错误 - 不是数组或数组为空:', data);
        throw new Error('获取播放地址失败');
      }

      const songData = data.data[0];
      if (!songData || !songData.url) {
        console.error('API返回数据格式错误 - 缺少url字段:', songData);
        throw new Error('获取播放地址失败');
      }

      console.log('获取到的播放地址:', songData.url);
      
      // 直接使用URL播放
      playTrack({
        id: song.id,
        title: song.name,
        artist: song.artists.map(a => a.name).join(', '),
        album: song.album.name,
        coverArtPath: song.album.picUrl,
        url: songData.url, // 直接使用URL
        position: 0
      });

      addToast(`正在播放: ${song.name}`, 'success');
    } catch (error: any) {
      console.error('播放过程发生错误:', error);
      addToast(error.message || '播放失败', 'error');
    }
  };

  return (
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32">
      <header className="my-8 text-center">
        <h1 className="text-5xl font-bold text-cyber-primary animate-pulse">Music Bot</h1>
        <p className="text-cyber-secondary mt-2">输入命令搜索并播放音乐</p>
      </header>

      <div className="max-w-2xl mx-auto">
        <form onSubmit={handleCommand} className="mb-8">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="/netease [歌曲名称]"
              className="flex-1 p-3 bg-cyber-bg-darker border-2 border-cyber-secondary rounded-lg text-cyber-text focus:outline-none focus:border-cyber-primary"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="p-3 bg-cyber-primary text-cyber-bg-darker rounded-lg hover:bg-cyber-hover-primary transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-cyber-bg-darker border-t-transparent" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </button>
          </div>
        </form>

        {searchResults.length > 0 && (
          <div className="space-y-4">
            {searchResults.map((song) => (
              <div
                key={song.id}
                className="bg-cyber-bg-darker border-2 border-cyber-secondary rounded-lg p-4 hover:border-cyber-primary transition-colors cursor-pointer"
                onClick={() => handlePlay(song)}
              >
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-cyber-bg rounded-lg overflow-hidden flex-shrink-0">
                    {song.album.picUrl ? (
                      <img
                        src={song.album.picUrl}
                        alt={song.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music2 className="h-8 w-8 text-cyber-primary" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-cyber-primary truncate">
                      {song.name}
                    </h3>
                    <p className="text-sm text-cyber-secondary truncate">
                      {song.artists.map(a => a.name).join(', ')}
                    </p>
                    <p className="text-xs text-cyber-muted truncate">
                      {song.album.name}
                    </p>
                  </div>
                  <PlayCircle className="h-8 w-8 text-cyber-primary flex-shrink-0" />
                </div>
              </div>
            ))}
          </div>
        )}

        {command && !isLoading && searchResults.length === 0 && (
          <div className="text-center text-cyber-secondary py-8">
            没有找到相关歌曲
          </div>
        )}
      </div>
    </div>
  );
};

export default BotView; 