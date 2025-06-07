package main

import (
	"fmt"
	"strings"

	"Bt1QFM/core/netease"
	"Bt1QFM/logger"
)

func main() {
	// 创建客户端实例
	client := netease.NewClient()

	// 1. 搜索歌曲
	fmt.Println("搜索歌曲...")
	searchResult, err := client.SearchSongs("周杰伦", 10, 2, nil, "")
	if err != nil {
		logger.Fatal("搜索失败", logger.ErrorField(err))
	}
	fmt.Printf("找到 %d 首歌曲\n", searchResult.Total)

	// 2. 获取第一首歌曲的详情
	if len(searchResult.Songs) > 0 {
		song := searchResult.Songs[5]
		fmt.Printf("\n获取歌曲详情: %s\n", song.Name)

		// 获取艺术家名称
		artistNames := make([]string, len(song.Artists))
		for i, artist := range song.Artists {
			artistNames[i] = artist.Name
		}
		fmt.Printf("艺术家: %s\n", strings.Join(artistNames, ", "))
		fmt.Printf("专辑: %s\n", song.Album.Name)

		songDetail, err := client.GetSongDetail(fmt.Sprintf("%d", song.ID))
		if err != nil {
			logger.Error("获取歌曲详情失败", logger.ErrorField(err))
		} else {
			fmt.Printf("歌曲时长: %d 毫秒\n", songDetail.Duration)
		}

		// 3. 获取歌词
		fmt.Println("\n获取歌词...")
		lyric, err := client.GetLyric(fmt.Sprintf("%d", song.ID))
		if err != nil {
			logger.Error("获取歌词失败", logger.ErrorField(err))
		} else {
			fmt.Printf("歌词长度: %d 字符\n", len(lyric.Lyric))
			if lyric.TransLyric != "" {
				fmt.Printf("翻译歌词长度: %d 字符\n", len(lyric.TransLyric))
			}
		}

		// 4. 获取播放地址
		fmt.Println("\n获取播放地址...")
		url, err := client.GetSongURL(fmt.Sprintf("%d", song.ID))
		if err != nil {
			logger.Error("获取播放地址失败", logger.ErrorField(err))
		} else {
			fmt.Printf("播放地址: %s\n", url)
		}
	}

	// 5. 获取歌单信息
	fmt.Println("\n获取歌单信息...")
	playlistID := "2829816517" // 示例歌单ID
	playlist, err := client.GetPlaylistDetail(playlistID)
	if err != nil {
		logger.Error("获取歌单信息失败", logger.ErrorField(err))
	} else {
		fmt.Printf("歌单名称: %s\n", playlist.Name)
		fmt.Printf("歌曲数量: %d\n", playlist.TrackCount)
		fmt.Printf("播放次数: %d\n", playlist.PlayCount)

		// 获取歌单中的歌曲
		tracks, err := client.GetPlaylistTracks(playlistID)
		if err != nil {
			logger.Error("获取歌单歌曲失败", logger.ErrorField(err))
		} else {
			fmt.Printf("\n歌单中的歌曲数量: %d\n", len(tracks))
			if len(tracks) > 0 {
				artistNames := make([]string, len(tracks[0].Artists))
				for i, artist := range tracks[0].Artists {
					artistNames[i] = artist.Name
				}
				fmt.Printf("第一首歌曲: %s - %s\n", tracks[0].Name, strings.Join(artistNames, ", "))
			}
		}
	}
}
