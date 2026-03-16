# Workflow Loader

> 책임: `WORKFLOW.md` 파일을 파싱하여 타입된 설정과 프롬프트 템플릿을 반환한다.
> SRP: 이 컴포넌트는 파싱만 한다. 설정 검증은 `config-layer.md`, 실행은 `orchestrator.md` 담당.

---

## WORKFLOW.md 구조

```
---
[YAML front matter]
---
[프롬프트 바디 (마크다운)]
```

`---` 구분자로 두 영역을 분리한다.

### YAML Front Matter 예시

```yaml
---
tracker:
  url: https://api.linear.app/graphql
  apiKey: $LINEAR_API_KEY
  teamId: $LINEAR_TEAM_ID

workspace:
  rootPath: $WORKSPACE_ROOT
  keyPattern: "[A-Za-z0-9._-]"

agent:
  command: codex serve
  timeout: 1800

concurrency:
  maxParallel: 3

server:
  port: 8080
---
```

### 프롬프트 바디 예시

```markdown
You are a software engineer working on issue {{issue.identifier}}: {{issue.title}}.

## Context
- Issue: {{issue.url}}
- Workspace: {{workspace_path}}
- Attempt: {{attempt.id}} (retry count: {{retry_count}})

## Description
{{issue.description}}

## Task
Complete the issue as described above.
```

---

## 파싱 책임

### 입력
- `WORKFLOW.md` 파일 경로 (절대 경로)

### 출력
```
WorkflowConfig {
  raw      : object       // YAML front matter를 파싱한 원시 객체
  prompt   : string       // 프롬프트 바디 (템플릿 변수 치환 전 원문)
  filePath : string       // 원본 파일 절대 경로
  loadedAt : ISO8601 string
}
```

### 파싱 단계

1. 파일 읽기
2. 첫 번째 `---` 줄 찾기 → YAML 시작
3. 두 번째 `---` 줄 찾기 → YAML 끝, 프롬프트 바디 시작
4. YAML 파싱 → `raw` 객체
5. 나머지 텍스트 → `prompt` 문자열
6. `$VAR` 패턴을 환경변수로 치환 (Config Layer에 위임)

---

## 템플릿 변수

프롬프트 바디에서 사용 가능한 변수. 에이전트 실행 시점에 치환된다.

| 변수 | 치환 값 | 출처 |
|---|---|---|
| `{{issue}}` | Issue 전체 JSON | `domain-models.md` Issue |
| `{{issue.identifier}}` | 이슈 식별자 (예: `ACR-42`) | Issue.identifier |
| `{{issue.title}}` | 이슈 제목 | Issue.title |
| `{{issue.description}}` | 이슈 본문 | Issue.description — **의심 소스** |
| `{{issue.url}}` | Linear 이슈 URL | Issue.url |
| `{{attempt}}` | RunAttempt 전체 JSON | `domain-models.md` RunAttempt |
| `{{attempt.id}}` | RunAttempt ID | RunAttempt.id |
| `{{workspace_path}}` | Workspace 절대 경로 | Workspace.path |
| `{{retry_count}}` | 누적 재시도 횟수 | RetryEntry.attemptCount (없으면 0) |

**보안 주의:** `{{issue.description}}`은 프롬프트 인젝션이 가능한 외부 입력이다.
삽입 전 반드시 이스케이프 또는 샌드박싱 처리를 적용한다. 상세: `docs/harness/SAFETY.md`.

---

## 버전 관리

- `WORKFLOW.md`는 git으로 관리된다.
- 변경 감지 방법: 파일 mtime 또는 git HEAD 해시 비교.
- **변경 감지 시 rolling restart 필요**: Orchestrator에게 reload 신호 전달.
- Orchestrator는 현재 실행 중인 RunAttempt를 완료시킨 후 새 설정을 적용한다.

---

## 에러 처리

파싱 실패 시 Orchestrator 시작을 거부한다. 에러 메시지에 수정 방법을 포함한다.

| 에러 상황 | 에러 메시지 형식 |
|---|---|
| 파일 없음 | `WORKFLOW.md not found at {path}. Create it from the template: cp WORKFLOW.md.example WORKFLOW.md` |
| `---` 구분자 없음 | `WORKFLOW.md missing YAML front matter. Add --- delimiters at the top of the file.` |
| YAML 파싱 실패 | `WORKFLOW.md YAML parse error at line {n}: {detail}. Fix the YAML syntax and restart.` |
| 필수 키 누락 | `WORKFLOW.md missing required key: {key}. Add it under the {section} section.` |
| 환경변수 미설정 | `WORKFLOW.md references unset env var: {VAR}. Set it in .env or export it before starting.` |

에러 발생 시 프로세스는 즉시 종료한다 (exit code 1).
