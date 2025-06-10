export async function retryWithDelay<T>(
  fn: () => Promise<T>,
  maxRetries: number = 10,
  delay: number = 50,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (i === maxRetries) {
        throw lastError;
      }
      
      // 调用重试回调（如果提供）
      if (onRetry) {
        onRetry(i + 1, lastError);
      }
      
      // 等待指定延迟后重试
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// 带指数退避的重试机制
export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelay: number = 1000,
  maxDelay: number = 30000,
  onRetry?: (attempt: number, error: Error, nextDelay: number) => void
): Promise<T> {
  let lastError: Error;
  let currentDelay = initialDelay;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (i === maxRetries) {
        throw lastError;
      }
      
      // 调用重试回调（如果提供）
      if (onRetry) {
        onRetry(i + 1, lastError, currentDelay);
      }
      
      // 等待当前延迟时间
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      
      // 指数退避：延迟时间翻倍，但不超过最大延迟
      currentDelay = Math.min(currentDelay * 2, maxDelay);
    }
  }
  
  throw lastError!;
}
