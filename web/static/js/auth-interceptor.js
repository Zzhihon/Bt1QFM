// HTTP请求拦截器 - 处理401响应自动跳转登录页面

class AuthInterceptor {
    constructor() {
        this.setupAxiosInterceptor();
        this.setupFetchInterceptor();
    }

    // 设置 Axios 拦截器
    setupAxiosInterceptor() {
        if (typeof axios !== 'undefined') {
            // 请求拦截器 - 自动添加token
            axios.interceptors.request.use(
                config => {
                    const token = localStorage.getItem('token');
                    if (token) {
                        config.headers.Authorization = `Bearer ${token}`;
                    }
                    return config;
                },
                error => Promise.reject(error)
            );

            // 响应拦截器 - 处理401响应
            axios.interceptors.response.use(
                response => response,
                error => {
                    if (error.response?.status === 401) {
                        this.handleUnauthorized();
                    }
                    return Promise.reject(error);
                }
            );
        }
    }

    // 设置 Fetch 拦截器
    setupFetchInterceptor() {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            // 自动添加token到请求头
            if (args[1]) {
                const token = localStorage.getItem('token');
                if (token) {
                    args[1].headers = {
                        ...args[1].headers,
                        'Authorization': `Bearer ${token}`
                    };
                }
            }

            const response = await originalFetch(...args);
            
            // 处理401响应
            if (response.status === 401) {
                this.handleUnauthorized();
            }
            
            return response;
        };
    }

    // 处理未授权响应
    handleUnauthorized() {
        console.log('[Auth] 检测到401响应，清除token并跳转到登录页面');
        
        // 清除本地存储的认证信息
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        
        // 显示提示信息
        this.showLoginPrompt();
        
        // 延迟跳转，让用户看到提示信息
        setTimeout(() => {
            this.redirectToLogin();
        }, 1500);
    }

    // 显示登录提示
    showLoginPrompt() {
        // 如果页面有提示区域，显示消息
        const messageArea = document.querySelector('.message-area') || document.querySelector('#message');
        if (messageArea) {
            messageArea.innerHTML = '<div class="alert alert-warning">登录已过期，即将跳转到登录页面...</div>';
        } else {
            // 使用浏览器原生提示
            alert('登录已过期，请重新登录');
        }
    }

    // 跳转到登录页面
    redirectToLogin() {
        const currentPath = window.location.pathname;
        const loginPath = '/login';
        
        // 避免在登录页面重复跳转
        if (currentPath !== loginPath) {
            // 保存当前页面路径，登录后可以返回
            sessionStorage.setItem('redirectUrl', window.location.href);
            window.location.href = loginPath;
        }
    }

    // 检查token是否存在且有效
    isTokenValid() {
        const token = localStorage.getItem('token');
        if (!token) return false;

        try {
            // 简单的JWT过期检查
            const payload = JSON.parse(atob(token.split('.')[1]));
            const currentTime = Math.floor(Date.now() / 1000);
            return payload.exp > currentTime;
        } catch (error) {
            console.error('[Auth] Token解析失败:', error);
            return false;
        }
    }

    // 手动触发登录检查
    checkAuth() {
        if (!this.isTokenValid()) {
            this.handleUnauthorized();
            return false;
        }
        return true;
    }
}

// 页面加载完成后初始化拦截器
document.addEventListener('DOMContentLoaded', () => {
    window.authInterceptor = new AuthInterceptor();
    
    // 页面加载时检查token状态
    if (!window.authInterceptor.isTokenValid() && 
        window.location.pathname !== '/login' && 
        window.location.pathname !== '/register') {
        window.authInterceptor.handleUnauthorized();
    }
});

// 导出供其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthInterceptor;
}
