# Backend Snippets — Go (Echo + sqlx + golang-migrate)

Copy-paste ready patterns. Each snippet shows its correct architectural layer.

---

## Route with Auth

Handler는 HTTP만 담당한다. Service는 HTTP(echo.Context)를 모른다.

```go
// internal/resource/handler.go — HTTP layer만 담당
package resource

import (
    "net/http"

    "github.com/labstack/echo/v4"
    "github.com/yourapp/internal/auth"
)

type Handler struct {
    svc *Service
}

func NewHandler(svc *Service) *Handler {
    return &Handler{svc: svc}
}

func RegisterRoutes(e *echo.Echo, h *Handler) {
    g := e.Group("/api/resources", auth.Middleware())
    g.POST("", h.Create)
    g.GET("/:id", h.GetByID)
    g.PATCH("/:id", h.Update)
    g.DELETE("/:id", h.Delete)
}

func (h *Handler) Create(c echo.Context) error {
    var req CreateRequest
    if err := c.Bind(&req); err != nil {
        return echo.ErrBadRequest
    }
    if err := c.Validate(&req); err != nil {
        return err
    }
    // Handler → Service: HTTP 개념(echo.Context) 전달 금지, 순수 데이터만 전달
    resource, err := h.svc.Create(c.Request().Context(), auth.UserIDFrom(c), req)
    if err != nil {
        return err
    }
    return c.JSON(http.StatusCreated, resource)
}

func (h *Handler) GetByID(c echo.Context) error {
    // ownership 체크는 Service 책임
    resource, err := h.svc.GetOwned(c.Request().Context(), c.Param("id"), auth.UserIDFrom(c))
    if err != nil {
        return err
    }
    return c.JSON(http.StatusOK, resource)
}
```

---

## Request/Response Schema

```go
// internal/resource/dto.go
package resource

import (
    "time"
    "github.com/google/uuid"
)

// Request DTOs
type CreateRequest struct {
    Title       string  `json:"title"       validate:"required,min=1,max=200"`
    Description *string `json:"description"`
}

type UpdateRequest struct {
    Title       *string `json:"title"       validate:"omitempty,min=1,max=200"`
    Description *string `json:"description"`
}

// Response DTO — DB model(Resource)과 분리. API 계약 전용.
type Response struct {
    ID          uuid.UUID  `json:"id"`
    Title       string     `json:"title"`
    Description *string    `json:"description,omitempty"`
    UserID      uuid.UUID  `json:"userId"`
    CreatedAt   time.Time  `json:"createdAt"`
}

func ToResponse(r *Resource) *Response {
    return &Response{
        ID:          r.ID,
        Title:       r.Title,
        Description: r.Description,
        UserID:      r.UserID,
        CreatedAt:   r.CreatedAt,
    }
}
```

---

## DB Model

```go
// internal/resource/model.go
package resource

import (
    "time"
    "github.com/google/uuid"
)

// DB 모델 — ORM/sqlx 태그만 포함. HTTP(json 태그) 섞지 않는다.
type Resource struct {
    ID          uuid.UUID  `db:"id"`
    Title       string     `db:"title"`
    Description *string    `db:"description"`
    UserID      uuid.UUID  `db:"user_id"`
    CreatedAt   time.Time  `db:"created_at"`
    DeletedAt   *time.Time `db:"deleted_at"`
}
```

---

## Repository (Data Access Layer)

Repository는 SQL만 안다. 비즈니스 규칙 없음.

```go
// internal/resource/repository.go
package resource

import (
    "context"
    "time"

    "github.com/google/uuid"
    "github.com/jmoiron/sqlx"
)

type Repository struct {
    db *sqlx.DB
}

func NewRepository(db *sqlx.DB) *Repository {
    return &Repository{db: db}
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Resource, error) {
    var resource Resource
    err := r.db.GetContext(ctx, &resource,
        `SELECT * FROM resources WHERE id = $1 AND deleted_at IS NULL`, id)
    if err != nil {
        return nil, err
    }
    return &resource, nil
}

func (r *Repository) ListByOwner(ctx context.Context, userID uuid.UUID, page, size int, search string) ([]Resource, int, error) {
    offset := (page - 1) * size
    var total int
    if err := r.db.GetContext(ctx, &total,
        `SELECT count(*) FROM resources WHERE user_id = $1 AND deleted_at IS NULL`, userID); err != nil {
        return nil, 0, err
    }
    var items []Resource
    q := `SELECT * FROM resources WHERE user_id = $1 AND deleted_at IS NULL`
    args := []any{userID, size, offset}
    if search != "" {
        q += ` AND title ILIKE $4`
        args = append(args, "%"+search+"%")
    }
    q += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`
    if err := r.db.SelectContext(ctx, &items, q, args...); err != nil {
        return nil, 0, err
    }
    return items, total, nil
}

func (r *Repository) Create(ctx context.Context, userID uuid.UUID, req CreateRequest) (*Resource, error) {
    resource := &Resource{
        ID:          uuid.New(),
        Title:       req.Title,
        Description: req.Description,
        UserID:      userID,
    }
    _, err := r.db.NamedExecContext(ctx,
        `INSERT INTO resources (id, title, description, user_id) VALUES (:id, :title, :description, :user_id)`,
        resource)
    return resource, err
}

