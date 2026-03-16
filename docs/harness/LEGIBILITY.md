# LEGIBILITY.md — Application Legibility 원칙

> Application Legibility란 에이전트가 실행 중에 시스템 상태를 스스로 관찰하고 해석할 수 있는 능력이다.
> 에이전트가 자신이 무엇을 하고 있는지 볼 수 없으면 올바른 판단을 내릴 수 없다.

---

## 1. 워크트리별 격리 부팅

### 왜 격리하는가

에이전트가 동시에 여러 이슈를 처리할 때 같은 파일 시스템을 공유하면 충돌이 발생한다.
워크트리 격리는 에이전트 간 파일 시스템 충돌을 구조적으로 차단한다.

### 패턴

```bash
git worktree add {WORKSPACE_ROOT}/{key} -b issue/{key}
```

- `{key}`: `issue.identifier`에서 `[A-Za-z0-9._-]` 외 문자를 `_`로 치환한 값
- 각 worktree는 독립된 작업 디렉터리를 가진다
- 에이전트는 자신에게 할당된 worktree 경로 밖에 파일을 쓰지 않는다

### 수명주기

| 단계 | 동작 |
|---|---|
| 이슈 할당 | `git worktree add` 실행 |
| 에이전트 실행 | 해당 worktree 경로에서만 작업 |
| PR 병합 | worktree 제거 + 브랜치 삭제 |
| 30일 미사용 | GC 에이전트가 자동 정리 (`docs/harness/ENTROPY.md` 참조) |

### 구현 참조

`./scripts/dev.sh` — 원커맨드 개발환경 부팅 (워크트리 생성 포함)

---

## 2. Chrome DevTools Protocol (CDP)

### 왜 CDP인가

에이전트가 브라우저를 조작하는 태스크(프론트엔드 버그 수정, UI 검증)를 수행할 때,
에이전트 자신이 렌더링 결과를 볼 수 없으면 시행착오만 반복한다.
CDP는 에이전트에게 브라우저의 눈을 제공한다.

### 구성

```bash
# 브라우저 실행 시 디버깅 포트 활성화
chromium --remote-debugging-port=9222
```

### 에이전트가 CDP로 할 수 있는 것

| 기능 | 활용 예시 |
|---|---|
| 스크린샷 캡처 | 렌더링 결과 확인 후 다음 액션 결정 |
| 네트워크 로그 | API 요청/응답 검증 |
| DOM 조회 | 엘리먼트 존재 여부 확인 |
| 콘솔 로그 수집 | 런타임 에러 감지 |

### 언제 유용한가

- 프론트엔드 에이전트가 렌더링 버그를 디버깅할 때
- UI 에이전트가 폼 제출, 버튼 클릭 등 인터랙션을 검증할 때
- 시각적 회귀 테스트를 에이전트가 직접 수행할 때

### 주의

CDP는 임시 디버깅 수단이다. 프로덕션 에이전트가 항상 브라우저를 열어 둘 필요는 없다.
브라우저 접근이 필요 없는 태스크에서는 비활성화한다.

---

## 3. 임시 관찰성 스택

### 목적

에이전트 실행 중 실시간으로 무슨 일이 일어나고 있는지 볼 수 있어야 한다.
에이전트가 멈춰 있는지, 루프를 돌고 있는지, 아니면 정상적으로 진행 중인지 구분할 수 없으면
사람이 개입 시점을 판단할 수 없다.

### 구성 요소

| 구성 요소 | 형태 | 목적 |
|---|---|---|
| 구조화된 로그 | JSON (stdout) | 에이전트 액션 타임라인 |
| HTTP status surface | 선택적, 로컬 포트 | 실시간 상태 조회 |

### 구조화된 로그 형식

```json
{
  "ts": "2026-03-16T10:00:00Z",
  "level": "info",
  "event": "agent.action",
  "issue": "ACR-42",
  "workspace": "/workspaces/ACR-42",
  "action": "file.write",
  "path": "src/api/users.py"
}
```

모든 에이전트 액션은 이 형식으로 기록된다. 상세 명세: `docs/specs/observability.md`

### HTTP status surface (선택적)

로컬 개발 시 에이전트 상태를 브라우저에서 조회할 수 있는 경량 HTTP 엔드포인트.

```
GET /status       → 현재 실행 중인 에이전트 목록
GET /status/{key} → 특정 이슈 처리 상태
```

프로덕션 배포 시 비활성화하거나 인증을 추가한다.

---

## 참조

- `AGENTS.md` § Architecture Overview — Observability 컴포넌트 개요
- `docs/specs/observability.md` — 구조화된 로그 명세 + 측정 지표 수집 포인트
- `docs/harness/ENTROPY.md` — worktree GC 패턴
- `docs/harness/SAFETY.md` — 감사 로그 요구사항
