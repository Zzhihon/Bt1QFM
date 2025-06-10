// HTTP拦截器 - 处理401响应自动跳转登录页面

interface AuthInterceptorConfig {
  onUnauthorized?: () => void;
  excludePaths?: string[];
}

class AuthInterceptor {
  private config: AuthInterceptorConfig;

  constructor(config: AuthInterceptorConfig = {}) {
    this.config = config;
    this.setupFetchInterceptor();
  }

  // 设置 Fetch 拦截器
  private setupFetchInterceptor() {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      // 自动添加token到请求头
      if (args[1]) {
        const token = localStorage.getItem('authToken');
        if (token) {
          args[1].headers = {
            ...args[1].headers,
            'Authorization': `Bearer ${token}`
          };
        }
      } else if (args[0] && typeof args[0] === 'string') {
        // 如果只有URL参数，创建options对象
        const token = localStorage.getItem('authToken');
        if (token) {
          args[1] = {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          };
        }
      }

      const response = await originalFetch(...args);
      
      // 处理401响应
      if (response.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        
        // 检查是否在排除路径中
        if (!this.shouldExclude(url)) {
          this.handleUnauthorized();
        }
      }
      
      return response;
    };
  }

  // 检查是否应该排除某个路径
  private shouldExclude(url: string): boolean {
    if (!this.config.excludePaths) return false;
    
    return this.config.excludePaths.some(path => 
      url.includes(path)
    );
  }

  // 处理未授权响应
  private handleUnauthorized() {
    console.log('[Auth] 检测到401响应，清除token并跳转到登录页面');
    
    // 清除本地存储的认证信息
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('playerState');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('currentUser');
    
    // 调用自定义回调
    if (this.config.onUnauthorized) {
      this.config.onUnauthorized();
    }
    
    // 跳转到登录页面
    this.redirectToLogin();
  }

  // 跳转到登录页面
  private redirectToLogin() {
    const currentPath = window.location.pathname;
    const loginPath = '/login';
    
    // 避免在登录页面重复跳转
    if (currentPath !== loginPath && currentPath !== '/register') {
      // 保存当前页面路径，登录后可以返回
      sessionStorage.setItem('redirectUrl', window.location.href);
      window.location.href = loginPath;
    }
  }

  // 手动检查token有效性
  public checkTokenValidity(): boolean {
    const token = localStorage.getItem('authToken');
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

  // 手动触发未授权处理
  public triggerUnauthorized() {
    this.handleUnauthorized();
  }
}

// 创建全局拦截器实例
export const authInterceptor = new AuthInterceptor({
  excludePaths: ['/api/auth/login', '/api/auth/register', '/login', '/register'],
  onUnauthorized: () => {
    // 可以在这里添加toast提示
    console.log('用户认证已过期，请重新登录');
  }
});

// 导出创建拦截器的函数，供其他组件使用
export const createAuthInterceptor = (config?: AuthInterceptorConfig) => {
  return new AuthInterceptor(config);
};

export default AuthInterceptor;
