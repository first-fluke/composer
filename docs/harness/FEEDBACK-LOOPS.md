# FEEDBACK-LOOPS.md — 피드백 루프 설계

> 에이전트는 반복 실패를 통해 시스템을 개선하는 신호를 만들어 낸다.
> 그 신호를 회수하지 않으면 같은 실수가 무한히 반복된다.

---

## 1. 정적 vs 동적 컨텍스트

| 종류 | 위치 | 갱신 주기 | 역할 |
|---|---|---|---|
| **정적** | `AGENTS.md` | 사람이 수동 갱신 | 에이전트 진입 시 항상 읽는 불변 규칙 |
| **동적** | 로그, 메트릭, CI 결과 | 실시간 | 에이전트 실행 중 판단 근거 |

### 단일 진실 공급원

저장소가 단일 진실 공급원이다.

- 규칙은 `AGENTS.md` 또는 `docs/` 하위 파일에 있다.
- 슬랙 메시지, 구두 합의, 위키에만 존재하는 규칙은 에이전트가 볼 수 없다.
- 에이전트와 합의한 모든 제약은 반드시 저장소에 커밋되어야 한다.

---

## 2. 에이전트 실패 → AGENTS.md 업데이트 사이클

에이전트가 반복적으로 같은 실수를 한다면, 그것은 컨텍스트 부재 신호다.

### 사이클

```
에이전트 실패
    ↓
패턴 감지 (같은 실수 2회 이상)
    ↓
AGENTS.md 또는 docs/architecture/CONSTRAINTS.md에 명시적 금지 규칙 추가
    ↓
에러 메시지에 수정 지침 포함 (에이전트가 자율 수정 가능하도록)
    ↓
CI가 동일 위반을 감지 → 자동 차단
```

### 에러 메시지 설계 원칙

단순 경고는 에이전트가 스스로 고칠 수 없다.

```
# 나쁜 예
Error: import violation

# 좋은 예
Error: 'orchestrator' imports from 'agent-runner' — 의존성 방향 위반.
허용된 방향: orchestrator → workspace-manager → agent-runner
수정: orchestrator에서 agent-runner를 직접 import하는 대신
      workspace-manager의 인터페이스를 통해 호출하라.
참조: docs/architecture/LAYERS.md
```

에이전트가 오류 메시지만 읽고 스스로 고칠 수 있어야 한다.
(`AGENTS.md` § Conventions — 에러 메시지 원칙 참조)

### CI 위반 → CONSTRAINTS.md 업데이트

CI가 잡은 위반은 자동 스캐너가 놓친 패턴이다.
발견 즉시 `docs/architecture/CONSTRAINTS.md`에 추가하고 lint 규칙으로 기계화한다.

---

## 3. 측정 지표 수집

에이전트 처리량과 하네스 효율을 수치로 추적한다.
지표가 없으면 개선이 일어나고 있는지 알 수 없다.

| 지표 | 수집 위치 | 목표 |
|---|---|---|
| PR까지 시간 | `git log` (이슈 할당 → PR 생성 타임스탬프) | 감소 추세 |
| CI 통과율 | GitHub Actions 실행 로그 | > 90% |
| PR당 검토 시간 | GitHub API (review submitted 타임스탬프) | 감소 추세 |
| 문서 신선도 | `git log AGENTS.md` 최신 커밋 날짜 | < 7일 |

### 문서 신선도 기준

`AGENTS.md`가 7일 이상 미갱신이면 피드백 루프가 끊긴 것이다.
에이전트 실패 패턴이 반영되지 않고 있다는 신호로 해석한다.

지표 수집 포인트 상세: `docs/specs/observability.md`

---

## 4. 피드백 루프 건강 체크

다음 항목이 모두 충족될 때 피드백 루프가 정상 작동 중이다.

- [ ] `AGENTS.md` 마지막 커밋이 7일 이내
- [ ] CI 통과율이 지난 2주간 90% 이상
- [ ] 에이전트가 같은 lint 오류를 연속 3회 이상 유발하는 패턴이 없음
- [ ] 새로운 위반 패턴 발견 시 24시간 이내 CONSTRAINTS.md 업데이트

---

## 참조

- `AGENTS.md` § Metrics — 지표 정의
- `AGENTS.md` § Conventions — 에러 메시지 원칙, Golden Principles
- `docs/architecture/CONSTRAINTS.md` — 금지 규칙 목록
- `docs/specs/observability.md` — 지표 수집 포인트 명세
- `docs/harness/ENTROPY.md` — 하네스 성숙도 레벨
