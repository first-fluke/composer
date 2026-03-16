---
name: symphony-component
description: Implements one of the 7 Symphony components (Workflow Loader, Config Layer, Tracker Client, Orchestrator, Workspace Manager, Agent Runner, Observability). Use when user asks to "implement [component name]", "build orchestrator", or "add tracker client".
---

# Symphony Component

## When to use

- User asks to implement a named Symphony component
- User asks to build, add, or complete a specific component (e.g., "build the orchestrator", "add tracker client", "implement workspace manager")

## When NOT to use

- Starting a brand-new project from scratch -> use Symphony Scaffold skill
- Auditing or checking conformance -> use Symphony Conformance skill

## Steps

### 1. Read the component spec

Identify which of the 7 components is being requested and read its spec:

| Component | Spec file |
|---|---|
| Workflow Loader | `docs/specs/workflow-loader.md` |
| Config Layer | `docs/specs/config-layer.md` |
| Issue Tracker Client | `docs/specs/tracker-client.md` |
| Orchestrator | `docs/specs/orchestrator.md` |
| Workspace Manager | `docs/specs/workspace-manager.md` |
| Agent Runner | `docs/specs/agent-runner.md` |
| Observability | `docs/specs/observability.md` |

### 2. Read domain models

Read `docs/specs/domain-models.md` to understand the data structures the component operates on (Issue, Workspace, RunAttempt, RetryEntry, OrchestratorRuntimeState).

### 3. Check architecture layers and constraints

Read `docs/architecture/LAYERS.md` and `docs/architecture/CONSTRAINTS.md` before writing any code.

Determine which layer the component belongs to:
- Domain: pure data models and business rules, no external dependencies
- Application: Orchestrator, WorkspaceManager — coordinate domain objects via interfaces
- Infrastructure: LinearApiClient, FileSystem, Git, Logger — concrete external-system adapters
- Presentation: CLI entrypoint, HTTP handler

Ensure the implementation does not introduce any dependency direction violations.

### 4. Implement following clean architecture pattern

Read `AGENTS.md` § Conventions before writing any code.

Rules:
- Domain layer must not import from Application, Infrastructure, or Presentation
- Application layer accesses Infrastructure only through interfaces (dependency inversion)
- Infrastructure layer implements Domain interfaces; no business decisions
- No secrets in code — all credentials come from environment variables via Config Layer
- Validate external inputs at the boundary (issue body, API responses, env vars); trust internal objects

Use the stack-idiomatic patterns from `docs/stacks/{stack}.md`.

### 5. Write unit tests

Write tests alongside the implementation, not after. Coverage must include:
- Happy path
- Boundary conditions
- Error cases (e.g., missing config, Linear API failure, git command failure)

Place tests according to the stack's convention (co-located or in a `tests/` directory).

### 6. Verify with lint and arch check

Run the project's validation script:

```bash
./scripts/harness/validate.sh
```

Fix all lint errors and architecture violations before finishing. Do not skip the check.

## References

- `docs/specs/` — component interface specs and domain models
- `docs/architecture/LAYERS.md` — dependency direction rules
- `docs/architecture/CONSTRAINTS.md` — forbidden patterns
- `docs/architecture/enforcement/` — linter config per stack
- `docs/stacks/` — stack-specific implementation patterns
- `AGENTS.md` — conventions, golden principles, required env vars
