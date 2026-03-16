# Domain Models

> 모든 Symphony 컴포넌트가 공유하는 핵심 도메인 모델 정의.
> 다른 spec 파일은 이 파일을 참조하고, 모델을 재정의하지 않는다.

---

## Issue

Linear에서 조회한 이슈 데이터. 읽기 전용. Symphony는 이 값을 쓰지 않는다.

```
Issue {
  id          : string   // Linear UUID (예: "a1b2c3d4-...")
  identifier  : string   // 팀 기반 식별자 (예: "ACR-42")
  title       : string
  description : string   // 이슈 본문 — 신뢰 수준: 낮음 (프롬프트 인젝션 가능)
  status      : {
    id   : string        // Linear 상태 UUID
    name : string        // 표시 이름 (예: "In Progress")
    type : string        // "started" | "completed" | "cancelled" | "backlog" | "unstarted"
  }
  team        : {
    id  : string         // Linear 팀 UUID
    key : string         // 팀 식별자 (예: "ACR")
  }
  url         : string   // Linear 이슈 URL
}
```

**신뢰 수준:**
- `Issue.title`, `Issue.description` — 항상 의심. 진입점에서 검증 후 프롬프트에 삽입.
- `Issue.id`, `Issue.identifier`, `Issue.status`, `Issue.team` — Linear API 응답값. 내부에서 신뢰.

---

## Workspace

이슈별 격리 작업 공간. WorkspaceManager가 생성하고 소유한다.

```
Workspace {
  issueId   : string   // Issue.id 참조
  path      : string   // 절대 경로 (예: "/var/workspaces/ACR-42")
  key       : string   // 파생 키 (아래 규칙 참조)
  status    : "idle" | "running" | "done" | "failed"
  createdAt : ISO8601 string
}
```

**Workspace Key 파생 규칙:**

`Issue.identifier`에서 `[A-Za-z0-9._-]` 범위 밖의 모든 문자를 `_`로 대체한다.

| 입력 (identifier) | 출력 (key) |
|---|---|
| `ACR-42` | `ACR-42` |
| `ACR 42` | `ACR_42` |
| `ACR/42` | `ACR_42` |
| `ACR#42` | `ACR_42` |
| `ACR.42` | `ACR.42` |

디렉터리 경로: `{WORKSPACE_ROOT}/{workspace_key}/`

---

## RunAttempt

에이전트 실행 한 번의 기록. 시작부터 종료까지 추적한다.

```
RunAttempt {
  id             : string          // UUID v4
  issueId        : string          // Issue.id 참조
  workspacePath  : string          // 실행에 사용된 workspace 절대 경로
  startedAt      : ISO8601 string
  finishedAt     : ISO8601 string | null  // 실행 중이면 null
  exitCode       : number | null          // 완료 후 설정. 0 = 성공
  agentOutput    : string | null          // 에이전트 최종 출력 (stdout 요약)
}
```

---

## LiveSession

현재 실행 중인 에이전트 프로세스 추적. Orchestrator가 하트비트로 관리한다.

```
LiveSession {
  attemptId      : string          // RunAttempt.id 참조
  pid            : number          // OS 프로세스 ID
  startedAt      : ISO8601 string
  lastHeartbeat  : ISO8601 string  // 마지막 heartbeat 수신 시각
}
```

**용도:** 재시작 복구 시 고아 프로세스 감지. `lastHeartbeat`가 임계값 초과 시 세션을 무효로 처리한다.

---

## RetryEntry

실패한 이슈의 재시도 스케줄링 정보. Orchestrator 재시도 큐에서 사용한다.

```
RetryEntry {
  issueId      : string   // Issue.id 참조
  attemptCount : number   // 누적 시도 횟수
  nextRetryAt  : ISO8601 string  // 이 시각 이후에 재시도
  lastError    : string   // 마지막 실패 원인 요약
}
```

**재시도 정책:** `config-layer.md`의 `agent.retryPolicy` 설정을 따른다.

---

## OrchestratorRuntimeState

Orchestrator가 메모리에 단독으로 보유하는 런타임 상태.
**이 상태는 영속되지 않는다.** 재시작 시 Linear 재폴링으로 재구성한다.

```
OrchestratorRuntimeState {
  isRunning        : boolean
  activeWorkspaces : Map<issueId: string, Workspace>
  retryQueue       : RetryEntry[]
  lastPollAt       : ISO8601 string | null
}
```

**재시작 복구 전략:**
1. 재시작 시 `activeWorkspaces`와 `retryQueue`는 비어있는 상태로 초기화.
2. 첫 번째 폴링 사이클에서 Linear로부터 현재 `IN_PROGRESS` 이슈를 조회.
3. 조회된 이슈들을 기반으로 `activeWorkspaces`를 재구성.
4. 기존 `RunAttempt` 기록이 있으면 이어서 처리, 없으면 새 `RunAttempt` 생성.

---

## 모델 간 참조 관계

```
Issue (1) ──────── (N) Workspace
Issue (1) ──────── (N) RunAttempt
Issue (1) ──────── (0..1) RetryEntry
RunAttempt (1) ─── (0..1) LiveSession

OrchestratorRuntimeState
  └── activeWorkspaces: Map<issueId → Workspace>
  └── retryQueue: RetryEntry[]
```
