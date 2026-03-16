# Symphony Dev Template — 구현 플랜

> 작업 경로: `/Users/gahyun/projects/agent-template`
> 최종 업데이트: 2026-03-16 (reference_docs.md 기반 누락 항목 12개 추가)

---

## 목적

OpenAI Symphony SPEC 기반 코딩 에이전트 오케스트레이션 서비스를 구현할 수 있는
**기술스택 무관** 개발 템플릿. 하네스 엔지니어링 관점으로 설계.

---

## 참고 문서 & 핵심 인사이트

### 1. OpenAI Symphony SPEC
- **URL**: https://github.com/openai/symphony/blob/main/SPEC.md
- **성격**: 언어 무관(language-agnostic) 명세서. 구현체를 강제하지 않음.
- **핵심 구조**: 7개 컴포넌트
  1. Workflow Loader — WORKFLOW.md 파싱 (YAML front matter + 프롬프트 바디)
  2. Config Layer — 타입된 설정 + `$VAR` 환경변수 resolution
  3. Issue Tracker Client — Linear GraphQL 어댑터 (현재는 Linear만)
  4. Orchestrator — 폴링 루프, 상태 머신, 재시도 큐 (단일 권한 in-memory 상태)
  5. Workspace Manager — 이슈별 격리 디렉터리 + 수명주기 훅
  6. Agent Runner — Codex app-server JSON-RPC (stdio) 클라이언트
  7. Observability — 구조화된 로그 + 선택적 status surface
- **중요 경계**: Symphony는 스케줄러/러너. 티켓 상태 변경은 에이전트가 함.
- **SPEC Section 18.1** — 구현 필수 체크리스트 (준수 기준)
- **SPEC Section 17** — 테스트 및 검증 매트릭스
- **SPEC Appendix A** — SSH Worker 확장 (선택적, 원격 실행)
- **핵심 도메인 모델**:
  - Issue, Workspace, RunAttempt, LiveSession, RetryEntry, OrchestratorRuntimeState
  - Workspace Key 파생: `issue.identifier`에서 `[A-Za-z0-9._-]` 외 문자 → `_`

### 2. oh-my-agent
- **URL**: https://github.com/first-fluke/oh-my-agent (사용자 소유 레포)
- **성격**: 포터블 멀티에이전트 하네스. `.agents/`가 source of truth.
- **핵심 구조**:
  - `.agents/skills/<name>/SKILL.md` — 도메인별 에이전트
  - `.agents/workflows/` — 오케스트레이션 워크플로우
  - `_shared/` — 범용 프로토콜 (execution-protocols, context-loading 등)
  - `_shared/execution-protocols/` — claude.md, codex.md, gemini.md, qwen.md (이미 멀티 IDE)
- **멀티 IDE 지원**: Antigravity(네이티브), Claude Code(어댑터), Codex, Amp, OpenCode, Cursor
- **현재 스택 고착 문제** (추후 별도 수정):
  - backend-agent → FastAPI/Python 하드코딩
  - frontend-agent → React/Next.js 하드코딩
  - mobile-agent → Flutter 하드코딩
- **현재 프로젝트에서는**: 수정 없이 설치 후 사용. 스택 고착은 AGENTS.md로 컨텍스트 보완.

### 3. OpenAI Harness Engineering
- **URL**: https://openai.com/index/harness-engineering/
- **성과**: 3명 엔지니어, 5개월, ~100만 줄, 수동 코드 0줄, 평균 3.5 PR/엔지니어/일
- **패러다임 전환**: 엔지니어 = 코드 작성자 → **환경 설계자**
- **핵심 원칙 5가지**:
  1. **Context Engineering** — AGENTS.md(정적) + 로그/메트릭(동적). 저장소가 단일 진실 공급원.
  2. **Architecture Constraints** — 의존성 계층 린터로 기계적 강제. 나쁜 패턴도 에이전트가 증폭시킴.
  3. **Application Legibility** — 워크트리별 격리 부팅, Chrome DevTools Protocol, 임시 관찰성 스택.
  4. **Entropy Management** — 백그라운드 GC 에이전트로 주기적 정리. "AI Slop" 방지.
  5. **Merge Philosophy** — 단기 생명주기 PR. 기다림이 비싸고 수정이 싸다.
