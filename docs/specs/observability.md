# Observability

> 책임: 구조화된 로그 출력, 메트릭 수집, 선택적 status surface 제공.
> SRP: 로그와 메트릭 인프라만 담당. 비즈니스 로직은 각 컴포넌트 책임.

---

## 로그 형식

`LOG_FORMAT` 환경변수로 제어한다.

```
LOG_FORMAT=json   → JSON 형식 (프로덕션 권장)
LOG_FORMAT=text   → 사람이 읽기 쉬운 텍스트 (기본값, 개발 환경)
```

### JSON 형식 예시

```json
{
  "timestamp": "2026-03-16T10:30:00.000Z",
  "level": "info",
  "component": "orchestrator",
  "issueId": "a1b2c3d4-...",
  "message": "agent started for issue ACR-42"
}
```

### 텍스트 형식 예시

```
2026-03-16T10:30:00.000Z [INFO] [orchestrator] agent started for issue ACR-42 issueId=a1b2c3d4-...
```

---

## 필수 로그 필드

모든 로그 이벤트에 포함해야 하는 필드:

| 필드 | 타입 | 설명 |
|---|---|---|
| `timestamp` | ISO8601 | 이벤트 발생 시각 (UTC) |
| `level` | string | 로그 레벨 |
| `component` | string | 로그를 발생시킨 컴포넌트 |
| `message` | string | 이벤트 설명 |
| `issueId` | string | 이슈 ID (관련 있을 때만) |

**선택적 필드:** `attemptId`, `workspacePath`, `exitCode`, `durationMs`, `error`

---

## 로그 레벨

`LOG_LEVEL` 환경변수로 제어한다. 설정된 레벨 이상만 출력한다.

| 레벨 | 사용 시점 |
|---|---|
| `debug` | 폴링 루프 세부사항, RPC 요청/응답 원문, 상태 전환 추적 |
| `info` | 에이전트 시작/완료, workspace 생성/삭제, 재시도 예약 |
| `warn` | 재시도 발생, rate limit 응답, 설정값 경계 근접 |
| `error` | 에이전트 실패, Linear API 인증 오류, 예외 미처리 |

기본값: `info`

---

## 주요 로그 이벤트

구현 시 반드시 기록해야 하는 이벤트:

```
[orchestrator] polling started                     level: debug
[orchestrator] found {n} in-progress issues        level: debug
[orchestrator] starting agent for issue {id}       level: info   + issueId
[orchestrator] agent completed for issue {id}      level: info   + issueId, exitCode, durationMs
[orchestrator] agent failed for issue {id}         level: warn   + issueId, exitCode, error
[orchestrator] retry scheduled for issue {id}      level: warn   + issueId, attemptCount, nextRetryAt
[orchestrator] max retries exceeded for {id}       level: error  + issueId
[workspace-manager] workspace created              level: info   + issueId, workspacePath
[workspace-manager] workspace cleaned up           level: info   + issueId, workspacePath
[tracker-client] rate limit hit                    level: warn   + retryAfterSec
[tracker-client] auth failed                       level: error
[config-layer] config validation failed            level: error  + 에러 목록
[workflow-loader] WORKFLOW.md reloaded             level: info
```

---

## 메트릭 수집 포인트

다음 이벤트에서 메트릭을 수집한다.

| 메트릭 | 수집 시점 | 단위 |
|---|---|---|
| `poll_count` | 매 폴링 사이클 완료 시 | count |
| `issues_found` | 폴링 결과 | count (per poll) |
| `agent_duration_ms` | RunAttempt 완료 시 | milliseconds |
| `agent_success_count` | exitCode == 0 시 | count |
| `agent_failure_count` | exitCode != 0 시 | count |
| `retry_count` | 재시도 큐 등록 시 | count |
| `active_workspaces` | 폴링 사이클마다 | gauge |
| `linear_api_errors` | Linear API 에러 발생 시 | count |

---

## 선택적 Status Surface (HTTP 엔드포인트)

`Config.server.port`에 간단한 HTTP 서버를 띄워 현재 상태를 노출한다.

### GET /status

```json
{
  "isRunning": true,
  "lastPollAt": "2026-03-16T10:30:00.000Z",
  "activeWorkspaces": [
    {
      "issueId": "a1b2c3d4-...",
      "identifier": "ACR-42",
      "status": "running",
      "startedAt": "2026-03-16T10:25:00.000Z"
    }
  ],
  "retryQueueSize": 1,
  "metrics": {
    "totalAttempts": 42,
    "successCount": 38,
    "failureCount": 4
  }
}
```

### GET /health

```json
{ "status": "ok" }
```

Linear API 연결 불가 시: `{ "status": "degraded", "reason": "linear api unreachable" }`

**보안:** status surface는 내부 네트워크에서만 접근 가능하도록 구성한다. 인증 없이 외부에 노출하지 않는다.

---

## 선택적 OTEL 연동

`OTEL_ENDPOINT` 환경변수가 설정된 경우 OpenTelemetry로 메트릭과 트레이스를 전송한다.

```
OTEL_ENDPOINT=http://collector:4318   → OTLP HTTP 프로토콜로 전송
OTEL_ENDPOINT 미설정 → OTEL 연동 비활성화 (로컬 로그만 사용)
```

**트레이스 범위:** 폴링 사이클 전체를 루트 span으로, 각 RunAttempt를 자식 span으로 기록한다.
