package auth

import (
	"fmt"
	"time"

	"Bt1QFM/logger"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var jwtSecret = []byte("your-secret-key") // 在生产环境中应该从配置文件读取

// HashPassword generates a bcrypt hash of the password.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(bytes), nil
}

// VerifyPassword compares a password with a bcrypt hash.
func VerifyPassword(password, hash string) bool {
	logger.Debug("[Auth] 开始密码验证",
		logger.Int("passwordLen", len(password)),
		logger.Int("hashLen", len(hash)))

	if len(hash) >= 10 {
		logger.Debug("[Auth] 密码哈希前10个字符", logger.String("hashPrefix", hash[:10]))
	}

	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	if err != nil {
		logger.Warn("[Auth] 密码验证失败", logger.ErrorField(err))
		return false
	}

	logger.Debug("[Auth] 密码验证成功")
	return true
}

// Claims represents the JWT claims
type Claims struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// GenerateToken generates a JWT token for the given user
func GenerateToken(userID int64, username string) (string, error) {
	claims := Claims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour * 7)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// ParseToken parses and validates a JWT token
func ParseToken(tokenString string) (*Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("token is empty")
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// 确保签名方法是我们期望的
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil {
		logger.Warn("[Auth] Token解析失败", logger.ErrorField(err))
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		// 检查token是否过期
		if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
			logger.Warn("[Auth] Token已过期")
			return nil, fmt.Errorf("token expired")
		}
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token claims")
}

// IsTokenExpired 检查token是否过期
func IsTokenExpired(err error) bool {
	return err != nil && (err.Error() == "token expired" ||
		jwt.ErrTokenExpired.Error() == err.Error())
}