- **AGENTS.md 표준 섹션**: Build & Test / Architecture Overview / Security / Git Workflows / Conventions
- **Golden Principles**: 공유 유틸리티 우선, 경계에서 검증, 팀 표준 도구
- **안전**: 최소 권한, 프롬프트 인젝션 방어 (WORKFLOW.md 신뢰, 이슈 본문 의심)
- **측정 지표**: PR까지 시간, CI 통과율, PR당 검토 시간, 문서 신선도

### 4. Harness Engineering (일반)
- **출처**: ignorance.ai, nxcode.io, gtcode.com, InfoQ
- **에러 메시지 설계**: 단순 경고 X → 수정 지침 포함. 에이전트가 실패할 때마다 AGENTS.md 업데이트.
- **진행 추적**: JSON 포맷 권장 (Markdown보다 에이전트가 오편집하기 어려움)
- **병합 철학**: "에이전트 처리량 >> 인간 리뷰 용량" → CI 통과 = 병합 가능
- **스캐폴딩 체크리스트**:
  - 작은 AGENTS.md 진입점 (~100줄)
  - 재현 가능한 개발 환경 (원커맨드 부팅)
  - 워크트리별 격리
  - CI의 기계적 불변성 (린터, 규칙)
  - 에이전트 가시성 (로그, 메트릭, 추적)
  - 명확한 평가 기준
  - 안전 레일 (최소 권한, 감사 로그)

---

## 최종 디렉터리 구조

```
/Users/gahyun/projects/agent-template/
│
├── AGENTS.md                        ← 모든 에이전트 공통 진입점 (primary)
├── CLAUDE.md                        ← Claude Code 어댑터 (AGENTS.md + 서브에이전트)
├── WORKFLOW.md                      ← Symphony 계약 파일 템플릿
├── PLAN.md                          ← 이 파일
├── .env.example
│
├── docs/
│   ├── architecture/
│   │   ├── LAYERS.md                ← 의존성 방향 원칙 (언어 무관)
│   │   ├── CONSTRAINTS.md          ← 금지 규칙 목록
│   │   └── enforcement/
│   │       ├── typescript.md        ← dependency-cruiser 설정 예시
│   │       ├── python.md            ← import-linter 설정 예시
│   │       └── go.md
│   ├── specs/                       ← Symphony 7개 컴포넌트 인터페이스 + 도메인 모델
│   │   ├── domain-models.md         ← Issue, Workspace, RunAttempt 등 핵심 도메인 모델
│   │   ├── workflow-loader.md
│   │   ├── config-layer.md
│   │   ├── tracker-client.md        ← Linear GraphQL 어댑터 + 상태 전환 규칙
│   │   ├── orchestrator.md          ← Section 18.1 체크리스트 포함
│   │   ├── workspace-manager.md
│   │   ├── agent-runner.md          ← Section 17 테스트 매트릭스 포함
│   │   └── observability.md
│   ├── stacks/                      ← 기술스택별 착수 가이드
│   │   ├── typescript.md
│   │   ├── python.md
│   │   └── go.md
│   └── harness/
│       ├── LEGIBILITY.md            ← 워크트리 격리 부팅, Chrome DevTools Protocol
│       ├── FEEDBACK-LOOPS.md        ← 피드백 루프 설계 + 측정 지표
│       ├── ENTROPY.md               ← GC 패턴 + 성숙도 레벨 (L1/L2/L3)
│       └── SAFETY.md                ← 최소 권한, 네트워크 출구, 프롬프트 인젝션 방어
│
├── src/                             ← 비어있음 (스택 선택 후 채움)
│   └── .gitkeep
│
├── scripts/
│   ├── dev.sh                       ← 원커맨드 개발환경 부팅 템플릿
│   └── harness/
│       ├── gc.sh                    ← 엔트로피 GC
│       └── validate.sh              ← 아키텍처 제약 검증
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   ← 구조적 테스트 + 린터 + 아키텍처 제약 검증
│   │   └── harness-gc.yml          ← 주 1회 엔트로피 GC
│   ├── PULL_REQUEST_TEMPLATE.md     ← AI PR 전용 체크리스트
│   └── .pre-commit-config.yaml      ← 로컬 사전커밋훅
│
├── .agents/                         ← oh-my-agent source of truth
│   └── skills/
│       ├── symphony-scaffold/       ← 신규 커스텀 스킬
│       ├── symphony-component/      ← 신규 커스텀 스킬
│       ├── symphony-conformance/    ← 신규 커스텀 스킬
│       └── harness-gc/             ← 신규 커스텀 스킬
│
└── .claude/
    ├── agents/                      ← Claude Code 서브에이전트
    │   ├── symphony-architect.md
    │   ├── symphony-implementer.md
    │   └── symphony-reviewer.md
    └── skills/                      ← .agents/skills/ 심링크
```

