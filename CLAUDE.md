# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Claude Code Sub-agents

When working on this project, use these specialized sub-agents:
- @.claude/agents/symphony-architect.md — for architecture decisions, SPEC design
- @.claude/agents/symphony-implementer.md — for feature implementation
- @.claude/agents/symphony-reviewer.md — for code review

## What This Project Is

Globe CRM — a polyglot monorepo for customer relationship management. Orchestrated by Symphony (agent dispatch via Linear webhooks).

**Stack:** Next.js 16 frontend, Python 3.12 backend (planned), Flutter 3 mobile (planned), PostgreSQL 16 + PostGIS, Redis 7, MinIO, Terraform 1.x infra.

## Commands

```bash
# Pin tool versions (Node 22, Python 3.12, Flutter 3, Terraform 1.x)
mise install

# Start local services (PostgreSQL, Redis, MinIO)
docker compose up -d

# Install JS dependencies
npm install

# Run the Symphony orchestrator
node --import ./src/main.ts

# Validate architecture (secret detection, layer violations, forbidden patterns)
./scripts/harness/validate.sh

# Bootstrap dev environment
./scripts/dev.sh

# Lint/format JS/TS
npx @biomejs/biome check .
npx @biomejs/biome check --write .

# Type-check
tsc --noEmit
```

## Monorepo Layout

```
dashboard/           Next.js 16 monitoring dashboard
src/                 Symphony orchestrator (agent dispatch)
docs/                Architecture specs, guides, harness docs
scripts/             Dev tooling (install, validate, gc)
```

## Architecture (Symphony Orchestrator)

Clean architecture layers — dependencies point downward only:

```
Presentation   src/server/          HTTP endpoints (/webhook, /status, /health)
     ↓
Application    src/orchestrator/    Orchestrator (state machine), AgentRunnerService, RetryQueue
     ↓
Domain         src/domain/          Pure types: Issue, Workspace, RunAttempt
     ↓
Infrastructure src/tracker/         Linear GraphQL client + webhook HMAC
               src/workspace/       Git worktree lifecycle
               src/sessions/        AgentSession implementations (Claude, Codex, Gemini)
               src/config/          Zod config + WORKFLOW.md parser
               src/observability/   Structured logger
```

**Key invariant:** Orchestrator is the single authority for in-memory runtime state. No other component mutates it.

## Backing Services

| Service | Port | Credentials |
|---|---|---|
| PostgreSQL + PostGIS | 5432 | `globe:globe` / db: `globe_crm` |
| Redis | 6379 | no auth |
| MinIO (S3) | 9000 (API) / 9001 (Console) | `minioadmin:minioadmin` |

## Architecture Constraints

Defined in `docs/architecture/CONSTRAINTS.md`. Key rules:
- Domain layer must have zero imports from other layers
- No business logic in routers or infrastructure
- Max 500 lines per file
- No shared mutable state outside Orchestrator
- Error messages must be actionable (include variable name + fix instructions)

## Reference Docs

- `docs/specs/` — Symphony component interface specs
- `docs/architecture/LAYERS.md` — Dependency direction rules
- `docs/architecture/CONSTRAINTS.md` — Forbidden patterns
- `docs/stacks/` — Stack-specific patterns (TypeScript, Python, Go)
- `docs/harness/SAFETY.md` — Security rules
