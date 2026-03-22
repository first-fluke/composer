/**
 * Node ID generation — "{username}:{hostname}" format.
 * Used to uniquely identify a local orchestrator instance.
 */

import { hostname, userInfo } from "node:os"

export function generateNodeId(): string {
  const user = userInfo().username
  const machine = hostname()
    .toLowerCase()
    .replace(/\.local$/, "")
  return `${user}:${machine}`
}
