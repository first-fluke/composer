# Globe CRM — Implementation Plan

**Status**: Approved
**Date**: 2026-03-21
**Design Doc**: `docs/plans/globe-crm-design.md`

## Phase Overview

| Phase | Name | Tasks | Parallel Teams |
|---|---|---|---|
| 0 | Foundation | F-01~F-06 | Backend, Frontend, Mobile, DevOps |
| 1 | Core API + DB | A-01~A-08 | Backend |
| 2 | Web + Mobile Shell | W-01~W-03, M-01~M-03 | Frontend, Mobile |
| 3 | Features | W-04~W-09, M-04~M-07, B-01~B-02 | All |
| 4 | Graph + Integration | W-10~W-12, M-08~M-10, B-03 | All |
| 5 | Polish + Deploy | I-01~I-02, Q-01~Q-03 | DevOps, QA |

## Dependency Graph

```
Phase 0 (all parallel)
  F-01 ──┐
  F-02 ──┼── Phase 1: A-01→A-02→A-03~A-08
  F-03 ──┼── Phase 2: W-01~W-03
  F-04 ──┼── Phase 2: M-01~M-03
  F-05 ──┤
  F-06 ──┘

Phase 1+2 (max parallel)
  Backend: A-01→A-02→[A-03,A-04,A-05]→[A-06,A-07,A-08]
  Web:     W-01→W-02→W-03
  Mobile:  M-01→M-02→M-03

Phase 3 (post-API integration)
  B-01, B-02
  W-04~W-09
  M-04~M-07

Phase 4 (Graph)
  B-03→[W-10, M-08]→[W-11, M-09]→[W-12, M-10]

Phase 5 (Deploy + QA)
  I-01→I-02, Q-01~Q-03
```

## Total: 39 tasks
