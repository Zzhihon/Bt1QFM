package netease

import (
	"net/http"
	"time"
)

// Client 网易云音乐API客户端
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
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
}

// SetTimeout 设置请求超时时间
func (c *Client) SetTimeout(timeout time.Duration) {
	c.HTTPClient.Timeout = timeout
}
