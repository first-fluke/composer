# SAFETY.md — Safety Rails

> Agents act fast. Without boundaries, they act fast in the wrong direction.
> Safety rails are the structure that maintains agent speed while limiting the blast radius.

---

## 1. Principle of Least Privilege

Grant agents only the minimum privileges required to perform their tasks.
The broader the privileges, the larger the blast radius of a mistake.

### File System

- An agent can only write to its own workspace directory (`{WORKSPACE_ROOT}/{key}`)
- Access to another issue's workspace path is not allowed
- Direct modification of the repository root is not allowed (only through PRs)

### Linear API

- An agent can only change the state of the issue it is responsible for
- Attempts to change another issue's state are immediately rejected + logged
- No permission to delete issues

### Git

- An agent can only push to its own branch (`issue/{key}`)
- Direct push to `main` or `master` is not allowed
- Force push is not allowed

### Secret Management

API keys and tokens must never be included in code, logs, or commits.

- All secrets are stored only in `.env` (must be registered in `.gitignore`)
- If a secret pattern is detected in agent-generated files, the commit is blocked
- `.env.example` contains only key names and descriptions, no actual values

---

## 2. Network Egress Control

If an agent calls an unapproved external service, data leakage and unpredictable side effects can occur.

### Approved Endpoints

| Service | Endpoint | Purpose |
|---|---|---|
| Linear | `https://api.linear.app/graphql` | Issue queries + state changes |
| Codex server | `localhost:{port}` (local) | Agent execution |

### Handling Unapproved External Calls

When an HTTP request is made to an unapproved endpoint:

1. Immediately block the request
2. Record in the audit log (timestamp, attempted URL, agent ID, issue key)
3. Deliver error event to the Orchestrator -> fail the corresponding RunAttempt

### Adapter Pattern

All external calls go through approved adapters.
Agents are prohibited from making direct external network calls.

```
Agent -> Issue Tracker Client (adapter) -> Linear API
Agent -> Agent Runner (adapter) -> Codex server
```

(See `AGENTS.md` Section Architecture Overview — component boundaries)

---

## 3. Prompt Injection Defense

External inputs may contain malicious instructions.
If an agent inserts issue body text directly into a prompt,
the issue author can arbitrarily manipulate agent behavior.

### Trust Level Classification

| Source | Trust Level | Reason |
|---|---|---|
| `WORKFLOW.md` | Trusted | Version-controlled, written by engineers |
| `AGENTS.md`, `docs/` | Trusted | Verified files within the repository |
| Issue body | Suspect | External input, cannot be verified |
| Issue comments | Suspect | External input, cannot be verified |
| PR description | Suspect | May be external input |

### Defense Rules

**Prohibited:** Inserting external input directly into prompts

```python
# Dangerous — prohibited
prompt = f"Process the following issue: {issue.description}"

# Safe — escape or pass as structured fields
prompt = build_prompt(issue_id=issue.id, title=issue.title)
```

**Implementation Rules:**

1. Issue body is passed to prompts only as structured fields (`issue.id`, `issue.title`)
2. Free-text fields must be escaped and isolated in a sandboxed area
3. Values extracted from issue body must not be interpreted as system instructions
4. Validate once at the entry point; internal components are trusted (see `AGENTS.md` Section Conventions — validate at the boundary)

---

## 4. Audit Logs

All agent actions must be traceable.
Without audit logs, it is impossible to determine the cause when problems occur.

### What to Record

- File writes (path, issue key)
- API calls (endpoint, method, response code)
- Issue state changes (previous state -> new state)
- Branch pushes
- Network blocking events

### Log Format

```json
{
  "ts": "2026-03-16T10:00:00Z",
  "level": "info",
  "event": "agent.action",
  "agent_id": "codex-worker-1",
  "issue_key": "ACR-42",
  "workspace": "/workspaces/ACR-42",
  "action": "api.call",
  "endpoint": "https://api.linear.app/graphql",
  "operation": "issueUpdate",
  "result": "success"
}
```

- Format: JSON (one line = one event)
- Timestamp: ISO 8601 (UTC)
- Structured log specification details: `docs/specs/observability.md`

### Retention Policy

- Minimum 30-day retention
- Cannot be deleted (append-only)
- Must never contain secrets (API keys, tokens)

---

## References

- `AGENTS.md` Section Security — security principles summary
- `AGENTS.md` Section Conventions — validate at the boundary principle
- `docs/specs/observability.md` — structured log specification
- `docs/harness/LEGIBILITY.md` — ephemeral observability stack
