# Orchestrator

> 책임: 폴링 루프 실행, 상태 머신 관리, 재시도 큐 처리.
> Symphony의 핵심 컴포넌트. 단일 권한 in-memory 상태 보유자.

도메인 모델: `domain-models.md` 참조 (Issue, Workspace, RunAttempt, RetryEntry, OrchestratorRuntimeState).

---

## 상태 보유

Orchestrator는 `OrchestratorRuntimeState`를 단독으로 보유한다.
다른 컴포넌트는 이 상태를 직접 변경하지 않는다. Orchestrator API를 통해서만 접근한다.

```
OrchestratorRuntimeState (단일 인스턴스, in-memory)
  isRunning        : boolean
  activeWorkspaces : Map<issueId, Workspace>
  retryQueue       : RetryEntry[]
  lastPollAt       : ISO8601 | null
```

---

## 폴링 루프 흐름

```
while isRunning:
  1. TrackerClient.fetchInProgressIssues()
     → 현재 IN_PROGRESS 이슈 목록

  2. 각 이슈에 대해:
     a. Workspace 존재 확인
        → 없으면 WorkspaceManager.create(issue)
     b. 이미 activeWorkspaces에 있으면 skip (중복 실행 방지)

  3. 동시 실행 한도 확인
     → activeWorkspaces.size >= config.concurrency.maxParallel 이면 대기

  4. 재시도 큐 처리
     → retryQueue에서 nextRetryAt <= now인 항목 꺼내기
     → 해당 이슈 재시도 대상 추가

  5. 실행 가능한 이슈에 대해 AgentRunner.spawn(issue, workspace)
     → 새 RunAttempt 생성
     → activeWorkspaces에 추가

  6. 완료된 RunAttempt 처리 (비동기 감시)
     → exitCode == 0: Workspace.status = "done", activeWorkspaces에서 제거
     → exitCode != 0: 재시도 큐에 RetryEntry 추가

  7. config.pollIntervalSec 대기 후 반복
```

---

## 재시작 복구

재시작 시 in-memory 상태는 초기화된다. Linear 재폴링으로 상태를 복원한다.

```
1. Orchestrator 초기화: activeWorkspaces = {}, retryQueue = []
2. 첫 번째 폴링: Linear에서 IN_PROGRESS 이슈 전체 조회
3. 각 이슈에 대해 WorkspaceManager로 기존 workspace 확인
   → 존재하면 재사용, 없으면 새로 생성
4. 이전 RunAttempt가 있고 LiveSession이 없으면:
   → 프로세스가 종료된 것으로 판단 → 재시도 큐 등록
5. 정상 폴링 루프 시작
```

**고아 프로세스 처리:** LiveSession.lastHeartbeat가 `2 * agent.timeout`을 초과하면 고아로 판정. OS 프로세스 종료 후 재시도 큐 등록.

---

## 재시도 큐

```
실패 시:
  RetryEntry {
    issueId      = issue.id
    attemptCount = 이전 시도 횟수 + 1
    nextRetryAt  = now + (backoffSec * 2^(attemptCount-1))  // exponential backoff
    lastError    = runner exit code + 마지막 에러 메시지
  }

  if attemptCount >= config.agent.retryPolicy.maxAttempts:
    → retryQueue에 추가하지 않음
    → 에러 로그: "Max retry attempts reached for issue {identifier}"
    → Workspace.status = "failed"
```

---

## Workspace 상태 머신

```
        create()
idle ──────────────→ running
                         │
              exitCode==0 │ exitCode!=0
                    ↓     ↓
                  done   failed → (retry: back to running)
```

상태 전환은 Orchestrator만 수행한다.

---

## SPEC Section 18.1 구현 필수 체크리스트

Symphony SPEC Section 18.1 준수 여부를 구현 시 확인한다.

| # | 항목 | 설명 |
|---|---|---|
| 18.1.1 | 단일 Orchestrator 인스턴스 | 프로세스 내 Orchestrator는 하나여야 함 |
| 18.1.2 | 폴링 간격 설정 가능 | `config.pollIntervalSec` 으로 조정 |
| 18.1.3 | 동시 실행 한도 강제 | `maxParallel` 초과 시 새 실행 차단 |
| 18.1.4 | 중복 실행 방지 | 동일 issueId에 대한 동시 RunAttempt 금지 |
| 18.1.5 | 재시도 큐 영속성 없음 | 재시작 시 큐 초기화 (in-memory only) |
| 18.1.6 | 재시작 복구 가능 | Linear 재폴링으로 상태 재구성 |
| 18.1.7 | 타임아웃 강제 | `agent.timeout` 초과 시 runner 강제 종료 |
| 18.1.8 | 최대 재시도 횟수 | `retryPolicy.maxAttempts` 초과 시 더 이상 재시도 않음 |
| 18.1.9 | 상태 변경 금지 | Orchestrator는 Linear 이슈 상태를 변경하지 않음 |
| 18.1.10 | 구조화된 로그 | 모든 이벤트를 `observability.md` 형식으로 기록 |
| 18.1.11 | graceful shutdown | SIGTERM 수신 시 현재 RunAttempt 완료 후 종료 |
| 18.1.12 | 설정 변경 rolling restart | WORKFLOW.md 변경 감지 시 기존 실행 완료 후 재로드 |

---

## 인터페이스 요약

```
Orchestrator {
  start()   → void   // 폴링 루프 시작
  stop()    → void   // graceful shutdown (SIGTERM)
  status()  → OrchestratorRuntimeState  // 현재 상태 읽기 전용 반환
}
```

의존 컴포넌트: TrackerClient, WorkspaceManager, AgentRunner, Observability
의존 설정: `Config.concurrency`, `Config.agent.retryPolicy`, `Config.workflowStates`
