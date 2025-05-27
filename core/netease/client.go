package netease

import (
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

// NewClient 创建新的API客户端
func NewClient() *Client {
	return &Client{
		BaseURL: "https://netease-api.example.com",
		HTTPClient: &http.Client{
			Timeout: time.Second * 10,
		},
	}
}

// SetBaseURL 设置API基础URL
func (c *Client) SetBaseURL(url string) {
	c.BaseURL = url
	log.Printf("[client/SetBaseURL] 设置BaseURL为: %s", url)
}

// SetTimeout 设置请求超时时间
func (c *Client) SetTimeout(timeout time.Duration) {
	c.HTTPClient.Timeout = timeout
	log.Printf("[client/SetTimeout] 设置超时时间为: %v", timeout)
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
	log.Printf("[client/SetCookie] 设置Cookie: MUSIC_U=%s, NMTID=%s, CSRF=%s", c.Cookies.MUSIC_U, c.Cookies.NMTID, c.Cookies.CSRF)
}

// createRequest 创建带有Cookie的请求
func (c *Client) createRequest(method, url string) (*http.Request, error) {
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		log.Printf("[client/createRequest] 创建请求失败: %v", err)
		return nil, err
	}

	// 设置通用请求头
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Origin", "https://music.163.com")
	req.Header.Set("Referer", "https://music.163.com/")
	req.Header.Set("X-Real-IP", "118.88.88.88")
	req.Header.Set("X-Forwarded-For", "118.88.88.88")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")

	// 从环境变量获取cookie
	if cookie := os.Getenv("NETEASE_COOKIE"); cookie != "" {
		req.Header.Set("Cookie", cookie)
		log.Printf("[client/createRequest] 从环境变量获取Cookie")
	} else {
		log.Printf("[client/createRequest] 警告: 未设置NETEASE_COOKIE环境变量")
	}
	log.Printf("[client/createRequest] 创建请求 %s %s", method, url)
	return req, nil
}
