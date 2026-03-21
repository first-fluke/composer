# Task Board
## Session: session-20260321-220000

### T1
- **Agent**: db
- **Title**: Supabase DB 스키마 (SQL 마이그레이션 파일 생성)
- **Status**: pending
- **Priority**: 0
- **Dependencies**: none
- **Description**: teams, team_members, ledger_events 테이블 + RLS + 인덱스 SQL 파일 생성
- **Acceptance Criteria**:
  - SQL 파일이 설계 문서(docs/plans/team-dashboard-design.md) 스키마와 일치
  - RLS 정책: team_read + own_write (email prefix 검증 포함)
  - idx_team_members_user, idx_ledger_team, idx_ledger_team_seq 인덱스

### T2
- **Agent**: backend
- **Title**: Domain 타입: LedgerEvent + TeamState + LedgerEventPublisher
- **Status**: pending
- **Priority**: 0
- **Dependencies**: none
- **Description**: src/domain/ledger.ts에 Discriminated Union 이벤트 타입, TeamState, NodePresence, LedgerEventPublisher 인터페이스 정의
- **Acceptance Criteria**:
  - 7개 이벤트 타입 Discriminated Union
  - v, seq, relayTimestamp, clientTimestamp, nodeId 공통 필드
  - defaultAgentType (per-issue model routing 대비)
  - zero imports from other layers

### T3
- **Agent**: backend
- **Title**: Config 확장 + node-id 생성
- **Status**: pending
- **Priority**: 0
- **Dependencies**: none
- **Description**: src/config/env.ts에 optional supabaseUrl, supabaseAnonKey, teamId + isTeamMode(). src/relay/node-id.ts에 nodeId 생성.
- **Acceptance Criteria**:
  - 기존 Config 스키마에 optional 필드 3개 추가
  - isTeamMode() 헬퍼 함수
  - generateNodeId() → "{username}:{hostname}"
  - 기존 standalone 모드 영향 없음

### T4
- **Agent**: backend
- **Title**: SupabaseLedgerClient + Replay 로직
- **Status**: pending
- **Priority**: 1
- **Dependencies**: T1, T2
- **Description**: src/relay/supabase-ledger-client.ts (publish + retry queue), src/relay/replay.ts (이벤트 → TeamState)
- **Acceptance Criteria**:
  - LedgerEventPublisher 인터페이스 구현
  - publish() 실패 시 local queue + 10초 flush (at-least-once)
  - dispose() 시 queue flush
  - replayLedger() 순수 함수: 10개 이상 테스트 케이스
  - node.leave 시 암묵적 cancelled, 멱등 agent.start

### T5
- **Agent**: backend
- **Title**: Orchestrator EventEmitter + LedgerBridge + main.ts 연결
- **Status**: pending
- **Priority**: 1
- **Dependencies**: T2, T3, T4
- **Description**: Orchestrator에 on/off/emitEvent 추가, LedgerBridge가 구독해서 Supabase에 전달, main.ts에서 조건부 연결
- **Acceptance Criteria**:
  - Orchestrator: node.join/leave, agent.start/done/failed 이벤트 emit
  - LedgerBridge: fire-and-forget (Supabase 실패 → log + 무시)
  - emitEvent handler 에러 시 프로세스 크래시 방지 (try/catch)
  - main.ts: isTeamMode() 시에만 bridge 생성
  - SIGTERM/SIGINT → bridge.dispose()

### T6
- **Agent**: backend
- **Title**: CLI login 명령어
- **Status**: pending
- **Priority**: 1
- **Dependencies**: T3
- **Description**: src/cli/login.ts — Supabase Auth OAuth, credentials 저장
- **Acceptance Criteria**:
  - `agent-valley login` 명령어 등록
  - OAuth 플로우 (브라우저 → 로컬 콜백)
  - ~/.agent-valley/ 디렉토리 0700
  - credentials.json 파일 0600
  - 토큰 저장 + 만료 시 갱신

### T7
- **Agent**: frontend
- **Title**: useTeamLedger hook + 단독 모드 어댑터
- **Status**: pending
- **Priority**: 1
- **Dependencies**: T1, T2
- **Description**: dashboard/src/features/team/hooks/use-team-ledger.ts — subscribe-first 패턴, Realtime 구독, replay
- **Acceptance Criteria**:
  - subscribe-first: Realtime 먼저 구독(버퍼) → SELECT → 버퍼 병합
  - TeamState 반환 + connectionStatus
  - 단독 모드: 기존 SSE를 TeamState 형태로 wrapping
  - StrictMode 이중 실행 대비

### T8
- **Agent**: frontend
- **Title**: Dashboard 팀 모드 UI 컴포넌트
- **Status**: pending
- **Priority**: 2
- **Dependencies**: T7
- **Description**: TeamHud, TeamPanel + PixiCanvas 동적 데스크 + 모드 전환
- **Acceptance Criteria**:
  - TeamHud: 온라인 수, 활성/idle 에이전트, 할당 안 된 이슈
  - TeamPanel: 팀원별 상태, 슬롯 사용률
  - PixiCanvas: 팀원별 동적 데스크 생성, 오프라인 반투명
  - page.tsx: SUPABASE_URL 유무로 팀/단독 모드 분기
