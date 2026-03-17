/**
 * Linear Client — GraphQL API for startup sync.
 */

import type { Issue } from "../domain/models"
import type { LinearGraphQLResponse, LinearIssueNode } from "./types"
import { logger } from "../observability/logger"

const LINEAR_API_URL = "https://api.linear.app/graphql"

const IN_PROGRESS_QUERY = `
query GetInProgressIssues($teamId: String!, $stateId: ID!) {
  issues(
    filter: {
      team: { id: { eq: $teamId } }
      state: { id: { eq: $stateId } }
    }
    first: 50
  ) {
    nodes {
      id identifier title description url
      state { id name type }
      team { id key }
    }
  }
}
`

export async function fetchInProgressIssues(
  apiKey: string,
  teamUuid: string,
  inProgressStateId: string,
): Promise<Issue[]> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: IN_PROGRESS_QUERY,
      variables: { teamId: teamUuid, stateId: inProgressStateId },
    }),
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
    logger.warn("tracker-client", "Linear rate limit hit", { retryAfterSec: retryAfter })
    return []
  }

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`)
  }

  const result = (await response.json()) as LinearGraphQLResponse

  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join("; ")
    throw new Error(`Linear GraphQL error: ${msg}`)
  }

  const nodes = result.data?.issues?.nodes ?? []
  logger.info("tracker-client", `Startup sync: found ${nodes.length} in-progress issues`)

  return nodes.map(nodeToIssue)
}

function nodeToIssue(node: LinearIssueNode): Issue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description,
    url: node.url,
    status: node.state,
    team: node.team,
  }
}
