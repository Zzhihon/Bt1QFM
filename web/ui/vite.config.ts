import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    base: '/1qfm/',
    plugins: [
      react(),
      {
        name: 'remove-config-folder-after-build',
        closeBundle() {
          const configPath = path.resolve(__dirname, 'dist/config')
          if (fs.existsSync(configPath)) {
            fs.rmSync(configPath, { recursive: true, force: true })
            console.log('[vite] 已移除 dist/config 文件夹')
          }
        }
      }
    ],
    define: {
      // Provide a default backend URL at build time. The actual URL can be
      // overridden at runtime via the `window.__ENV__` object defined in
      // `public/config/env-config.js`.
      __BACKEND_URL__: JSON.stringify(env.VITE_BACKEND_URL || 'http://localhost:8080')
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom']
          }
        }
      },
      chunkSizeWarningLimit: 1000
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8080',
          changeOrigin: true,
        },
        '/streams': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8080',
          changeOrigin: true,
        },
        '/static': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8080',
          changeOrigin: true,
        }
      }
    }
  }
})