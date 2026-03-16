# CONSTRAINTS.md — 금지 규칙 목록

> 에이전트는 나쁜 패턴을 반복하고 증폭시킨다. 아래 규칙을 기계적으로 강제한다.
> 스택별 자동화 도구: `docs/architecture/enforcement/` 참조.

---

## 금지 패턴 목록

### 1. Domain 계층에 프레임워크 의존성 금지

**규칙:** Domain 계층 파일은 프레임워크, ORM, HTTP 클라이언트, 외부 SDK를 import하지 않는다.

**위반 예시:**
```python
# domain/issue.py
from sqlalchemy import Column, String  # 금지: ORM이 Domain에 침투
from linear_sdk import LinearClient    # 금지: 외부 SDK가 Domain에 침투
```

**올바른 방법:**
```python
# domain/issue.py
from dataclasses import dataclass

@dataclass
class Issue:
    id: str
    identifier: str
    title: str
    description: str
    status: str
```

---

### 2. Router/Handler에 비즈니스 로직 금지

**규칙:** Presentation 계층(Router, Handler, CLI)은 입력 파싱과 응답 포맷팅만 담당한다. 조건 분기로 비즈니스 결정을 내리지 않는다.

**위반 예시:**
```typescript
// presentation/issueRouter.ts
router.post("/issues/:id/run", async (req, res) => {
  const issue = await linearClient.getIssue(req.params.id);
  if (issue.retryCount > 3) {          // 금지: 비즈니스 결정
    await workspace.cancel(issue.id);   // 금지: 도메인 작업
  }
  res.json({ status: "ok" });
});
```

**올바른 방법:**
```typescript
// presentation/issueRouter.ts
router.post("/issues/:id/run", async (req, res) => {
  const result = await orchestrator.handleIssue(req.params.id); // Application 위임
  res.json(result);
});
```

---

### 3. 하드코딩된 비밀값 금지

**규칙:** API 키, 패스워드, 토큰, URL, ID 등을 코드에 직접 작성하지 않는다. `.env`에만 기입하고, `.env`는 `.gitignore`에 등록한다.

**위반 예시:**
```go
// 금지
client := linear.NewClient("lin_api_abc123xyz")
teamID := "ACR"
```

**올바른 방법:**
```go
apiKey := os.Getenv("LINEAR_API_KEY")
if apiKey == "" {
    log.Fatal("LINEAR_API_KEY is not set. Add it to .env (see .env.example)")
}
client := linear.NewClient(apiKey)
```

---

### 4. 이슈 본문을 신뢰된 입력으로 처리 금지

**규칙:** Linear 이슈 본문은 외부 입력이다. 프롬프트에 삽입하기 전에 반드시 진입점에서 검증하고 sanitize한다. `WORKFLOW.md`만 신뢰한다.

**위반 예시:**
```typescript
// 금지: 이슈 본문을 검증 없이 직접 프롬프트에 삽입
const prompt = `${workflowTemplate}\n\n${issue.description}`;
await agentRunner.run(prompt);
```

**올바른 방법:**
```typescript
// Presentation 계층 진입점에서 검증 후 Application으로 전달
const sanitizedDescription = sanitizeIssueBody(issue.description); // 길이 제한, 인젝션 패턴 제거
await orchestrator.runIssue({ ...issue, description: sanitizedDescription });
```

---

### 5. 단일 파일 500줄 초과 금지

**규칙:** 하나의 파일이 500줄을 초과하면 책임이 과도하게 집중된 것이다. 계층 또는 관심사 기준으로 분리한다.

**위반 예시:**
```
orchestrator.ts  1,200줄  // 금지: 폴링, 재시도, 상태관리, 워크스페이스 관리 혼재
```

**올바른 방법:**
```
orchestrator/
├── poller.ts        ← 폴링 루프
├── stateMachine.ts  ← 상태 전환 규칙
├── retryQueue.ts    ← 재시도 큐
└── index.ts         ← 조합 및 외부 인터페이스
```

---

### 6. 공유 mutable 상태 (Orchestrator 외) 금지

**규칙:** 전역 변수 또는 모듈 수준의 mutable 상태를 Orchestrator 외부에서 사용하지 않는다. Orchestrator가 단일 권한 in-memory 상태를 소유한다.

**위반 예시:**
```python
# 금지: 모듈 수준 전역 상태
_active_workspaces: dict[str, Workspace] = {}  # 어디서든 수정 가능

def get_workspace(issue_id: str) -> Workspace:
    return _active_workspaces[issue_id]
```

**올바른 방법:**
```python
class Orchestrator:
    def __init__(self):
        self._state: OrchestratorRuntimeState = OrchestratorRuntimeState()

    def get_workspace(self, issue_id: str) -> Workspace:
        return self._state.active_workspaces[issue_id]
```

---

### 7. 수정 지침 없는 단순 경고 출력 금지

**규칙:** 에러 메시지는 에이전트가 메시지만 보고 스스로 수정할 수 있어야 한다. 현상만 알리는 경고는 에이전트에게 무용하다.

**위반 예시:**
```
Error: Missing environment variable
Error: Invalid configuration
Warning: Connection failed
```

**올바른 방법:**
```
Error: LINEAR_API_KEY is not set.
  → Add it to .env file (copy from .env.example)
  → Location: /Users/you/project/.env
  → Format: LINEAR_API_KEY=lin_api_xxxxxxxx

Error: WORKSPACE_ROOT must be an absolute path.
  → Current value: "relative/path"
  → Fix: Set WORKSPACE_ROOT=/absolute/path/to/workspaces in .env
```

---

## 강제 자동화

| 스택 | 도구 | 설정 문서 |
|---|---|---|
| TypeScript | dependency-cruiser | `docs/architecture/enforcement/typescript.md` |
| Python | import-linter + Ruff | `docs/architecture/enforcement/python.md` |
| Go | golangci-lint + go vet | `docs/architecture/enforcement/go.md` |

CI에서 `scripts/harness/validate.sh`를 실행해 위 도구를 자동 검사한다.
