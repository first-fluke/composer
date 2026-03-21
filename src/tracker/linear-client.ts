/**
 * Linear Client — GraphQL API for issue queries and mutations.
 */

import { parseScoreFromLabels } from "../domain/models"
import type { Issue } from "../domain/models"
import type { LinearGraphQLResponse, LinearTeamIssuesData, LinearMutationData, LinearIssueNode } from "./types"
import { linearTeamIssuesDataSchema } from "./types"
import { logger } from "../observability/logger"

const LINEAR_API_URL = "https://api.linear.app/graphql"

// ── GraphQL Helper ──────────────────────────────────────────────────

async function linearGraphQL<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (response.status === 401) {
    throw new Error(
      "Linear API authentication failed.\n" +
      "  Fix: Check LINEAR_API_KEY in .env\n" +
      "  Ensure it starts with lin_api_"
    )
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After") ?? "60"
    throw new Error(`Linear rate limit hit. Retry after ${retryAfter}s`)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Linear API error: ${response.status} ${response.statusText}\n  Body: ${body}`)
  }

  const result = (await response.json()) as LinearGraphQLResponse<T>

  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join("; ")
    throw new Error(`Linear GraphQL error: ${msg}`)
  }

  return result.data as T
}

// ── Queries ─────────────────────────────────────────────────────────

const ISSUES_BY_STATE_QUERY = `
query GetIssuesByState($teamId: String!, $stateIds: [ID!]!, $cursor: String) {
  team(id: $teamId) {
    issues(
      filter: {
        state: { id: { in: $stateIds } }
      }
      first: 50
      after: $cursor
    ) {
      nodes {
        id identifier title description url
        state { id name type }
        team { id key }
        labels { nodes { name } }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`

export async function fetchIssuesByState(
  apiKey: string,
  teamUuid: string,
  stateIds: string[],
): Promise<Issue[]> {
  const allIssues: Issue[] = []
  let cursor: string | null = null

  do {
    const data = await linearGraphQL<LinearTeamIssuesData>(
      apiKey,
      ISSUES_BY_STATE_QUERY,
      { teamId: teamUuid, stateIds, cursor },
    )

    const parsed = linearTeamIssuesDataSchema.safeParse(data)
    if (!parsed.success) {
      throw new Error(`Linear API response validation failed: ${parsed.error.message}`)
    }

    const issues = parsed.data?.team?.issues
    const nodes = issues?.nodes ?? []
    allIssues.push(...nodes.map(nodeToIssue))

    cursor = issues?.pageInfo?.hasNextPage ? (issues.pageInfo.endCursor ?? null) : null
  } while (cursor)

  logger.info("tracker-client", `Fetched ${allIssues.length} issues for states`, { stateIds: stateIds.join(",") })

  return allIssues
}

const ISSUE_LABELS_QUERY = `
query GetIssueLabels($issueId: String!) {
  issue(id: $issueId) {
    labels { nodes { name } }
  }
}
`

export async function fetchIssueLabels(
  apiKey: string,
  issueId: string,
): Promise<string[]> {
  const data = await linearGraphQL<{ issue?: { labels?: { nodes: Array<{ name: string }> } } }>(
    apiKey,
    ISSUE_LABELS_QUERY,
    { issueId },
  )
  return data?.issue?.labels?.nodes?.map((l) => l.name) ?? []
}

// ── Mutations ───────────────────────────────────────────────────────

const UPDATE_ISSUE_STATE_MUTATION = `
mutation UpdateIssueState($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    success
  }
}
`

export async function updateIssueState(
  apiKey: string,
  issueId: string,
  stateId: string,
): Promise<void> {
  const data = await linearGraphQL<LinearMutationData>(
    apiKey,
    UPDATE_ISSUE_STATE_MUTATION,
    { issueId, stateId },
  )

  if (!data?.issueUpdate?.success) {
    throw new Error(`Failed to update issue state: issueId=${issueId}, stateId=${stateId}`)
  }
}

const ADD_COMMENT_MUTATION = `
mutation AddIssueComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}
`

export async function addIssueComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<void> {
  const data = await linearGraphQL<LinearMutationData>(
    apiKey,
    ADD_COMMENT_MUTATION,
    { issueId, body },
  )

  if (!data?.commentCreate?.success) {
    throw new Error(`Failed to add comment to issue: issueId=${issueId}`)
  }
}

// ── Label Management ────────────────────────────────────────────────

const FIND_LABEL_QUERY = `
query FindLabel($teamId: String!, $name: String!) {
  issueLabels(filter: { team: { id: { eq: $teamId } }, name: { eq: $name } }) {
    nodes { id name }
  }
}
`

const CREATE_LABEL_MUTATION = `
mutation CreateLabel($teamId: String!, $name: String!) {
  issueLabelCreate(input: { teamId: $teamId, name: $name }) {
    success
    issueLabel { id }
  }
}
`

const ADD_LABEL_TO_ISSUE_MUTATION = `
mutation AddLabelToIssue($issueId: String!, $labelIds: [String!]!) {
  issueUpdate(id: $issueId, input: { labelIds: $labelIds }) {
    success
  }
}
`

/**
 * Add a label to an issue by name. Creates the label on-demand if it doesn't exist.
 * Failures are logged but not thrown — label attachment is non-critical for routing.
 */
export async function addIssueLabel(
  apiKey: string,
  teamId: string,
  issueId: string,
  labelName: string,
): Promise<void> {
  try {
    // Find existing label
    const findData = await linearGraphQL<{
      issueLabels?: { nodes: Array<{ id: string; name: string }> }
    }>(apiKey, FIND_LABEL_QUERY, { teamId, name: labelName })

    let labelId = findData?.issueLabels?.nodes?.[0]?.id

    // Create label if not found
    if (!labelId) {
      const createData = await linearGraphQL<{
        issueLabelCreate?: { success: boolean; issueLabel?: { id: string } }
      }>(apiKey, CREATE_LABEL_MUTATION, { teamId, name: labelName })

      labelId = createData?.issueLabelCreate?.issueLabel?.id
      if (!labelId) {
        logger.warn("tracker-client", `Failed to create label "${labelName}" for issue ${issueId}`)
        return
      }
    }

    // Fetch current labels to preserve them
    const currentLabels = await fetchIssueLabelsById(apiKey, issueId)
    const allLabelIds = [...new Set([...currentLabels, labelId])]

    // Attach label to issue
    await linearGraphQL<LinearMutationData>(
      apiKey,
      ADD_LABEL_TO_ISSUE_MUTATION,
      { issueId, labelIds: allLabelIds },
    )

    logger.info("tracker-client", `Added label "${labelName}" to issue ${issueId}`)
  } catch (err) {
    logger.warn("tracker-client", `Failed to add label "${labelName}" to issue ${issueId}: ${(err as Error).message}`)
  }
}

const ISSUE_LABEL_IDS_QUERY = `
query GetIssueLabelIds($issueId: String!) {
  issue(id: $issueId) {
    labels { nodes { id } }
  }
}
`

async function fetchIssueLabelsById(apiKey: string, issueId: string): Promise<string[]> {
  const data = await linearGraphQL<{ issue?: { labels?: { nodes: Array<{ id: string }> } } }>(
    apiKey,
    ISSUE_LABEL_IDS_QUERY,
    { issueId },
  )
  return data?.issue?.labels?.nodes?.map((l) => l.id) ?? []
}

// ── Helpers ─────────────────────────────────────────────────────────

function nodeToIssue(node: LinearIssueNode): Issue {
  const labels = node.labels?.nodes?.map((l) => l.name) ?? []
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? "",
    url: node.url,
    status: node.state,
    team: node.team,
    labels,
    score: parseScoreFromLabels(labels),
  }
}
