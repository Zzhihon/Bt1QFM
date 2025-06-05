FROM golang:1.23.3-alpine3.20 AS builder

LABEL maintainer="AptS:1547 <esaps@esaps.net>"

WORKDIR /app

COPY go.mod go.sum /app/

RUN go env -w GOPROXY=https://goproxy.cn,direct

ENV CGO_ENABLED=0
ENV GOOS=linux
ENV GOARCH=amd64

RUN go mod download

ADD . /app

RUN go build -ldflags="-s -w" -o 1qfm


FROM scratch


WORKDIR /app


COPY --from=builder /app/1qfm /app/1qfm
COPY --from=builder /app/.env /app/.env

CMD ["/app/1qfm"]