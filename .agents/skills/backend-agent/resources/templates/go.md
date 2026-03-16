# API Endpoint Template — Go (Echo + sqlx)

전체 CRUD 구현 예시. Handler → Service → Repository → Model 4레이어 구조.

---

## 레이어 구조

```
internal/resource/
├── model.go        ← DB 모델 (sqlx 태그)
├── dto.go          ← Request/Response DTO (json 태그), Page 타입
├── repository.go   ← IRepository interface + sqlx 구현체
├── service.go      ← 비즈니스 로직 (IRepository만 안다)
├── handler.go      ← HTTP 처리 (Service만 안다, echo 전용)
└── routes.go       ← 라우트 등록
```

---

## model.go

DB 모델은 DB 태그만 갖는다. json 태그 섞지 않는다.

```go
package resource

import (
    "time"
    "github.com/google/uuid"
)

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

## dto.go

Request/Response DTO는 API 계약 전용. DB 모델과 분리.

```go
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

// Response DTO — deletedAt 등 내부 필드 노출 안 함
type Response struct {
    ID          uuid.UUID `json:"id"`
    Title       string    `json:"title"`
    Description *string   `json:"description,omitempty"`
    UserID      uuid.UUID `json:"userId"`
    CreatedAt   time.Time `json:"createdAt"`
}

type Page[T any] struct {
    Items []T `json:"items"`
    Total int `json:"total"`
    Page  int `json:"page"`
    Size  int `json:"size"`
}

