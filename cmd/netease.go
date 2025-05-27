package cmd

import (
	"fmt"
	"log"
	"os"
	"strings"

	"Bt1QFM/core/netease"

	"github.com/spf13/cobra"
)

var (
	searchKeyword string
	limit         int
	offset        int
)

var neteaseCmd = &cobra.Command{
	Use:   "netease",
	Short: "网易云音乐命令行工具",
	Long:  `一个简单的网易云音乐命令行工具，可以搜索歌曲并获取播放地址`,
	Run: func(cmd *cobra.Command, args []string) {
		if searchKeyword == "" {
			fmt.Println("请输入要搜索的歌曲名称")
			os.Exit(1)
		}

		client := netease.NewClient()

		// 搜索歌曲
		fmt.Printf("正在搜索: %s\n", searchKeyword)
		result, err := client.SearchSongs(searchKeyword, 5, 0, nil, "")
		if err != nil {
			log.Fatalf("搜索失败: %v", err)
		}

		if len(result.Songs) == 0 {
			fmt.Println("未找到相关歌曲")
			return
		}

		// 显示搜索结果
		fmt.Printf("\n找到 %d 首歌曲:\n", len(result.Songs))
		for i, song := range result.Songs {
			artistNames := make([]string, len(song.Artists))
			for j, artist := range song.Artists {
				artistNames[j] = artist.Name
			}
			fmt.Printf("%d. %s - %s [%s]\n",
				i+1,
				song.Name,
				strings.Join(artistNames, ", "),
				song.Album.Name)
		}

		// 获取用户选择
		var choice int
		fmt.Print("\n请选择要获取播放地址的歌曲编号: ")
		fmt.Scan(&choice)

		if choice < 1 || choice > len(result.Songs) {
			fmt.Println("无效的选择")
			return
		}

		// 获取选中歌曲的播放地址
		selectedSong := result.Songs[choice-1]
		url, err := client.GetSongURL(fmt.Sprintf("%d", selectedSong.ID))
		if err != nil {
			log.Fatalf("获取播放地址失败: %v", err)
		}

		// 获取选中歌曲的艺术家名称
		selectedArtistNames := make([]string, len(selectedSong.Artists))
		for i, artist := range selectedSong.Artists {
			selectedArtistNames[i] = artist.Name
		}

		fmt.Printf("\n歌曲: %s\n", selectedSong.Name)
		fmt.Printf("艺术家: %s\n", strings.Join(selectedArtistNames, ", "))
		fmt.Printf("专辑: %s\n", selectedSong.Album.Name)
		fmt.Printf("播放地址: %s\n", url)
	},
}

func init() {
	rootCmd.AddCommand(neteaseCmd)

	// 添加命令行参数
	neteaseCmd.Flags().StringVarP(&searchKeyword, "keyword", "k", "", "要搜索的歌曲名称")
	neteaseCmd.Flags().IntVarP(&limit, "limit", "l", 10, "返回结果数量")
	neteaseCmd.Flags().IntVarP(&offset, "offset", "o", 0, "结果偏移量")
}
