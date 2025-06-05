# -------- Stage 1: 构建阶段 --------
FROM node:20-alpine AS builder

# 使用 USTC 源并安装必要工具
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories \
    && apk add --no-cache libc6-compat

WORKDIR /app

# 设置 npm 镜像为 npmmirror
RUN npm config set registry https://registry.npmmirror.com

# 复制依赖文件
COPY package.json package-lock.json ./

# 安装依赖（生产锁定）
RUN npm ci

# 复制项目所有文件（忽略 .dockerignore 中配置的）
COPY . .

# 直接使用 vite build 跳过 TypeScript 类型检查
RUN npx vite build --mode production

# -------- Stage 2: 最终镜像 --------
FROM alpine:latest

# 安装基本工具
RUN apk add --no-cache ca-certificates

# 创建目标目录
RUN mkdir -p /var/docker_file/website/nginx_website/website_file/1qfm

# 创建非特权用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# 从构建阶段复制 dist 目录到指定位置
COPY --from=builder --chown=appuser:appgroup /app/dist /var/docker_file/website/nginx_website/website_file/1qfm

# 设置目录权限
RUN chown -R appuser:appgroup /var/docker_file/website/nginx_website/website_file/1qfm

WORKDIR /var/docker_file/website/nginx_website/website_file/1qfm

USER appuser

EXPOSE 3000

# 默认命令
CMD ["sh", "-c", "echo 'Frontend files deployed to /var/docker_file/website/nginx_website/website_file/1qfm' && ls -la /var/docker_file/website/nginx_website/website_file/1qfm"]