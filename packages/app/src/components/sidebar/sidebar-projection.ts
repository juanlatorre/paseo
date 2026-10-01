import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import {
  resolveSidebarProjectIconTargets,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";
import { statusWorkspaceGroups, type SidebarWorkspaceGroup } from "./sidebar-labels";
import {
  buildSidebarWorkspaceFamilies,
  getSidebarWorkspaceChildren,
  withFamilyStatus,
  type SidebarWorkspaceFamilies,
} from "./sidebar-workspace-families";

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  workspaceGroups: SidebarWorkspaceGroup[];
  /**
   * The project icons this projection needs fetched, keyed by `projectViewKey` — one per project,
   * whatever the mode groups by. It sits here rather than beside `useProjectIcons` in the list
   * because it is the same `projects` the rows above are projected from: a mode that renders a
   * row can only ever ask for an icon this list already covers. It used to be derived in the
   * list, under a `groupMode === "status"` gate written when status was the only mode that put
   * icons on rows.
   */
  projectIconTargets: SidebarProjectIconTarget[];
  shortcutModel: SidebarShortcutModel;
  /** Child workspaces folded under the workspace that launched them, in every mode. */
  families: SidebarWorkspaceFamilies;
}

export interface SidebarProjectionInput {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
  expandedWorkspaceFamilyKeys: ReadonlySet<string>;
}

export function buildSidebarProjection(input: SidebarProjectionInput): SidebarProjection {
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const families = buildSidebarWorkspaceFamilies({
    workspaceEntriesByKey: input.workspaceEntriesByKey,
    pinnedWorkspaceKeys,
  });
  const pinnedGroups = splitPinnedSidebarGroups({
    projects: withoutNestedWorkspaces(input.projects, families),
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
  });
  const unpinnedWorkspaces: SidebarWorkspaceEntry[] = [];
  for (const workspace of input.workspaceEntriesByKey.values()) {
    if (pinnedWorkspaceKeys.has(workspace.workspaceKey)) continue;
    if (families.nestedKeys.has(workspace.workspaceKey)) continue;
    unpinnedWorkspaces.push(withFamilyStatus(workspace, families));
  }
  // One switch decides both what the list groups by and what the keyboard shortcuts walk, so the
  // two cannot disagree and a new grouping mode is a compile error here rather than a silent
  // fall-through to the project rows.
  const workspaceGroups = buildWorkspaceGroups(input, unpinnedWorkspaces);

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: withExpandedChildren(pinnedGroups.pinnedChats, families, input) });
  }
  if (input.groupMode === "project") {
    sections.push(
      ...pinnedGroups.unpinnedProjects.map((project) => ({
        workspaces: withExpandedChildren(project.workspaces, families, input),
        collapsed: input.collapsedProjectKeys.has(project.viewKey),
      })),
    );
  } else {
    sections.push(
      ...workspaceGroups.map((group) => ({
        workspaces: withExpandedChildren(group.rows, families, input),
        collapsed: input.collapsedWorkspaceGroupKeys.has(group.key),
      })),
    );
  }

  return {
    pinnedGroups,
    workspaceGroups,
    projectIconTargets: resolveSidebarProjectIconTargets(input.projects),
    shortcutModel: buildSidebarShortcutSections({ sections }),
    families,
  };
}

/**
 * A child lives in its parent's family, whichever project it belongs to, so it leaves its own
 * project's list. The project keeps its header even when every workspace in it moved out.
 */
function withoutNestedWorkspaces(
  projects: SidebarProjectEntry[],
  families: SidebarWorkspaceFamilies,
): SidebarProjectEntry[] {
  if (families.nestedKeys.size === 0) return projects;
  return projects.map((project) => {
    const workspaces = project.workspaces.filter(
      (workspace) => !families.nestedKeys.has(workspace.workspaceKey),
    );
    return workspaces.length === project.workspaces.length ? project : { ...project, workspaces };
  });
}

/** Keyboard shortcuts walk the rows on screen, so expanded children count in display order. */
function withExpandedChildren<T extends SidebarWorkspacePlacement>(
  workspaces: readonly T[],
  families: SidebarWorkspaceFamilies,
  input: SidebarProjectionInput,
): SidebarWorkspacePlacement[] {
  return workspaces.flatMap((workspace) =>
    input.expandedWorkspaceFamilyKeys.has(workspace.workspaceKey)
      ? [workspace, ...getSidebarWorkspaceChildren(families, workspace.workspaceKey)]
      : [workspace],
  );
}

/** Project mode keeps its project headers and groups nothing; status mode groups the rows. */
function buildWorkspaceGroups(
  input: SidebarProjectionInput,
  unpinnedWorkspaces: SidebarWorkspaceEntry[],
): SidebarWorkspaceGroup[] {
  switch (input.groupMode) {
    case "project":
      return [];
    case "status":
      return statusWorkspaceGroups(
        buildStatusGroups(unpinnedWorkspaces, input.projectNamesByViewKey),
      );
  }
}
