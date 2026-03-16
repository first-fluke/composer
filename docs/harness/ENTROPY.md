# ENTROPY.md — 엔트로피 관리

> 에이전트는 코드를 빠르게 생산하지만, 정리하지는 않는다.
> 방치하면 중복 코드, 죽은 브랜치, 미참조 유틸리티가 쌓인다.
> 엔트로피 관리는 이 축적을 구조적으로 차단하는 것이다.

---

## 1. "AI Slop" 방지 전략

### 증상

- 같은 로직이 여러 파일에 분산 구현됨
- 사용되지 않는 import, 미참조 유틸리티 함수
- 파일마다 다른 네이밍 컨벤션
- 기존 추상화를 무시하고 새로 만든 래퍼

### 원인

에이전트가 전체 코드베이스 컨텍스트 없이 작업 단위만 보고 코드를 추가할 때 발생한다.
에이전트는 이미 존재하는 공유 유틸리티를 모르면 새로 만든다.

### 예방

**1. AGENTS.md Conventions 섹션 — 컨텍스트 제공**

에이전트가 작업 시작 전 반드시 읽어야 할 규칙을 명시한다.
공유 유틸리티 위치, 네이밍 컨벤션, 금지 패턴을 포함한다.
(`AGENTS.md` § Conventions — Golden Principles 참조)

**2. 강제 lint — 기계적 차단**

컨벤션을 문서로만 두면 에이전트가 놓친다. lint 규칙으로 기계화한다.

```bash
# 사전커밋훅에서 실행
./scripts/harness/validate.sh
```

lint가 잡는 항목 예시:
- 중복 import
- 미사용 심볼 (unused exports)
- 의존성 계층 위반 (`docs/architecture/LAYERS.md` 기준)

**3. 에러 메시지에 위치 안내**

```
Error: 'formatDate' 함수가 이미 'src/utils/date.ts'에 존재합니다.
새로 만들지 말고 기존 함수를 import하여 사용하세요.
```

(`docs/harness/FEEDBACK-LOOPS.md` — 에러 메시지 설계 원칙 참조)

---

## 2. 백그라운드 GC 에이전트 패턴

### 왜 GC가 필요한가

에이전트는 작업이 끝나도 워크트리, 브랜치, 임시 파일을 정리하지 않는다.
이것이 쌓이면 새 에이전트가 낡은 컨텍스트를 참조하는 오염이 발생한다.

### 실행 주기

주 1회 자동 실행 (`.github/workflows/harness-gc.yml`)

수동 실행:
```bash
./scripts/harness/gc.sh
```

### GC 대상

| 대상 | 기준 | 동작 |
|---|---|---|
| 완료된 worktree | PR 병합 후 잔존 | `git worktree remove` |
| 미사용 브랜치 | 마지막 커밋 30일 이상 경과 | `git branch -d` (원격 포함) |
| 미참조 유틸리티 | import 참조 없음 + 30일 이상 | 플래그 후 사람에게 확인 요청 |

### 주의

GC는 소프트 삭제 원칙을 따른다. 즉시 삭제하지 않고 플래그를 먼저 붙인 후
다음 GC 사이클에서 확인되면 삭제한다. 미참조 유틸리티는 자동 삭제하지 않고
사람에게 확인을 요청한다.

---

## 3. 하네스 성숙도 레벨

에이전트 하네스는 단계적으로 구축한다. 처음부터 L3를 목표로 하지 않는다.

### Level 1 — 기본 (신규 프로젝트 시작점)

목표: 에이전트가 최소한의 규칙 안에서 작동할 수 있는 환경

- [ ] `AGENTS.md` 존재 및 6개 표준 섹션 포함
- [ ] 사전커밋훅: lint + 기본 검사 (`.github/.pre-commit-config.yaml`)
- [ ] 기본 테스트: 단위 테스트 + 커버리지 임계값

### Level 2 — 팀 (에이전트가 팀 규모로 운영될 때)

목표: CI가 아키텍처 불변성을 기계적으로 보장

- [ ] CI 아키텍처 제약 검증 (`scripts/harness/validate.sh`)
  - 의존성 계층 린터 자동 실행
  - 금지 패턴 감지
- [ ] AI PR 전용 리뷰 체크리스트 (`.github/PULL_REQUEST_TEMPLATE.md`)
  - 아키텍처 계층 위반 여부
  - `AGENTS.md` 업데이트 필요 여부
  - AI 생성 코드 검토 항목
- [ ] 의존성 계층 린터 CI 자동화

### Level 3 — 프로덕션 (엔터프라이즈 규모)

목표: 에이전트 행동을 전수 추적하고 자동 알림

- [ ] 커스텀 미들웨어: 에이전트 행동 추적 + 이상 패턴 감지
- [ ] 전체 관찰성 스택: OpenTelemetry (OTEL) 연동
- [ ] 성능 모니터링 + 자동 알림 (지표 임계값 초과 시)

---

## 참조

- `AGENTS.md` § Conventions — Golden Principles, 팀 표준 도구
- `docs/architecture/CONSTRAINTS.md` — 금지 규칙 목록
- `docs/harness/FEEDBACK-LOOPS.md` — 위반 패턴 → CONSTRAINTS.md 업데이트 사이클
- `docs/harness/LEGIBILITY.md` — worktree 수명주기
- `scripts/harness/gc.sh` — GC 스크립트
- `.github/workflows/harness-gc.yml` — GC 자동화 워크플로우
