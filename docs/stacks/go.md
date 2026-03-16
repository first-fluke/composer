# Go 착수 가이드

> 이 파일은 Go 스택으로 Symphony 구현을 시작할 때 참조한다.
> 계층 원칙은 `docs/architecture/LAYERS.md`, 금지 규칙은 `docs/architecture/CONSTRAINTS.md` 참조.

---

## 권장 스택

| 역할 | 선택 |
|---|---|
| 언어 | Go 1.22+ |
| HTTP 서버 | Echo v4 |
| SQL 쿼리 | sqlx |
| DB 마이그레이션 | golang-migrate |
| 테스트 | testify |
| 환경변수 | godotenv |
| 아키텍처/코드 린터 | golangci-lint |

---

## 프로젝트 초기화

```bash
# 1. 프로젝트 디렉터리 생성
mkdir my-symphony && cd my-symphony

# 2. Go 모듈 초기화
go mod init github.com/your-org/my-symphony

# 3. 핵심 의존성 추가
go get github.com/labstack/echo/v4
go get github.com/jmoiron/sqlx
go get github.com/golang-migrate/migrate/v4
go get github.com/joho/godotenv

# 4. 테스트 의존성
go get github.com/stretchr/testify

# 5. golangci-lint 설치
brew install golangci-lint
# 또는
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
  | sh -s -- -b $(go env GOPATH)/bin v1.57.2
```

---

## 디렉터리 구조

`docs/architecture/LAYERS.md`에 정의된 계층을 Go 표준 레이아웃과 함께 반영한다.

```
my-symphony/
├── cmd/
│   └── server/
│       └── main.go           ← 진입점: DI 조립 + 서버 시작
├── internal/
│   ├── domain/
│   │   ├── issue.go          ← Issue 도메인 모델 (순수 구조체)
│   │   ├── workspace.go      ← Workspace 도메인 모델
│   │   ├── run_attempt.go    ← RunAttempt 도메인 모델
│   │   └── ports/
│   │       ├── issue_tracker.go  ← interface 정의 (Infrastructure가 구현)
│   │       └── workspace.go
│   ├── application/
│   │   ├── orchestrator/
│   │   │   ├── poller.go
│   │   │   ├── state_machine.go
│   │   │   ├── retry_queue.go
│   │   │   └── orchestrator.go
│   │   └── workspace_manager.go
│   ├── infrastructure/
│   │   ├── linear/
│   │   │   └── client.go     ← IssueTracker interface 구현
│   │   ├── filesystem/
│   │   │   └── workspace.go
│   │   ├── git/
│   │   │   └── git.go
│   │   └── logger/
│   │       └── logger.go
│   └── presentation/
│       ├── handler/
│       │   └── issue.go
│       └── router.go
├── .golangci.yml
├── Makefile
├── go.mod
└── go.sum
```

`internal/`을 사용하면 Go 컴파일러가 외부 패키지에서의 import를 차단하므로 계층 경계 강제에 유리하다.

---

## 환경변수 로딩 — godotenv

```go
// cmd/server/main.go
package main

import (
    "fmt"
    "log"
    "os"

    "github.com/joho/godotenv"
)

type Config struct {
    LinearAPIKey                    string
    LinearTeamID                    string
    LinearWorkflowStateInProgress   string
    LinearWorkflowStateDone         string
    LinearWorkflowStateCancelled    string
    WorkspaceRoot                   string
    LogLevel                        string
}

func loadConfig() (*Config, error) {
    // .env 파일 로드 (존재하지 않아도 환경변수로 동작)
    _ = godotenv.Load()

    required := []struct {
        key  string
        hint string
    }{
        {"LINEAR_API_KEY", "Add it to .env. Format: LINEAR_API_KEY=lin_api_xxxxxxxx"},
        {"LINEAR_TEAM_ID", "Find it in Linear: Settings → Members → Team"},
        {"LINEAR_WORKFLOW_STATE_IN_PROGRESS", "Find it in Linear: Settings → Workflow"},
        {"LINEAR_WORKFLOW_STATE_DONE", "Find it in Linear: Settings → Workflow"},
        {"LINEAR_WORKFLOW_STATE_CANCELLED", "Find it in Linear: Settings → Workflow"},
        {"WORKSPACE_ROOT", "Must be an absolute path. Example: WORKSPACE_ROOT=/home/user/workspaces"},
    }

    var missing []string
    for _, r := range required {
        if os.Getenv(r.key) == "" {
            missing = append(missing, fmt.Sprintf("  %s: %s", r.key, r.hint))
        }
    }

    if len(missing) > 0 {
        return nil, fmt.Errorf(
            "configuration error — missing environment variables:\n%s\n\n"+
                "Copy .env.example to .env and fill in the values.",
            joinLines(missing),
        )
    }

    workspaceRoot := os.Getenv("WORKSPACE_ROOT")
    if !isAbsolutePath(workspaceRoot) {
        return nil, fmt.Errorf(
            "WORKSPACE_ROOT must be an absolute path.\n"+
                "  Current value: %q\n"+
                "  Fix: Set WORKSPACE_ROOT=/absolute/path in .env",
            workspaceRoot,
        )
    }

    return &Config{
        LinearAPIKey:                  os.Getenv("LINEAR_API_KEY"),
        LinearTeamID:                  os.Getenv("LINEAR_TEAM_ID"),
        LinearWorkflowStateInProgress: os.Getenv("LINEAR_WORKFLOW_STATE_IN_PROGRESS"),
        LinearWorkflowStateDone:       os.Getenv("LINEAR_WORKFLOW_STATE_DONE"),
        LinearWorkflowStateCancelled:  os.Getenv("LINEAR_WORKFLOW_STATE_CANCELLED"),
        WorkspaceRoot:                 workspaceRoot,
        LogLevel:                      getEnvOrDefault("LOG_LEVEL", "info"),
    }, nil
}

func getEnvOrDefault(key, defaultVal string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return defaultVal
}

func isAbsolutePath(p string) bool {
    return len(p) > 0 && p[0] == '/'
}

func joinLines(lines []string) string {
    result := ""
    for _, l := range lines {
        result += l + "\n"
    }
    return result
}

func main() {
    cfg, err := loadConfig()
    if err != nil {
        log.Fatalf("Startup failed:\n%v", err)
    }
    _ = cfg
    // ... 서버 시작
}
```

---

## 린터 실행

```bash
# 표준 정적 분석
go vet ./...

# 통합 린터
golangci-lint run ./...

# 도달 불가능한 코드 검출
deadcode -test ./...
```

---

## Makefile

```makefile
.PHONY: build run test vet lint deadcode validate

build:
	go build -o bin/server ./cmd/server

run:
	go run ./cmd/server

test:
	go test -race ./...

vet:
	go vet ./...

lint:
	golangci-lint run ./...

deadcode:
	deadcode -test ./...

validate: vet lint
	@echo "Architecture check passed."
```

로컬에서는 `make validate`, CI에서는 `scripts/harness/validate.sh`에서 `make validate`를 호출한다.

---

## 아키텍처 린터 연동

`docs/architecture/enforcement/go.md` 참조하여 `.golangci.yml`을 설정한다.
