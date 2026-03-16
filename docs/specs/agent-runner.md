# Agent Runner

> 책임: Codex app-server 프로세스를 시작하고, JSON-RPC over stdio로 태스크를 전달하며, 결과를 수집한다.
> SRP: 에이전트 프로세스 수명주기만 담당. 재시도 결정은 Orchestrator 책임.

도메인 모델: `domain-models.md` 참조 (RunAttempt, LiveSession).

---

## 프로토콜

**JSON-RPC over stdio**

에이전트는 stdio로 통신한다. AgentRunner는 자식 프로세스(stdin/stdout/stderr)를 통해 요청을 전달하고 응답을 수신한다.

---

## 에이전트 시작

```
명령: codex serve
  (config.agent.command 값)

환경변수 상속: 부모 프로세스 환경 + 아래 추가 항목
  WORKSPACE_PATH={workspace.path}
  ISSUE_ID={issue.id}
  ATTEMPT_ID={attempt.id}

작업 디렉터리: {workspace.path}
```

---

## 요청 형식 (JSON-RPC)

```json
{
  "jsonrpc": "2.0",
  "id": "{attempt.id}",
  "method": "task",
  "params": {
    "prompt": "{rendered_prompt}",
    "workspace_path": "{workspace.path}",
    "environment": {
      "ISSUE_ID": "{issue.id}",
      "ATTEMPT_ID": "{attempt.id}"
    }
  }
}
```

`rendered_prompt`: `workflow-loader.md`의 템플릿 변수를 치환한 최종 프롬프트.

---

## 응답 형식 (JSON-RPC)

```json
{
  "jsonrpc": "2.0",
  "id": "{attempt.id}",
  "result": {
    "output": "에이전트 최종 출력 문자열",
    "exit_code": 0,
    "duration_ms": 45230
  }
}
```

**에러 응답:**
```json
{
  "jsonrpc": "2.0",
  "id": "{attempt.id}",
  "error": {
    "code": -32000,
    "message": "에러 메시지",
    "data": { "exit_code": 1 }
  }
}
```

---

## 타임아웃 처리

```
config.agent.timeout 초 경과 시:
  1. SIGTERM 전송 → 10초 대기
  2. 응답 없으면 SIGKILL
  3. RunAttempt.exitCode = -1 (강제 종료)
  4. 로그: agent timed out for attempt {id}, issueId: {issueId}
```

---

## 하트비트

실행 중 LiveSession 갱신을 위해 주기적으로 프로세스 상태를 확인한다.

```
확인 주기: 30초
확인 방법: 프로세스 PID 생존 여부 (OS kill -0)
갱신: LiveSession.lastHeartbeat = now
```

---

## RunAttempt 기록

실행 완료 시 RunAttempt를 확정한다.

```
attempt.finishedAt = now
attempt.exitCode   = result.exit_code
attempt.agentOutput = result.output (최대 10KB, 초과 시 truncate)
```

---

## SPEC Section 17 테스트 매트릭스

구현 검증에 사용할 테스트 케이스. 각 케이스는 자동화 테스트로 작성한다.

| # | 시나리오 | 입력 | 기대 출력 | 검증 항목 |
|---|---|---|---|---|
| 17.1 | 정상 실행 | 유효한 이슈 + workspace | exit_code: 0 | RunAttempt.exitCode == 0 |
| 17.2 | 에이전트 실패 | 처리 불가 이슈 | exit_code: 1 | RetryEntry 생성됨 |
| 17.3 | 타임아웃 | timeout=5초, 장시간 태스크 | 강제 종료 | exit_code: -1, LiveSession 삭제 |
| 17.4 | 프로세스 크래시 | 에이전트 비정상 종료 | SIGKILL | RunAttempt.exitCode != 0 |
| 17.5 | 동시 실행 한도 | maxParallel=2, 이슈 3개 | 2개만 시작 | 3번째 이슈는 대기 |
| 17.6 | 재시도 큐 | 실패 후 nextRetryAt 도달 | 재실행 | attemptCount 증가 |
| 17.7 | 최대 재시도 초과 | maxAttempts=3, 3회 실패 | 중단 | Workspace.status == "failed" |
| 17.8 | 재시작 복구 | Orchestrator 재시작 | Linear 재폴링 | 기존 workspace 재사용 |
| 17.9 | WORKFLOW.md 변경 | 파일 변경 감지 | rolling restart | 기존 실행 완료 후 재로드 |
| 17.10 | 프롬프트 인젝션 | 악의적 이슈 본문 | 이스케이프 처리 | 프롬프트 삽입 전 sanitize |
| 17.11 | graceful shutdown | SIGTERM | 현재 실행 완료 후 종료 | 진행 중 attempt 손실 없음 |
| 17.12 | rate limit | Linear 429 응답 | backoff 재시도 | 폴링 계속 진행 |

---

## 인터페이스 요약

```
AgentRunner {
  spawn(issue: Issue, workspace: Workspace, attempt: RunAttempt) → Promise<RunAttempt>
  // 에이전트 프로세스 시작, 완료까지 대기, RunAttempt 반환
  // 타임아웃 또는 에러 시 예외 발생

  kill(attemptId: string) → void
  // 실행 중인 에이전트 강제 종료 (graceful shutdown용)
}
```

의존 설정: `Config.agent` (command, timeout)
