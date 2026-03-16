# LAYERS.md — 의존성 방향 원칙

> 언어 무관(language-agnostic). 스택이 달라도 이 규칙은 동일하게 적용된다.

---

## 계층 구조

```
Presentation
    ↓
Application
    ↓
Domain
    ↓
Infrastructure
```

의존성은 항상 위에서 아래 방향만 허용된다. 역방향은 금지다.

---

## 각 계층의 역할

| 계층 | 역할 | Symphony 컨텍스트 예시 |
|---|---|---|
| **Presentation** | 외부 요청 수신 및 응답 포맷팅. 비즈니스 로직 없음. | Router, Handler, CLI 진입점 |
| **Application** | 유스케이스 조율. 도메인 객체를 조합해 작업 흐름을 완성. | Orchestrator, WorkspaceManager |
| **Domain** | 핵심 비즈니스 규칙과 모델. 프레임워크 의존성 없음. | Issue, Workspace, RunAttempt |
| **Infrastructure** | 외부 시스템 연동. 도메인 인터페이스의 구체 구현. | Linear API Client, File System, Git, Logger |

---

## 의존성 방향 규칙

**허용:**

- Presentation → Application
- Application → Domain
- Application → Infrastructure (인터페이스를 통해)
- Infrastructure → Domain (인터페이스 구현)

**금지:**

- Domain → Application
- Domain → Infrastructure
- Domain → Presentation
- Application → Presentation
- Infrastructure → Application (비즈니스 로직 포함 시)

---

## Symphony 컨텍스트 적용

### Presentation 계층

- `Router` / `Handler` — HTTP 요청 수신, 응답 직렬화
- `CLI` — 커맨드라인 진입점, 플래그 파싱

규칙: 비즈니스 결정을 내리지 않는다. 입력을 Application 계층으로 전달하고 결과를 포맷팅한다.

### Application 계층

- `Orchestrator` — 폴링 루프, 상태 머신, 재시도 큐. 단일 권한 in-memory 상태 소유.
- `WorkspaceManager` — 이슈별 격리 디렉터리 + git worktree 수명주기 관리.

규칙: 도메인 모델을 조합해 작업 흐름을 완성한다. 외부 시스템은 인터페이스를 통해 접근한다.

### Domain 계층

- `Issue` — Linear 이슈 식별자, 상태, 본문
- `Workspace` — 이슈별 격리 작업 공간 (경로, 상태)
- `RunAttempt` — 에이전트 실행 시도 (시작 시각, 종료 시각, 결과)

규칙: 프레임워크, ORM, HTTP 클라이언트 등 외부 의존성이 없다. 순수 데이터 구조와 비즈니스 규칙만 존재한다.

### Infrastructure 계층

- `LinearApiClient` — Linear GraphQL 어댑터
- `FileSystem` — 디렉터리 생성, 파일 읽기/쓰기
- `Git` — git worktree 명령 실행
- `Logger` — 구조화된 JSON 로그 출력

규칙: 도메인 인터페이스를 구현한다. 비즈니스 결정을 내리지 않는다.

---

## 위반 예시 (에이전트가 반드시 피해야 할 패턴)

### 위반 1 — Domain 계층에서 외부 SDK import

```typescript
// 금지: Domain 모델에서 Linear SDK를 직접 import
import { LinearClient } from "@linear/sdk"; // ← 위반

export class Issue {
  async updateStatus(client: LinearClient) { ... }
}
```

올바른 방법: Domain은 인터페이스만 정의. LinearClient는 Infrastructure 계층에서 구현.

### 위반 2 — Infrastructure 계층에서 비즈니스 로직 결정

```typescript
// 금지: Repository 구현체에서 재시도 횟수 정책을 직접 결정
export class LinearApiClient {
  async fetchIssue(id: string) {
    if (this.retryCount > 3) {
      return this.cancelWorkspace(); // ← 비즈니스 결정: 위반
    }
  }
}
```

올바른 방법: 재시도 정책은 Application 계층(Orchestrator)에서 결정. Infrastructure는 호출 실패만 예외로 전달.

---

## 강제 도구

스택별 의존성 방향 자동 검사 방법은 `docs/architecture/enforcement/` 참조.
