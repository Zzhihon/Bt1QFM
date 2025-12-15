package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"Bt1QFM/core/auth"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"
)

// LoginRequest represents the login request body
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// RegisterRequest represents the registration request body
type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
}

// LoginHandler handles user login requests
func (h *APIHandler) LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"` // 可以是用户名或邮箱
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		logger.Error("[Login] 解析请求体失败", logger.ErrorField(err))
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Password == "" {
		http.Error(w, "Username/Email and password are required", http.StatusBadRequest)
		return
	}

	// 查询用户 - 支持用户名或邮箱登录
	var user *model.User
	var err error
	if strings.Contains(req.Username, "@") {
		user, err = h.userRepo.GetUserByEmail(req.Username)
	} else {
		user, err = h.userRepo.GetUserByUsername(req.Username)
	}

	if err != nil {
		if err == sql.ErrNoRows {
			logger.Warn("[Login] 用户不存在", logger.String("username", req.Username))
			http.Error(w, "Invalid username/email or password", http.StatusUnauthorized)
		} else {
			logger.Error("[Login] 查询用户失败", logger.ErrorField(err))
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
		return
	}

	if user == nil {
		logger.Warn("[Login] 用户不存在", logger.String("username", req.Username))
		http.Error(w, "Invalid username/email or password", http.StatusUnauthorized)
		return
	}

	// 验证密码
	if !auth.VerifyPassword(req.Password, user.PasswordHash) {
		logger.Warn("[Login] 密码验证失败", logger.String("username", req.Username))
		http.Error(w, "Invalid username/email or password", http.StatusUnauthorized)
		return
	}

	// 生成JWT token
	token, err := auth.GenerateToken(user.ID, user.Username)
	if err != nil {
		logger.Error("[Login] 生成Token失败", logger.ErrorField(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// 构建响应
	response := struct {
		Token string     `json:"token"`
		User  model.User `json:"user"`
	}{
		Token: token,
		User: model.User{
			ID:        user.ID,
			Username:  user.Username,
			Email:     user.Email,
			CreatedAt: user.CreatedAt,
			UpdatedAt: user.UpdatedAt,
		},
	}

	if user.Phone.Valid {
		response.User.Phone = user.Phone
	}
	if user.Preferences.Valid {
		response.User.Preferences = user.Preferences
	}

	logger.Info("[Login] 登录成功", logger.String("username", user.Username))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// RegisterHandler handles user registration requests
func (h *APIHandler) RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Username == "" || req.Password == "" || req.Email == "" {
		http.Error(w, "Username, password and email are required", http.StatusBadRequest)
		return
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "Failed to process password", http.StatusInternalServerError)
		return
	}

	// Create user
	user := &model.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: hashedPassword,
	}

	// 只有当Phone字段不为空时才设置
	if req.Phone != "" {
		user.Phone = sql.NullString{
			String: req.Phone,
			Valid:  true,
		}
	}

	userID, err := h.userRepo.CreateUser(user)
	if err != nil {
		// 使用 errors.Is 检查是否是重复用户错误
		if errors.Is(err, repository.ErrDuplicateUser) {
			logger.Warn("[Register] 用户名或邮箱已存在",
				logger.String("username", req.Username),
				logger.String("email", req.Email))
			http.Error(w, "Username or email already exists", http.StatusConflict)
			return
		}
		logger.Error("[Register] 创建用户失败", logger.ErrorField(err))
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	// Generate JWT token
	token, err := auth.GenerateToken(userID, user.Username)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	// Return user info and token
	userResponse := map[string]interface{}{
		"id":       userID,
		"username": user.Username,
		"email":    user.Email,
	}

	// 只有当Phone字段有效时才添加到响应中
	if user.Phone.Valid {
		userResponse["phone"] = user.Phone.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user":  userResponse,
	})
}

// AuthMiddleware is a middleware function that checks for a valid JWT token
func (h *APIHandler) AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Get the Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header is required", http.StatusUnauthorized)
			return
		}

		// Check if the header has the correct format
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		// Parse and validate the token
		claims, err := auth.ParseToken(parts[1])
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		// Add user info to the request context
		ctx := context.WithValue(r.Context(), "userID", claims.UserID)
		ctx = context.WithValue(ctx, "username", claims.Username)

		// Call the next handler with the updated context
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// GetUserIDFromContext extracts the user ID from the request context
func GetUserIDFromContext(ctx context.Context) (int64, error) {
	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		return 0, fmt.Errorf("user ID not found in context")
	}
	return userID, nil
}

// GetUsernameFromContext extracts the username from the request context
func GetUsernameFromContext(ctx context.Context) (string, error) {
	username, ok := ctx.Value("username").(string)
	if !ok {
		return "", fmt.Errorf("username not found in context")
	}
	return username, nil
}
