import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { aggregateSidebarStateBuckets } from "@/utils/sidebar-agent-state";

export interface SidebarWorkspaceFamilies {
  /** Child workspaces under the root of their family, in display order. */
  childrenByParentKey: ReadonlyMap<string, readonly SidebarWorkspaceEntry[]>;
  /** Every workspace that renders under a parent instead of as a row of its own. */
  nestedKeys: ReadonlySet<string>;
}

const EMPTY_CHILDREN: readonly SidebarWorkspaceEntry[] = [];

export const EMPTY_SIDEBAR_WORKSPACE_FAMILIES: SidebarWorkspaceFamilies = {
  childrenByParentKey: new Map(),
  nestedKeys: new Set(),
};

/**
 * Folds workspaces launched by another workspace's agent under that workspace.
 *
 * Grandchildren fold into the topmost visible ancestor so a family is one level deep: the
 * orchestrator you review is the row, everything it spawned is behind its chevron. A parent
 * that is filtered out or not loaded leaves its children as rows of their own, and a pinned
 * child stays pinned: pinning is an explicit request to see that row.
 */
export function buildSidebarWorkspaceFamilies(input: {
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  pinnedWorkspaceKeys: ReadonlySet<string>;
}): SidebarWorkspaceFamilies {
  const { workspaceEntriesByKey, pinnedWorkspaceKeys } = input;
  const childrenByParentKey = new Map<string, SidebarWorkspaceEntry[]>();
  const nestedKeys = new Set<string>();

  for (const entry of workspaceEntriesByKey.values()) {
    if (!entry.parentWorkspaceKey || pinnedWorkspaceKeys.has(entry.workspaceKey)) continue;
    const rootKey = resolveFamilyRootKey(entry, workspaceEntriesByKey);
    if (!rootKey) continue;
    nestedKeys.add(entry.workspaceKey);
    const children = childrenByParentKey.get(rootKey);
    if (children) {
      children.push(entry);
    } else {
      childrenByParentKey.set(rootKey, [entry]);
    }
  }

  if (nestedKeys.size === 0) return EMPTY_SIDEBAR_WORKSPACE_FAMILIES;
  for (const children of childrenByParentKey.values()) {
    children.sort(
      (a, b) => a.name.localeCompare(b.name) || a.workspaceKey.localeCompare(b.workspaceKey),
    );
  }
  return { childrenByParentKey, nestedKeys };
}

function resolveFamilyRootKey(
  entry: SidebarWorkspaceEntry,
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
): string | null {
  const visited = new Set([entry.workspaceKey]);
  let rootKey: string | null = null;
  let parentKey = entry.parentWorkspaceKey;
  while (parentKey && !visited.has(parentKey)) {
    const parent = workspaceEntriesByKey.get(parentKey);
    if (!parent) break;
    visited.add(parentKey);
    rootKey = parentKey;
    parentKey = parent.parentWorkspaceKey;
  }
  // A cycle has no orchestrator to fold into; leave every member as a row.
  if (parentKey && visited.has(parentKey)) return null;
  return rootKey;
}

export function getSidebarWorkspaceChildren(
  families: SidebarWorkspaceFamilies,
  workspaceKey: string,
): readonly SidebarWorkspaceEntry[] {
  return families.childrenByParentKey.get(workspaceKey) ?? EMPTY_CHILDREN;
}

/**
 * The family's row stands for its children while they are folded away, so it carries the most
 * urgent status among them: a child waiting on a permission lifts its parent into Needs input.
 */
export function withFamilyStatus(
  entry: SidebarWorkspaceEntry,
  families: SidebarWorkspaceFamilies,
): SidebarWorkspaceEntry {
  const children = families.childrenByParentKey.get(entry.workspaceKey);
  if (!children) return entry;
  const statusBucket = aggregateSidebarStateBuckets([
    entry.statusBucket,
    ...children.map((child) => child.statusBucket),
  ]);
  return statusBucket === entry.statusBucket ? entry : { ...entry, statusBucket };
}
