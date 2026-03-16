# SAFETY.md — 안전 레일

> 에이전트는 빠르게 행동한다. 경계가 없으면 빠르게 잘못된 방향으로 행동한다.
> 안전 레일은 에이전트의 속도를 유지하면서 피해 반경을 제한하는 구조다.

---

## 1. 최소 권한 원칙

에이전트에게 태스크 수행에 필요한 최소한의 권한만 부여한다.
권한이 넓을수록 실수의 피해 반경이 커진다.

### 파일 시스템

- 에이전트는 자신의 workspace 디렉터리(`{WORKSPACE_ROOT}/{key}`)만 쓰기 가능
- 다른 이슈의 workspace 경로 접근 불가
- 저장소 루트 직접 수정 불가 (PR을 통해서만)

### Linear API

- 에이전트는 자신이 담당한 이슈만 상태 변경 가능
- 다른 이슈 상태 변경 시도 → 즉시 거부 + 로그
- 이슈 삭제 권한 없음

### Git

- 에이전트는 자신의 브랜치(`issue/{key}`)만 push 가능
- `main`, `master` 직접 push 불가
- force push 불가

### 비밀값 관리

API 키 및 토큰은 코드, 로그, 커밋에 절대 포함하지 않는다.

- 모든 비밀값은 `.env`에만 저장 (`.gitignore` 등록 필수)
- 에이전트가 생성한 파일에서 비밀값 패턴 감지 시 커밋 차단
- `.env.example`에는 키 이름과 설명만 포함, 실제 값 없음

---

## 2. 네트워크 출구 제어

에이전트가 승인되지 않은 외부 서비스를 호출하면 데이터 유출과 예측 불가능한 부작용이 발생한다.

### 승인된 엔드포인트

| 서비스 | 엔드포인트 | 용도 |
|---|---|---|
| Linear | `https://api.linear.app/graphql` | 이슈 조회 + 상태 변경 |
| Codex server | `localhost:{port}` (로컬) | 에이전트 실행 |

### 미승인 외부 호출 처리

미승인 엔드포인트로의 HTTP 요청 시:

1. 즉시 요청 차단
2. 감사 로그에 기록 (timestamp, 시도한 URL, 에이전트 ID, 이슈 key)
3. Orchestrator에 오류 이벤트 전달 → 해당 RunAttempt 실패 처리

### 어댑터 패턴

모든 외부 호출은 승인된 어댑터를 통한다.
에이전트가 외부 네트워크를 직접 호출하는 것을 금지한다.

```
에이전트 → Issue Tracker Client (어댑터) → Linear API
에이전트 → Agent Runner (어댑터) → Codex server
```

(`AGENTS.md` § Architecture Overview — 컴포넌트 경계 참조)

---

## 3. 프롬프트 인젝션 방어

외부 입력에 악의적인 지시가 포함될 수 있다.
에이전트가 이슈 본문의 텍스트를 그대로 프롬프트에 삽입하면
이슈 작성자가 에이전트 행동을 임의로 조작할 수 있다.

### 신뢰 수준 구분

| 소스 | 신뢰 수준 | 이유 |
|---|---|---|
| `WORKFLOW.md` | 신뢰 | 버전 관리됨, 엔지니어가 작성 |
| `AGENTS.md`, `docs/` | 신뢰 | 저장소 내 검증된 파일 |
| 이슈 본문 | 의심 | 외부 입력, 검증 불가 |
| 이슈 댓글 | 의심 | 외부 입력, 검증 불가 |
| PR 설명 | 의심 | 외부 입력일 수 있음 |

### 방어 규칙

**금지:** 외부 입력을 프롬프트에 그대로 삽입

```python
# 위험 — 금지
prompt = f"다음 이슈를 처리하라: {issue.description}"

# 안전 — 이스케이프 또는 구조화된 필드로 전달
prompt = build_prompt(issue_id=issue.id, title=issue.title)
```

**구현 규칙:**

1. 이슈 본문은 구조화된 필드(`issue.id`, `issue.title`)로만 프롬프트에 전달
2. 자유 텍스트 필드는 반드시 이스케이프 처리 후 샌드박스 영역에 격리
3. 이슈 본문에서 추출한 값을 시스템 지시로 해석하지 않음
4. 진입점에서 한 번만 검증, 내부 컴포넌트는 신뢰 (`AGENTS.md` § Conventions — 경계에서 검증 참조)

---

## 4. 감사 로그

에이전트의 모든 행동은 추적 가능해야 한다.
감사 로그 없이는 문제 발생 시 원인을 파악할 수 없다.

### 기록 대상

- 파일 쓰기 (경로, 이슈 key)
- API 호출 (엔드포인트, 메서드, 응답 코드)
- 이슈 상태 변경 (이전 상태 → 이후 상태)
- 브랜치 push
- 네트워크 차단 이벤트

### 로그 형식

```json
{
  "ts": "2026-03-16T10:00:00Z",
  "level": "info",
  "event": "agent.action",
  "agent_id": "codex-worker-1",
  "issue_key": "ACR-42",
  "workspace": "/workspaces/ACR-42",
  "action": "api.call",
  "endpoint": "https://api.linear.app/graphql",
  "operation": "issueUpdate",
  "result": "success"
}
```

- 형식: JSON (한 줄 = 한 이벤트)
- timestamp: ISO 8601 (UTC)
- 구조화된 로그 명세 상세: `docs/specs/observability.md`

### 보관 기준

- 최소 30일 보관
- 삭제 불가 (append-only)
- 비밀값(API 키, 토큰) 절대 포함 금지

---

## 참조

- `AGENTS.md` § Security — 보안 원칙 요약
- `AGENTS.md` § Conventions — 경계에서 검증 원칙
- `docs/specs/observability.md` — 구조화된 로그 명세
- `docs/harness/LEGIBILITY.md` — 임시 관찰성 스택
