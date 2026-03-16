---
name: symphony-scaffold
description: Guides creation of a new Symphony implementation from scratch for a chosen stack (TypeScript/Python/Go). Use when user asks to "scaffold symphony", "create new symphony project", or "initialize symphony for [stack]".
---

# Symphony Scaffold

## When to use

- User asks to scaffold a new Symphony implementation
- User wants to start a new Symphony project from scratch
- User asks to initialize Symphony for a specific stack (TypeScript, Python, or Go)

## When NOT to use

- Implementing a single component in an existing project -> use Symphony Component skill
- Checking conformance of an existing implementation -> use Symphony Conformance skill

## Steps

### 1. Confirm target stack

Ask the user to confirm which stack they are targeting:
- TypeScript
- Python
- Go

Do not proceed until the stack is confirmed.

### 2. Read the stack guide

Read the appropriate stack guide before writing any files:

```
docs/stacks/typescript.md   (for TypeScript)
docs/stacks/python.md       (for Python)
docs/stacks/go.md           (for Go)
```

### 3. Create directory structure per LAYERS.md

Read `docs/architecture/LAYERS.md` and create the four-layer directory structure:

```
src/
├── domain/          <- Issue, Workspace, RunAttempt domain models
├── application/     <- Orchestrator, WorkspaceManager
├── infrastructure/  <- LinearApiClient, FileSystem, Git, Logger
└── presentation/    <- CLI entrypoint, HTTP handler (if applicable)
```

Adapt directory names to the stack's idiomatic conventions (e.g., `cmd/` for Go).

### 4. Set up config loading per stack guide

- Create `.env.example` with all required variables from `AGENTS.md` § Build & Test
- Implement typed config loading that fails fast with a clear error message listing missing variables and where to set them
- Reference the stack guide for the idiomatic config pattern

### 5. Create skeleton implementations of all 7 Symphony components

Create skeleton files for each component. Each file must compile/parse without errors but may leave method bodies as stubs. Reference the component specs:

| Component | Spec |
|---|---|
| Workflow Loader | `docs/specs/workflow-loader.md` |
| Config Layer | `docs/specs/config-layer.md` |
| Issue Tracker Client | `docs/specs/tracker-client.md` |
| Orchestrator | `docs/specs/orchestrator.md` |
| Workspace Manager | `docs/specs/workspace-manager.md` |
| Agent Runner | `docs/specs/agent-runner.md` |
| Observability | `docs/specs/observability.md` |

### 6. Set up linter config

Read the enforcement guide for the chosen stack and create the linter config file:

```
docs/architecture/enforcement/typescript.md
docs/architecture/enforcement/python.md
docs/architecture/enforcement/go.md
```

Install required tools as described in the guide. Add a pre-commit hook that runs `./scripts/harness/validate.sh`.

### 7. Verify with validate.sh

Run `./scripts/harness/validate.sh` and confirm all checks pass. Fix any errors before declaring the scaffold complete.

## References

- `docs/stacks/` — stack-specific setup guides
- `docs/specs/` — Symphony component interface specs
- `docs/architecture/LAYERS.md` — dependency direction rules
- `docs/architecture/CONSTRAINTS.md` — forbidden patterns
- `docs/architecture/enforcement/` — linter config per stack
- `AGENTS.md` — conventions and required environment variables
