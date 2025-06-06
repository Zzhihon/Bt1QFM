# ---------- 构建阶段 ----------
FROM golang:1.23.3-alpine3.20 AS builder

LABEL maintainer="AptS:1547 <esaps@esaps.net>"

WORKDIR /app

COPY go.mod go.sum ./

RUN go env -w GOPROXY=https://goproxy.cn,direct \
    && go mod download

COPY . .

ENV CGO_ENABLED=0
ENV GOOS=linux
ENV GOARCH=amd64

RUN go build -ldflags="-s -w" -o 1qfm


# ---------- 运行阶段 ----------
FROM alpine:3.20

WORKDIR /app

# 安装 ffmpeg
RUN apk add --no-cache ffmpeg

# 拷贝构建产物
COPY --from=builder /app/1qfm /app/1qfm

# 启动程序
CMD ["/app/1qfm"]
