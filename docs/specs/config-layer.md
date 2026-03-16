# Config Layer

> 책임: 타입된 설정 객체를 빌드하고 환경변수를 resolution한다.
> SRP: 설정 로딩과 검증만 담당. 설정 사용은 각 컴포넌트 책임.

---

## 설정 소스 우선순위

높은 우선순위가 낮은 우선순위를 덮어쓴다.

```
1. CLI args          (최우선)
2. 환경변수           (두 번째)
3. WORKFLOW.md front matter  (기본값)
```

**예시:** `--port 9090` CLI 인자가 있으면 `WORKFLOW.md`의 `server.port`와 `SERVER_PORT` 환경변수를 무시한다.

---

## 환경변수 참조 (`$VAR` 패턴)

`WORKFLOW.md` front matter 내에서 `$VAR_NAME` 형식으로 환경변수를 참조한다.
Config Layer는 설정 로딩 시점에 이를 실제 값으로 치환한다.

```yaml
tracker:
  apiKey: $LINEAR_API_KEY      # → process.env.LINEAR_API_KEY 값으로 치환
  teamId: $LINEAR_TEAM_ID
workspace:
  rootPath: $WORKSPACE_ROOT
```

- `$VAR`가 설정되지 않은 경우: 에러로 처리 (빈 문자열이 아님).
- 중첩 참조 (`$$VAR`) 지원하지 않음.
- 환경변수 목록은 `.env.example` 참조.

---

## 타입된 설정 스키마

```
Config {
  tracker: {
    url    : string   // Linear GraphQL 엔드포인트
    apiKey : string   // Linear Personal API key ($LINEAR_API_KEY)
    teamId : string   // Linear 팀 식별자 ($LINEAR_TEAM_ID)
    teamUuid: string  // Linear 팀 UUID ($LINEAR_TEAM_UUID) — 상태 조회용
  }
  workspace: {
    rootPath      : string   // 워크스페이스 루트 절대 경로 ($WORKSPACE_ROOT)
    keyPattern    : string   // key 파생 허용 문자 패턴 (기본: "[A-Za-z0-9._-]")
    retentionDays : number   // 완료/실패 workspace 보관 일수 (WORKFLOW.md: cleanup_after_days, 기본: 7)
  }
  agent: {
    command     : string   // 에이전트 실행 명령 (예: "codex serve")
    timeout     : number   // 초 단위. 초과 시 강제 종료
    retryPolicy : {
      maxAttempts : number   // 최대 재시도 횟수 (기본: 3)
      backoffSec  : number   // 재시도 간격 초 (기본: 60)
    }
  }
  concurrency: {
    maxParallel : number   // 동시 실행 가능한 최대 에이전트 수
  }
  server: {
    port : number   // HTTP status surface 포트 (선택적, 기본: 8080)
  }
  workflowStates: {
    inProgress : string   // Linear "In Progress" 상태 UUID ($LINEAR_WORKFLOW_STATE_IN_PROGRESS)
    done       : string   // Linear "Done" 상태 UUID ($LINEAR_WORKFLOW_STATE_DONE)
    cancelled  : string   // Linear "Cancelled" 상태 UUID ($LINEAR_WORKFLOW_STATE_CANCELLED)
  }
}
```

---

## 필수 설정 항목

다음 항목이 없거나 빈 값이면 시작을 거부한다.

| 설정 키 | 환경변수 | 설명 |
|---|---|---|
| `tracker.apiKey` | `LINEAR_API_KEY` | Linear Personal API key |
| `tracker.teamId` | `LINEAR_TEAM_ID` | Linear 팀 식별자 |
| `tracker.teamUuid` | `LINEAR_TEAM_UUID` | Linear 팀 UUID |
| `workspace.rootPath` | `WORKSPACE_ROOT` | 워크스페이스 루트 절대 경로 |
| `workflowStates.inProgress` | `LINEAR_WORKFLOW_STATE_IN_PROGRESS` | "In Progress" 상태 UUID |
| `workflowStates.done` | `LINEAR_WORKFLOW_STATE_DONE` | "Done" 상태 UUID |
| `workflowStates.cancelled` | `LINEAR_WORKFLOW_STATE_CANCELLED` | "Cancelled" 상태 UUID |

---

## 타입 검증

시작 시 전체 설정을 한 번에 검증한다. 부분 실패도 시작을 거부한다.

**검증 항목:**
- 필수 키 존재 여부
- 타입 일치 (string/number)
- 범위 검사: `concurrency.maxParallel` ≥ 1, `agent.timeout` ≥ 30
- `workspace.rootPath` 디렉터리 존재 여부
- URL 형식 검사: `tracker.url`

**에러 메시지 형식 (검증 실패 시):**

```
Config validation failed. Fix the following issues and restart:

  [1] tracker.apiKey: missing (set LINEAR_API_KEY in .env)
  [2] agent.timeout: must be >= 30, got 10
  [3] workspace.rootPath: directory does not exist: /var/workspaces
      → Create it: mkdir -p /var/workspaces

Symphony cannot start until all config errors are resolved.
```

---

## 환경변수 전체 목록

`.env.example` 참조. 주요 항목:

| 환경변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `LINEAR_API_KEY` | Y | — | Linear Personal API key |
| `LINEAR_TEAM_ID` | Y | — | Linear 팀 식별자 (예: `ACR`) |
| `LINEAR_TEAM_UUID` | Y | — | Linear 팀 UUID |
| `LINEAR_WORKFLOW_STATE_IN_PROGRESS` | Y | — | "In Progress" 상태 UUID |
| `LINEAR_WORKFLOW_STATE_DONE` | Y | — | "Done" 상태 UUID |
| `LINEAR_WORKFLOW_STATE_CANCELLED` | Y | — | "Cancelled" 상태 UUID |
| `WORKSPACE_ROOT` | Y | — | 워크스페이스 루트 절대 경로 |
| `LOG_LEVEL` | N | `info` | 로그 레벨 (`debug`/`info`/`warn`/`error`) |
| `LOG_FORMAT` | N | `text` | 로그 형식 (`text`/`json`) |
| `OTEL_ENDPOINT` | N | — | OpenTelemetry 수집 엔드포인트 |