func toResponse(r *Resource) *Response {
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

## repository.go

IRepository interface로 추상화 → Service가 구현체(sqlx)에 의존하지 않는다. 테스트 시 mock 교체 가능.

```go
package resource

import (
    "context"
    "time"

    "github.com/google/uuid"
    "github.com/jmoiron/sqlx"
)

// Service가 의존하는 interface
type IRepository interface {
    GetByID(ctx context.Context, id uuid.UUID) (*Resource, error)
    ListByOwner(ctx context.Context, userID uuid.UUID, page, size int, search string) ([]Resource, int, error)
    Create(ctx context.Context, userID uuid.UUID, req CreateRequest) (*Resource, error)
    Update(ctx context.Context, id uuid.UUID, req UpdateRequest) (*Resource, error)
    SoftDelete(ctx context.Context, id uuid.UUID, at time.Time) error
    HardDelete(ctx context.Context, id uuid.UUID) error
}

// sqlx 구현체
type Repository struct {
    db *sqlx.DB
}

func NewRepository(db *sqlx.DB) IRepository {
    return &Repository{db: db}
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Resource, error) {
    var res Resource
    err := r.db.GetContext(ctx, &res,
        `SELECT * FROM resources WHERE id = $1 AND deleted_at IS NULL`, id)
    if err != nil {
        return nil, err
    }
    return &res, nil
}

func (r *Repository) ListByOwner(ctx context.Context, userID uuid.UUID, page, size int, search string) ([]Resource, int, error) {
    offset := (page - 1) * size
    var total int
    if err := r.db.GetContext(ctx, &total,
        `SELECT count(*) FROM resources WHERE user_id = $1 AND deleted_at IS NULL`, userID); err != nil {
        return nil, 0, err
    }
    var items []Resource
    q := `SELECT * FROM resources WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2 OFFSET $3`
    if err := r.db.SelectContext(ctx, &items, q, userID, size, offset); err != nil {
        return nil, 0, err
    }
    return items, total, nil
}

func (r *Repository) Create(ctx context.Context, userID uuid.UUID, req CreateRequest) (*Resource, error) {
    res := &Resource{ID: uuid.New(), Title: req.Title, Description: req.Description, UserID: userID}
    _, err := r.db.NamedExecContext(ctx,
        `INSERT INTO resources (id, title, description, user_id) VALUES (:id, :title, :description, :user_id)`, res)
    return res, err
}

func (r *Repository) Update(ctx context.Context, id uuid.UUID, req UpdateRequest) (*Resource, error) {
    if req.Title != nil {
        _, err := r.db.ExecContext(ctx, `UPDATE resources SET title = $1 WHERE id = $2`, *req.Title, id)
        if err != nil { return nil, err }
    }
    return r.GetByID(ctx, id)
}

func (r *Repository) SoftDelete(ctx context.Context, id uuid.UUID, at time.Time) error {
    _, err := r.db.ExecContext(ctx, `UPDATE resources SET deleted_at = $1 WHERE id = $2`, at, id)
    return err
}

func (r *Repository) HardDelete(ctx context.Context, id uuid.UUID) error {
    _, err := r.db.ExecContext(ctx, `DELETE FROM resources WHERE id = $1`, id)
    return err
}
```

---

## service.go

Service는 IRepository interface만 의존한다. HTTP(echo) 개념 없음.

```go
package resource

import (
    "context"
    "time"

    "github.com/google/uuid"
    "github.com/yourapp/internal/apperr"
)

type Service struct {
    repo IRepository // interface 의존 — 구현체 교체 가능
}

func NewService(repo IRepository) *Service {
    return &Service{repo: repo}
}

// 소유권 검증 포함 조회. 없으면 NotFound, 타인 소유면 Forbidden.
func (s *Service) GetOwned(ctx context.Context, id, userID string) (*Response, error) {
    rid, err := uuid.Parse(id)
    if err != nil {
        return nil, apperr.BadRequest("invalid resource id")
    }
    r, err := s.repo.GetByID(ctx, rid)
    if err != nil || r == nil {
        return nil, apperr.NotFound("resource not found")
    }
    if r.UserID.String() != userID {
        return nil, apperr.Forbidden("access denied")
    }
    return toResponse(r), nil
}

func (s *Service) List(ctx context.Context, userID string, page, size int, search string) (*Page[Response], error) {
    uid, err := uuid.Parse(userID)
    if err != nil {
        return nil, apperr.BadRequest("invalid user id")
    }
    items, total, err := s.repo.ListByOwner(ctx, uid, page, size, search)
    if err != nil {
        return nil, err
    }
    responses := make([]Response, len(items))
    for i, item := range items {
        responses[i] = *toResponse(&item)
    }
    return &Page[Response]{Items: responses, Total: total, Page: page, Size: size}, nil
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
    return toResponse(r), nil
}

func (s *Service) Update(ctx context.Context, id, userID string, req UpdateRequest) (*Response, error) {
    existing, err := s.GetOwned(ctx, id, userID) // ownership 검증
    if err != nil {
        return nil, err
    }
    rid, _ := uuid.Parse(existing.ID.String())
    r, err := s.repo.Update(ctx, rid, req)
    if err != nil {
        return nil, err
    }
    return toResponse(r), nil
}

func (s *Service) Delete(ctx context.Context, id, userID string, hard bool) error {
    existing, err := s.GetOwned(ctx, id, userID) // ownership 검증
    if err != nil {
        return err
    }
    rid, _ := uuid.Parse(existing.ID.String())
    if hard {
        return s.repo.HardDelete(ctx, rid)
    }
    return s.repo.SoftDelete(ctx, rid, time.Now())
}
```

---

## handler.go

Handler는 HTTP만 담당한다. Service에 순수 데이터만 전달. echo.Context는 Handler 밖으로 나가지 않는다.

```go
package resource

import (
    "net/http"
    "strconv"

    "github.com/labstack/echo/v4"
    "github.com/yourapp/internal/auth"
)

type Handler struct {
    svc *Service
}

func NewHandler(svc *Service) *Handler {
    return &Handler{svc: svc}
}

func (h *Handler) List(c echo.Context) error {
    page, _ := strconv.Atoi(c.QueryParam("page"))
    if page < 1 { page = 1 }
    size, _ := strconv.Atoi(c.QueryParam("size"))
    if size < 1 || size > 100 { size = 20 }

    result, err := h.svc.List(c.Request().Context(), auth.UserIDFrom(c), page, size, c.QueryParam("search"))
    if err != nil { return err }
    return c.JSON(http.StatusOK, result)
}

func (h *Handler) GetByID(c echo.Context) error {
    resource, err := h.svc.GetOwned(c.Request().Context(), c.Param("id"), auth.UserIDFrom(c))
    if err != nil { return err }
    return c.JSON(http.StatusOK, resource)
}

func (h *Handler) Create(c echo.Context) error {
    var req CreateRequest
    if err := c.Bind(&req); err != nil { return echo.ErrBadRequest }
    if err := c.Validate(&req); err != nil { return err }

    // Handler → Service: HTTP 개념(echo.Context) 전달 금지, 순수 데이터만
    resource, err := h.svc.Create(c.Request().Context(), auth.UserIDFrom(c), req)
    if err != nil { return err }
    return c.JSON(http.StatusCreated, resource)
}

func (h *Handler) Update(c echo.Context) error {
    var req UpdateRequest
    if err := c.Bind(&req); err != nil { return echo.ErrBadRequest }
    if err := c.Validate(&req); err != nil { return err }

    resource, err := h.svc.Update(c.Request().Context(), c.Param("id"), auth.UserIDFrom(c), req)
    if err != nil { return err }
    return c.JSON(http.StatusOK, resource)
}

func (h *Handler) Delete(c echo.Context) error {
    hard := c.QueryParam("hard") == "true"
    if err := h.svc.Delete(c.Request().Context(), c.Param("id"), auth.UserIDFrom(c), hard); err != nil {
        return err
    }
    return c.NoContent(http.StatusNoContent)
}
```

---

## routes.go

```go
package resource

import (
    "github.com/labstack/echo/v4"
    "github.com/yourapp/internal/auth"
)

func RegisterRoutes(e *echo.Echo, h *Handler) {
    g := e.Group("/api/resources", auth.Middleware())
    g.GET("", h.List)
    g.GET("/:id", h.GetByID)
    g.POST("", h.Create)
    g.PATCH("/:id", h.Update)
    g.DELETE("/:id", h.Delete)
}
```

---

## 조립 (main.go / wire.go)

```go
db := sqlx.MustConnect("postgres", os.Getenv("DATABASE_URL"))

repo := resource.NewRepository(db)    // IRepository 반환
svc  := resource.NewService(repo)
h    := resource.NewHandler(svc)

resource.RegisterRoutes(e, h)
```

---

## 단위 테스트 (Service — Repository mock)

```go
// internal/resource/service_test.go
package resource_test

import (
    "context"
    "testing"

    "github.com/google/uuid"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

// IRepository mock 구현
type mockRepo struct{ mock.Mock }

func (m *mockRepo) GetByID(ctx context.Context, id uuid.UUID) (*Resource, error) {
    args := m.Called(ctx, id)
    if args.Get(0) == nil { return nil, args.Error(1) }
    return args.Get(0).(*Resource), args.Error(1)
}
func (m *mockRepo) ListByOwner(ctx context.Context, userID uuid.UUID, page, size int, search string) ([]Resource, int, error) {
    args := m.Called(ctx, userID, page, size, search)
    return args.Get(0).([]Resource), args.Int(1), args.Error(2)
}
func (m *mockRepo) Create(ctx context.Context, userID uuid.UUID, req CreateRequest) (*Resource, error) {
    args := m.Called(ctx, userID, req)
    return args.Get(0).(*Resource), args.Error(1)
}
func (m *mockRepo) Update(ctx context.Context, id uuid.UUID, req UpdateRequest) (*Resource, error) {
    args := m.Called(ctx, id, req)
    return args.Get(0).(*Resource), args.Error(1)
}
func (m *mockRepo) SoftDelete(ctx context.Context, id uuid.UUID, at time.Time) error {
    return m.Called(ctx, id, at).Error(0)
}
func (m *mockRepo) HardDelete(ctx context.Context, id uuid.UUID) error {
    return m.Called(ctx, id).Error(0)
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
    r := &Resource{ID: uuid.New(), UserID: ownerID}
    repo := &mockRepo{}
    repo.On("GetByID", mock.Anything, mock.Anything).Return(r, nil)
    svc := NewService(repo)

    _, err := svc.GetOwned(context.Background(), r.ID.String(), uuid.NewString())
    assert.Error(t, err) // apperr.Forbidden
}

func TestCreate_DelegatestoRepo(t *testing.T) {
    uid := uuid.New()
    req := CreateRequest{Title: "Test"}
    expected := &Resource{ID: uuid.New(), UserID: uid, Title: "Test"}

    repo := &mockRepo{}
    repo.On("Create", mock.Anything, uid, req).Return(expected, nil)
    svc := NewService(repo)

    resp, err := svc.Create(context.Background(), uid.String(), req)
    assert.NoError(t, err)
    assert.Equal(t, "Test", resp.Title)
}
```