---

## 구현 단계 및 진행 상황

### Step 1 — oh-my-agent 설치 ✅
- [x] `cd /Users/gahyun/projects/agent-template && bunx oh-my-agent`
- [x] 프리셋: Fullstack (frontend-agent, backend-agent, db-agent, pm-agent, qa-agent, debug-agent, commit, brainstorm, tf-infra-agent, dev-workflow)
- [x] backend-agent 범용화 완료 (Python / TypeScript / Go 동등 지원, snippets/ + templates/ 분리)

### Step 1.5 — Linear 이슈 트래커 설정 ✅
> Symphony의 Issue Tracker Client는 현재 Linear만 지원. 실제 연동 전에 설정 필요.
- [x] Linear workspace에 프로젝트 생성 (또는 기존 프로젝트 지정)
- [x] Linear API key 발급 (Settings → API → Personal API keys)
- [x] Linear Team ID 확인 (ACR, UUID: 990d8d88-d0ce-4258-8718-076e28a8811f)
- [x] 워크플로우 상태 ID 확인: In Progress, Done, Cancelled → .env에 저장
- [x] `.env.example`에 변수 추가 완료
- [x] `docs/specs/tracker-client.md`에 Linear GraphQL 엔드포인트 + 상태 전환 규칙 문서화

### Step 2 — AGENTS.md (primary context) ✅
- [x] Build & Test — 원커맨드 빌드/테스트 방법, 환경 변수 필수 목록
- [x] Architecture Overview — Symphony 7개 컴포넌트 개요, 의존성 방향 원칙
- [x] Security — 최소 권한, 프롬프트 인젝션 방어, 네트워크 출구 제어
- [x] Git Workflows — 단기 생명주기 PR, 병합 철학, 워크트리 격리
- [x] Conventions — Golden Principles, 에러 메시지 설계 원칙
- [x] Metrics — PR까지 시간, CI 통과율, PR당 검토 시간, 문서 신선도

### Step 3 — CLAUDE.md (Claude Code 어댑터) ✅
- [x] AGENTS.md import
- [x] .claude/agents/ 서브에이전트 참조

### Step 4 — WORKFLOW.md (Symphony 계약 템플릿) ✅
- [x] YAML front matter 전체 (tracker, workspace, agent, concurrency, server)
- [x] 프롬프트 템플릿 변수: `{{issue.identifier}}`, `{{attempt.id}}`, `{{workspace_path}}`, `{{retry_count}}`
- [x] Orchestrator 재시작 복구 설정 (in-memory 상태 → Linear 재폴링으로 복원)
- [x] Appendix A SSH Worker 선택적 섹션 (주석 처리로 제공)

