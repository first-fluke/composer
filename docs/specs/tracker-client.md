# Tracker Client (Linear GraphQL Adapter)

> 책임: Linear GraphQL API와 통신하여 이슈를 조회한다.
> SRP: API 통신과 데이터 변환만 담당. 상태 변경은 에이전트 책임. Symphony는 이슈 상태를 쓰지 않는다.

---

## 엔드포인트

```
POST https://api.linear.app/graphql
```

---

## 인증

```
Authorization: {LINEAR_API_KEY}
Content-Type: application/json
```

`Bearer` 접두사 없이 API key를 직접 사용한다.

---

## 폴링 쿼리 — IN_PROGRESS 이슈 조회

팀의 `started` 타입 상태(IN_PROGRESS)인 이슈를 조회한다.

```graphql
query GetInProgressIssues($teamId: String!, $stateId: ID!) {
  issues(
    filter: {
      team: { id: { eq: $teamId } }
      state: { id: { eq: $stateId } }
    }
    first: 50
  ) {
    nodes {
      id
      identifier
      title
      description
      url
      state {
        id
        name
        type
      }
      team {
        id
        key
      }
    }
  }
}
```

**Variables:**
```json
{
  "teamId": "{LINEAR_TEAM_UUID}",
  "stateId": "{LINEAR_WORKFLOW_STATE_IN_PROGRESS}"
}
```

반환된 노드를 `domain-models.md`의 `Issue` 모델로 변환한다.

---

## 상태 전환 ID

Symphony는 이 ID를 **읽기 전용**으로 참조한다 (참고용).
실제 상태 변경은 에이전트가 Linear API를 직접 호출하여 수행한다.

| 상태 | ID | 설명 |
|---|---|---|
| IN_PROGRESS | `aca107fd-e3b8-4a7a-8cfe-44c2bebbeca9` | 에이전트 실행 중 |
| DONE | `5955f580-67b5-41fc-aecb-f4460926c602` | 에이전트 성공 완료 |
| CANCELLED | `72b331df-cc5b-4e4e-8a8e-a3128be7855d` | 에이전트 실패 또는 취소 |

**상태 전환 주체:**

```
에이전트 시작 → IN_PROGRESS  (에이전트가 설정)
에이전트 성공 → DONE         (에이전트가 설정)
에이전트 실패/취소 → CANCELLED  (에이전트가 설정)
```

Symphony(Orchestrator)는 이슈 상태를 직접 변경하지 않는다.

---

## 신뢰 수준

| 데이터 소스 | 신뢰 수준 | 처리 방법 |
|---|---|---|
| `WORKFLOW.md` | 높음 — 신뢰 | 그대로 사용 |
| Linear API 응답 (id, status, team) | 중간 — 내부 신뢰 | 타입 검증 후 사용 |
| `Issue.title`, `Issue.description` | 낮음 — 의심 | 이스케이프 후 프롬프트에 삽입. 상세: `docs/harness/SAFETY.md` |

---

## 에러 처리

### Rate Limit (HTTP 429)

```
1. 응답 헤더에서 Retry-After 값 확인
2. Retry-After가 없으면 exponential backoff 적용:
   - 1차: 1초
   - 2차: 2초
   - 3차: 4초
   - ...최대 60초까지
3. 최대 재시도 횟수(5회) 초과 시 경고 로그 후 다음 폴링 사이클까지 대기
```

### 인증 실패 (HTTP 401)

```
즉시 중단 (재시도 없음).
에러 로그: "Linear API authentication failed. Check LINEAR_API_KEY in .env"
프로세스 종료 (exit code 1)
```

### 네트워크 오류 (타임아웃, 연결 거부)

```
exponential backoff로 재시도.
3회 연속 실패 시 warn 레벨 로그.
10회 연속 실패 시 error 레벨 로그 + Orchestrator에게 degraded 상태 신호.
```

### GraphQL 에러

```
errors 배열 확인.
인증 관련 에러 → 즉시 중단.
그 외 → 로그 기록 후 다음 폴링 사이클에서 재시도.
```

---

## 인터페이스 요약

```
TrackerClient {
  fetchInProgressIssues() → Issue[]
  // 현재 IN_PROGRESS 상태 이슈 전체 목록 반환
  // 에러 시 예외 발생 (상위 컴포넌트가 처리)
}
```

의존 설정: `Config.tracker` (url, apiKey, teamUuid), `Config.workflowStates.inProgress`
