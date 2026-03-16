---
name: harness-gc
description: Runs the harness garbage collection to clean up stale worktrees and branches. Use when user asks to "run gc", "clean up worktrees", "harness cleanup", or "gc".
---

# Harness GC

## When to use

- User asks to run GC, garbage collection, or cleanup
- Stale worktrees or branches are accumulating
- Routine maintenance after a batch of issues have been completed and merged

## When NOT to use

- Implementing features or components — this skill only performs cleanup
- Checking SPEC conformance -> use Symphony Conformance skill

## Safety rules

- Always run dry-run first. Never delete without showing the user what will be removed.
- Never delete the `main` or `master` branch.
- Never delete a worktree whose branch has an open PR.
- GC follows soft-delete: flag first, delete on the next confirmed cycle. Unreferenced utilities are never auto-deleted — flag them and ask the user.

## Steps

### 1. Show current stale worktrees (dry run)

Run the GC script in dry-run mode to list what would be cleaned without making any changes:

```bash
./scripts/harness/gc.sh --dry-run
```

If the script does not support `--dry-run`, manually inspect and list:
- Worktrees whose associated PR has been merged
- Branches with no commits in the last 30 days
- Worktrees in `done` or `failed` status beyond `config.workspace.retentionDays`

Show the user the full list before proceeding.

### 2. Ask confirmation before deleting

Present the dry-run output to the user and ask:

> The following worktrees and branches will be removed. Confirm to proceed? (yes / no)

Do not proceed if the user does not confirm. If the user says no, stop and report that no changes were made.

### 3. Run gc.sh

After confirmation, run the GC script:

```bash
./scripts/harness/gc.sh
```

GC targets per `docs/harness/ENTROPY.md`:

| Target | Criteria | Action |
|---|---|---|
| Completed worktrees | PR merged, worktree still present | `git worktree remove` |
| Stale branches | Last commit > 30 days ago | `git branch -d` (local and remote) |
| Unreferenced utilities | No import references + > 30 days old | Flag only — do not delete, ask user |

### 4. Report what was cleaned

After the script completes, report:

```
Harness GC Complete
===================
Worktrees removed: N
  - symphony/ACR-42
  - symphony/ACR-55

Branches deleted: N
  - symphony/ACR-42 (local + remote)
  - symphony/ACR-55 (local)

Flagged for review (not deleted):
  - src/utils/legacyParser.ts — no import references since 2024-02-01

Nothing else was changed.
```

If the script produced errors, report them with the full error message and suggested remediation.

## References

- `scripts/harness/gc.sh` — GC script
- `docs/harness/ENTROPY.md` — GC targets, soft-delete policy, run schedule
- `docs/harness/LEGIBILITY.md` — worktree lifecycle
- `docs/specs/workspace-manager.md` — retention policy (`config.workspace.retentionDays`)
- `.github/workflows/harness-gc.yml` — automated weekly GC workflow