func (r *Repository) SoftDelete(ctx context.Context, id uuid.UUID, at time.Time) error {
    _, err := r.db.ExecContext(ctx,
        `UPDATE resources SET deleted_at = $1 WHERE id = $2`, at, id)
    return err
}
```

---

## Service (Business Logic Layer)

Service는 Repository를 통해서만 DB에 접근한다. HTTP(echo) 개념 없음.

```go
// internal/resource/service.go
package resource

import (
    "context"
    "time"

    "github.com/google/uuid"
    "github.com/yourapp/internal/apperr"
)

type Service struct {
    repo *Repository
}

func NewService(repo *Repository) *Service {
    return &Service{repo: repo}
}

func (s *Service) GetOwned(ctx context.Context, id string, userID string) (*Response, error) {
    rid, err := uuid.Parse(id)
    if err != nil {
        return nil, apperr.BadRequest("invalid id")
    }
    r, err := s.repo.GetByID(ctx, rid)
    if err != nil || r == nil {
        return nil, apperr.NotFound("resource not found")
    }
    if r.UserID.String() != userID {
        return nil, apperr.Forbidden("access denied")
    }
    return ToResponse(r), nil
}

func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (*Response, error) {
    uid, err := uuid.Parse(userID)
    if err != nil {
        return nil, apperr.BadRequest("invalid user id")
    }
    r, err := s.repo.Create(ctx, uid, req)
    if err != nil {
        return nil, err
    }
    return ToResponse(r), nil
}

func (s *Service) Delete(ctx context.Context, id string, userID string) error {
    // ownership 검증 후 삭제
    if _, err := s.GetOwned(ctx, id, userID); err != nil {
        return err
    }
    rid, _ := uuid.Parse(id)
    return s.repo.SoftDelete(ctx, rid, time.Now())
}
```

---

## JWT Auth Middleware

```go
// internal/auth/middleware.go
package auth

import (
    "strings"

    "github.com/golang-jwt/jwt/v5"
    "github.com/labstack/echo/v4"
)

const userIDKey = "user_id"

func Middleware() echo.MiddlewareFunc {
    return func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c echo.Context) error {
            header := c.Request().Header.Get("Authorization")
            token := strings.TrimPrefix(header, "Bearer ")
            if token == "" {
                return echo.ErrUnauthorized
            }
            claims, err := validateToken(token)
            if err != nil {
                return echo.ErrUnauthorized
            }
            c.Set(userIDKey, claims.Subject)
            return next(c)
        }
    }
}

func UserIDFrom(c echo.Context) string {
    return c.Get(userIDKey).(string)
}
```

---

## Password Hashing

```go
// internal/auth/password.go
package auth

import "golang.org/x/crypto/bcrypt"

const saltCost = 12

func HashPassword(password string) (string, error) {
    hash, err := bcrypt.GenerateFromPassword([]byte(password), saltCost)
    return string(hash), err
}

func VerifyPassword(plain, hashed string) bool {
    return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(plain)) == nil
}
```

---

## Paginated Query (Repository에서 사용)

```go
// internal/core/pagination.go
package core

type Page[T any] struct {
    Items []T `json:"items"`
    Total int `json:"total"`
    Page  int `json:"page"`
    Size  int `json:"size"`
}
```

---

## Migration (golang-migrate)

```sql
-- migrations/000001_create_resources.up.sql
CREATE TABLE resources (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    user_id     UUID        NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_resources_user_id ON resources(user_id);

-- migrations/000001_create_resources.down.sql
DROP TABLE resources;
```

```bash
migrate -path ./migrations -database "$DATABASE_URL" up
migrate -path ./migrations -database "$DATABASE_URL" down 1
```

---

## Test

Service는 Repository mock으로 단위 테스트. Handler는 통합 테스트.

```go
// internal/resource/service_test.go
package resource_test

import (
    "context"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
    "github.com/google/uuid"
)

type mockRepo struct{ mock.Mock }

func (m *mockRepo) GetByID(ctx context.Context, id uuid.UUID) (*Resource, error) {
    args := m.Called(ctx, id)
    if args.Get(0) == nil { return nil, args.Error(1) }
    return args.Get(0).(*Resource), args.Error(1)
}

func TestGetOwned_NotFound(t *testing.T) {
    repo := &mockRepo{}
    repo.On("GetByID", mock.Anything, mock.Anything).Return(nil, nil)
    svc := NewService(repo)

    _, err := svc.GetOwned(context.Background(), uuid.NewString(), uuid.NewString())
    assert.Error(t, err) // apperr.NotFound
}

func TestGetOwned_Forbidden(t *testing.T) {
    ownerID := uuid.New()
    resource := &Resource{ID: uuid.New(), UserID: ownerID}
    repo := &mockRepo{}
    repo.On("GetByID", mock.Anything, mock.Anything).Return(resource, nil)
    svc := NewService(repo)

    _, err := svc.GetOwned(context.Background(), resource.ID.String(), uuid.NewString())
    assert.Error(t, err) // apperr.Forbidden
}
```