### Step 5 — docs/specs/ (7개 컴포넌트 인터페이스 + 도메인 모델) ✅
- [x] `domain-models.md` — Issue, Workspace, RunAttempt, LiveSession, RetryEntry, OrchestratorRuntimeState
- [x] `workflow-loader.md`
- [x] `config-layer.md`
- [x] `tracker-client.md`
- [x] `orchestrator.md` — Section 18.1 체크리스트 12항목
- [x] `workspace-manager.md`
- [x] `agent-runner.md` — Section 17 테스트 매트릭스 12케이스
- [x] `observability.md`

### Step 6 — docs/architecture/ (계층 원칙) ✅
- [x] LAYERS.md
- [x] CONSTRAINTS.md
- [x] enforcement/typescript.md
- [x] enforcement/python.md
- [x] enforcement/go.md

### Step 7 — docs/stacks/ (착수 가이드) ✅
- [x] typescript.md
- [x] python.md
- [x] go.md

### Step 8 — docs/harness/ (하네스 문서) ✅
- [x] `LEGIBILITY.md` — 워크트리 격리 부팅, CDP, 임시 관찰성 스택
- [x] `FEEDBACK-LOOPS.md` — 정적/동적 컨텍스트, 피드백 루프 설계
- [x] `ENTROPY.md` — AI Slop 방지, GC 패턴, 성숙도 L1/L2/L3
- [x] `SAFETY.md` — 최소 권한, 네트워크 출구, 프롬프트 인젝션 방어, 감사 로그

### Step 9 — .github/ (CI + 자동화) ✅
- [x] `ci.yml`
- [x] `harness-gc.yml`
- [x] `.pre-commit-config.yaml`
- [x] `PULL_REQUEST_TEMPLATE.md`

### Step 10 — scripts/ (운영 스크립트) ✅
- [x] `dev.sh`
- [x] `harness/gc.sh`
- [x] `harness/validate.sh`

### Step 11 — .agents/skills/ (Symphony 전용 커스텀 스킬 4개) ✅
- [x] symphony-scaffold/SKILL.md
- [x] symphony-component/SKILL.md
- [x] symphony-conformance/SKILL.md
- [x] harness-gc/SKILL.md

### Step 12 — .claude/agents/ (Claude Code 서브에이전트 3개) ✅
- [x] symphony-architect.md
- [x] symphony-implementer.md
- [x] symphony-reviewer.md

### Step 13 — .env.example ✅
- [x] Linear 환경변수
- [x] Symphony 공통 환경변수 (WORKSPACE_ROOT, LOG_LEVEL, CODEX_SERVER_URL 등)
- [x] 관찰성 환경변수 (LOG_FORMAT=json, OTEL_ENDPOINT 선택)
- [x] 각 변수에 설명 주석 + 예시값

---

## 핵심 설계 원칙 (이 프로젝트 전반에 적용)

1. **AGENTS.md = primary** — 모든 에이전트 공통. CLAUDE.md는 Claude Code 전용 thin wrapper.
2. **src/ 비어있음** — 아키텍처 원칙만 문서화. 폴더 구조는 스택 선택 후 결정.
3. **에러 메시지에 수정 지침** — 경고만으로는 에이전트가 스스로 고칠 수 없음.
4. **CI가 품질 보장** — CI 통과 = 병합 가능. 인간 리뷰는 아키텍처 게이트키핑에 집중.
5. **단기 생명주기 PR** — 기다림이 비싸고 수정이 싸다.
6. **Symphony 경계 준수** — 티켓 쓰기는 에이전트 몫. Symphony는 스케줄러/러너.

---

## 추후 작업 (이 프로젝트 범위 밖)

- oh-my-agent 프로필 시스템 구현 (범용화)
  - backend-agent: FastAPI → 프로필 선택 가능하도록
  - frontend-agent: Next.js → 프로필 선택 가능하도록
  - 인스톨러에 프로필 선택 단계 추가
  - 상세: oh-my-agent 레포 이슈/브랜치로 관리
