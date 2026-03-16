# Workspace Manager

> 책임: 이슈별 격리 작업 공간 생성, 관리, 정리.
> SRP: 디렉터리 및 git worktree 수명주기만 담당. 에이전트 실행은 `agent-runner.md` 책임.

도메인 모델: `domain-models.md` 참조 (Workspace, Workspace Key 파생 규칙).

---

## Workspace Key 파생

`Issue.identifier`에서 `[A-Za-z0-9._-]` 범위 밖의 모든 문자를 `_`로 대체한다.

```
key = identifier.replace(/[^A-Za-z0-9._-]/g, '_')
```

| 입력 (identifier) | 출력 (key) |
|---|---|
| `ACR-42` | `ACR-42` |
| `ACR 42` | `ACR_42` |
| `ACR/42` | `ACR_42` |
| `ACR#42` | `ACR_42` |
| `ACR.feature.1` | `ACR.feature.1` |

---

## 디렉터리 구조

```
{WORKSPACE_ROOT}/
└── {workspace_key}/          ← 이슈별 격리 디렉터리
    ├── .git                  ← git worktree 링크 (메인 repo와 연결)
    ├── src/                  ← 에이전트 작업 대상 코드
    └── .symphony/
        ├── attempts/         ← RunAttempt 기록 (JSON)
        └── logs/             ← 에이전트 실행 로그
```

`WORKSPACE_ROOT`는 `Config.workspace.rootPath`에서 읽는다.

---

## git worktree 연동

각 Workspace는 독립된 git worktree로 구성된다.

```
# 생성 시
git worktree add {workspace_path} -b {branch_name}

# 브랜치 이름 규칙
branch_name = "symphony/{workspace_key}"
# 예: symphony/ACR-42
```

**전제 조건:** `WORKSPACE_ROOT`의 상위 디렉터리 또는 지정된 메인 repo 경로에 git repository가 존재해야 한다.

---

## 수명주기 훅

각 훅은 Orchestrator로부터 호출된다. 훅 실패 시 에러 로그를 기록하고 상위로 전파한다.

### onCreate(issue: Issue) → Workspace

```
1. Workspace Key 파생
2. 디렉터리 생성: mkdir -p {WORKSPACE_ROOT}/{key}/.symphony/attempts
3. git worktree add {path} -b symphony/{key}
4. Workspace 객체 생성 (status: "idle")
5. 로그: workspace created for issue {identifier}
```

### onStart(workspace: Workspace) → void

```
1. workspace.status = "running"
2. 로그: workspace started for issue {identifier}
```

### onComplete(workspace: Workspace, attempt: RunAttempt) → void

```
1. workspace.status = "done"
2. RunAttempt 기록 저장: {path}/.symphony/attempts/{attempt.id}.json
3. 로그: workspace completed for issue {identifier}, exitCode: 0
```

### onFailed(workspace: Workspace, attempt: RunAttempt) → void

```
1. workspace.status = "failed"
2. RunAttempt 기록 저장 (exitCode 포함)
3. 로그: workspace failed for issue {identifier}, exitCode: {code}
```

### onCleanup(workspace: Workspace) → void

```
1. git worktree remove {path} --force
2. 디렉터리 삭제: rm -rf {path}
3. Workspace 객체 제거
4. 로그: workspace cleaned up for issue {identifier}
```

---

## 정리 정책

완료 또는 실패한 Workspace는 설정된 보관 기간 이후 자동 삭제된다.

```
보관 기간: config.workspace.retentionDays (기본: 7일)
정리 트리거: Orchestrator 폴링 루프에서 주기적으로 확인
조건: workspace.status in ["done", "failed"] AND (now - finishedAt) > retentionDays
```

**수동 정리:** `scripts/harness/gc.sh` 스크립트 참조.

---

## 인터페이스 요약

```
WorkspaceManager {
  create(issue: Issue)          → Workspace
  get(issueId: string)          → Workspace | null
  markRunning(workspace)        → void
  markDone(workspace, attempt)  → void
  markFailed(workspace, attempt)→ void
  cleanup(workspace)            → void
  listExpired()                 → Workspace[]   // 보관 기간 초과 목록
}
```

의존 설정: `Config.workspace` (rootPath, keyPattern, retentionDays)
