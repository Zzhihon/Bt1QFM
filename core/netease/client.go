package netease

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Client 网易云音乐API客户端
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	Cookies    struct {
		MUSIC_U string
		NMTID   string
		CSRF    string
	}
}

// NewClient 创建新的客户端实例
func NewClient() *Client {
	baseURL := os.Getenv("NETEASE_API_URL")
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}

	return &Client{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second, // 设置默认超时
		},
	}
}

// SetBaseURL 设置API的基础URL
func (c *Client) SetBaseURL(url string) {
	c.BaseURL = url
}

// SetTimeout 设置请求超时时间
func (c *Client) SetTimeout(timeout time.Duration) {
	c.HTTPClient.Timeout = timeout
}

// SetCookie 设置Cookie
func (c *Client) SetCookie(cookie string) {
	cookies := strings.Split(cookie, ";")
	for _, cookie := range cookies {
		cookie = strings.TrimSpace(cookie)
		if strings.HasPrefix(cookie, "MUSIC_U=") {
			c.Cookies.MUSIC_U = strings.TrimPrefix(cookie, "MUSIC_U=")
		} else if strings.HasPrefix(cookie, "NMTID=") {
			c.Cookies.NMTID = strings.TrimPrefix(cookie, "NMTID=")
		} else if strings.HasPrefix(cookie, "__csrf=") {
			c.Cookies.CSRF = strings.TrimPrefix(cookie, "__csrf=")
		}
	}
}

// createRequest 创建一个HTTP请求
func (c *Client) createRequest(method, url string) (*http.Request, error) {
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// 设置默认Header，模拟浏览器请求
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
	req.Header.Set("Referer", "http://music.163.com/")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Connection", "keep-alive")

	// 从环境变量获取cookie
	if cookie := os.Getenv("NETEASE_COOKIE"); cookie != "" {
		req.Header.Set("Cookie", cookie)
	} else {
		log.Printf("[client/createRequest] 警告: 未设置NETEASE_COOKIE环境变量")
	}

	return req, nil
}

// HandleError 处理API错误响应
// func (c *Client) HandleError(resp *http.Response) error {
// 	if resp.StatusCode >= 400 {
// 		return fmt.Errorf("API returned status code: %d", resp.StatusCode)
// 	}
// 	return nil
// }
