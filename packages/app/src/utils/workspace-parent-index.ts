import type { Agent } from "@/stores/session-store";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

type ParentIndexAgent = Pick<Agent, "id" | "parentAgentId" | "workspaceId" | "archivedAt">;

/**
 * Maps a workspace to the workspace whose agent launched it, keyed by normalized workspace ID.
 *
 * A workspace is a child only when every live agent in it was launched from one other workspace.
 * One agent the user started there themselves makes the workspace theirs, so it stays a root.
 * Subagents that share their parent's workspace are not rows and never make a workspace a child.
 *
 * The daemon records parentage on agents, not workspaces, so the link disappears with the child's
 * agents: a workspace whose agents were all archived goes back to being a root.
 */
export function buildWorkspaceParentIndex(
  agents: ReadonlyMap<string, ParentIndexAgent>,
  previous?: ReadonlyMap<string, string>,
): Map<string, string> {
  const parentsByWorkspaceId = new Map<string, Set<string>>();
  const ownedWorkspaceIds = new Set<string>();

  for (const agent of agents.values()) {
    if (agent.archivedAt) continue;
    const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
    if (!workspaceId) continue;
    if (!agent.parentAgentId) {
      ownedWorkspaceIds.add(workspaceId);
      continue;
    }
    const parentWorkspaceId = normalizeWorkspaceOpaqueId(
      agents.get(agent.parentAgentId)?.workspaceId,
    );
    // A parent this client can't see yet tells us nothing; a parent in the same workspace makes
    // this an in-workspace subagent, which leaves the row's ownership to its root agent.
    if (!parentWorkspaceId || parentWorkspaceId === workspaceId) continue;
    let parents = parentsByWorkspaceId.get(workspaceId);
    if (!parents) {
      parents = new Set();
      parentsByWorkspaceId.set(workspaceId, parents);
    }
    parents.add(parentWorkspaceId);
  }

  const index = new Map<string, string>();
  for (const [workspaceId, parents] of parentsByWorkspaceId) {
    if (ownedWorkspaceIds.has(workspaceId) || parents.size !== 1) continue;
    const [parentWorkspaceId] = parents;
    if (parentWorkspaceId) index.set(workspaceId, parentWorkspaceId);
  }

  if (previous && areWorkspaceParentIndexesEqual(previous, index)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return index;
}

function areWorkspaceParentIndexesEqual(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [workspaceId, parentWorkspaceId] of next) {
    if (previous.get(workspaceId) !== parentWorkspaceId) return false;
  }
  return true;
}
