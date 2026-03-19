# Tracker Client (Linear GraphQL Adapter)

> Responsibility: Communicate with Linear API, parse webhook events, and convert data to domain models.
> SRP: API communication and data transformation only. State changes are the agent's responsibility. Symphony never writes issue state.

---

## Endpoint

```
POST https://api.linear.app/graphql
```

---

## Authentication

```
Authorization: {LINEAR_API_KEY}
Content-Type: application/json
```

API key is used directly without a `Bearer` prefix.

---

## Webhook Event Handling

Linear sends webhook events to the Orchestrator's `/webhook` endpoint when issue state changes.

### Webhook Payload Structure

```json
{
  "action": "update",
  "type": "Issue",
  "data": {
    "id": "issue-uuid",
    "identifier": "ACR-42",
    "title": "Issue title",
    "description": "Issue description",
    "url": "https://linear.app/...",
    "state": {
      "id": "state-uuid",
      "name": "In Progress",
      "type": "started"
    },
    "team": {
      "id": "team-uuid",
      "key": "ACR"
    }
  },
  "updatedFrom": {
    "stateId": "previous-state-uuid"
  }
}
```

### Signature Verification

Linear signs webhook payloads with HMAC-SHA256 using the webhook secret.

```
Header: Linear-Signature: <hex-encoded HMAC-SHA256>

Verification:
  expected = HMAC-SHA256(LINEAR_WEBHOOK_SECRET, raw_request_body)
  actual   = request.headers["Linear-Signature"]
  → constant-time comparison
  → mismatch: reject with 403
```

### Event Routing

```
parseWebhookEvent(payload) → WebhookEvent {
  action   : "create" | "update" | "remove"
  issueId  : string
  issue    : Issue        (converted to domain model)
  stateId  : string       (current state ID)
  prevStateId : string | null  (previous state ID, from updatedFrom)
}

Orchestrator routes by:
  stateId == Config.workflowStates.todo
    → issue moved TO Todo → transition to In Progress, start agent
  stateId == Config.workflowStates.inProgress
    → issue moved TO In Progress → start agent
  prevStateId == Config.workflowStates.inProgress && stateId != inProgress
    → issue moved OUT of In Progress → stop agent
```

---

## Startup Sync Query — Todo + In Progress Issues

On Orchestrator startup, fetch all current Todo and In Progress issues to recover missed events.

```graphql
query GetIssuesByState($teamId: String!, $stateIds: [ID!]!) {
  issues(
    filter: {
      team: { id: { eq: $teamId } }
      state: { id: { in: $stateIds } }
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
  "stateIds": ["{LINEAR_WORKFLOW_STATE_TODO}", "{LINEAR_WORKFLOW_STATE_IN_PROGRESS}"]
}
```

Convert returned nodes to the `Issue` domain model from `domain-models.md`.

---

## Workflow State IDs

| State | ID | Description |
|---|---|---|
| TODO | `{LINEAR_WORKFLOW_STATE_TODO}` | Issue ready for pickup |
| IN_PROGRESS | `{LINEAR_WORKFLOW_STATE_IN_PROGRESS}` | Agent is running |
| DONE | `{LINEAR_WORKFLOW_STATE_DONE}` | Agent completed successfully |
| CANCELLED | `{LINEAR_WORKFLOW_STATE_CANCELLED}` | Agent failed or cancelled |

**State transition authority:**

```
Todo → In Progress  (Orchestrator — work acceptance)
In Progress → Done  (Orchestrator — on agent completion + summary comment)
In Progress → Cancelled  (Orchestrator — on max retries exceeded + error comment)
```

Orchestrator manages scheduling-related state transitions (Todo→InProgress, InProgress→Done/Cancelled).
Agents focus on business logic (code writing, PR creation).

---

## Trust Levels

| Data Source | Trust Level | Handling |
|---|---|---|
| `WORKFLOW.md` | High — trusted | Use as-is |
| Linear API response (id, status, team) | Medium — internal trust | Type-validate before use |
| `Issue.title`, `Issue.description` | Low — suspect | Escape before prompt insertion. See `docs/harness/SAFETY.md` |
| Webhook payload | Medium — verify signature | Reject if signature mismatch |

---

## Error Handling

### Invalid Webhook Signature

```
Reject immediately with HTTP 403.
Warn log: "webhook signature verification failed, source={ip}"
Do not process the event.
```

### Rate Limit (HTTP 429) — Startup Sync Only

```
1. Check Retry-After header
2. If absent, apply exponential backoff: 1s, 2s, 4s, ... max 60s
3. After 5 retries, warn log and proceed with empty issue list
```

### Auth Failure (HTTP 401)

```
Halt immediately (no retry).
Error log: "Linear API authentication failed. Check LINEAR_API_KEY in .env"
Process exit (exit code 1)
```

### Network Error (timeout, connection refused)

```
Exponential backoff retry.
3 consecutive failures: warn-level log.
10 consecutive failures: error-level log + signal degraded state to Orchestrator.
```

### GraphQL Error

```
Check errors array.
Auth-related error → halt immediately.
Other → log and skip (webhook events will continue arriving).
```

---

## Mutations

### updateIssueState

```graphql
mutation UpdateIssueState($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    success
  }
}
```

Used by Orchestrator for Todo→InProgress, InProgress→Done, and InProgress→Cancelled transitions.

### addIssueComment

```graphql
mutation AddIssueComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}
```

Used for posting work summary on completion and error reports on failure.

---

## Interface Summary

```
TrackerClient {
  verifyWebhookSignature(payload: string, signature: string) → boolean
  // Verify HMAC-SHA256 signature. Return false if invalid.

  parseWebhookEvent(payload: string) → WebhookEvent
  // Parse webhook JSON into domain event. Throw on invalid format.

  fetchIssuesByState(stateIds: string[]) → Issue[]
  // Startup sync. Fetch issues in the given states (Todo + In Progress).

  updateIssueState(issueId: string, stateId: string) → void
  // Transition issue to a new workflow state.

  addIssueComment(issueId: string, body: string) → void
  // Post a comment on an issue (work summary or error report).
}
```

Config dependencies: `Config.tracker` (url, apiKey, teamUuid, webhookSecret), `Config.workflowStates`
