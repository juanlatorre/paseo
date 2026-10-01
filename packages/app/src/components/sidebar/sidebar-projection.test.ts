import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection } from "./sidebar-projection";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    parentWorkspaceKey: null,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: {
  groupMode?: "project" | "status";
  pinnedCollapsed?: boolean;
}) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
    expandedWorkspaceFamilyKeys: new Set<string>(),
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: "project" | "status") {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});

function workspaceGroupNames(projection: ReturnType<typeof buildSidebarProjection>) {
  return projection.workspaceGroups.map((group) => [group.key, group.rows.map((row) => row.name)]);
}

function projectWorkspaceIds(projection: ReturnType<typeof buildSidebarProjection>) {
  return projection.pinnedGroups.unpinnedProjects.map((project) => [
    project.viewKey,
    project.workspaces.map((workspace) => workspace.workspaceId),
  ]);
}

describe("buildSidebarProjection workspace families", () => {
  function familyInput(options: {
    groupMode: "project" | "status";
    expanded?: boolean;
    childStatus?: SidebarWorkspaceEntry["statusBucket"];
    pinChild?: boolean;
  }) {
    const parent = makeWorkspace("plan", "running", [], "kore");
    const child = makeWorkspace("insha-773", options.childStatus ?? "done", [], "kore");
    const crossProjectChild = makeWorkspace("sira-web", "done", [], "sira-web");
    child.entry.parentWorkspaceKey = parent.entry.workspaceKey;
    crossProjectChild.entry.parentWorkspaceKey = parent.entry.workspaceKey;
    const pinnedKeys = options.pinChild ? [child.entry.workspaceKey] : [];
    return {
      projects: [
        makeProject([parent.placement, child.placement], "kore"),
        makeProject([crossProjectChild.placement], "sira-web"),
      ],
      pinnedKeys: {
        pinnedWorkspaceKeys: pinnedKeys,
        pinnedAtByKey: Object.fromEntries(pinnedKeys.map((key) => [key, "2026-07-12T12:00:00Z"])),
      },
      pinnedWorkspaceOrder: [],
      workspaceEntriesByKey: new Map(
        [parent, child, crossProjectChild].map(({ entry }) => [entry.workspaceKey, entry]),
      ),
      projectNamesByViewKey: new Map([
        ["kore", "kore"],
        ["sira-web", "sira-web"],
      ]),
      groupMode: options.groupMode,
      pinnedCollapsed: false,
      collapsedProjectKeys: new Set<string>(),
      collapsedWorkspaceGroupKeys: new Set<string>(),
      expandedWorkspaceFamilyKeys: new Set(options.expanded ? [parent.entry.workspaceKey] : []),
    };
  }

  it("folds child workspaces under their parent in status mode", () => {
    const projection = buildSidebarProjection(familyInput({ groupMode: "status" }));

    expect(workspaceGroupNames(projection)).toEqual([["running", ["plan"]]]);
    expect(
      projection.families.childrenByParentKey.get("srv:plan")?.map((child) => child.name),
    ).toEqual(["insha-773", "sira-web"]);
  });

  it("lifts the parent into the most urgent status among its children", () => {
    const projection = buildSidebarProjection(
      familyInput({ groupMode: "status", childStatus: "needs_input" }),
    );

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
  });

  it("moves a child out of its own project in project mode", () => {
    const projection = buildSidebarProjection(familyInput({ groupMode: "project" }));

    expect(projectWorkspaceIds(projection)).toEqual([
      ["kore", ["plan"]],
      ["sira-web", []],
    ]);
  });

  it("counts children in keyboard shortcuts only while the family is expanded", () => {
    const shortcutKeys = (expanded: boolean) => [
      ...buildSidebarProjection(
        familyInput({ groupMode: "status", expanded }),
      ).shortcutModel.shortcutIndexByWorkspaceKey.keys(),
    ];

    expect(shortcutKeys(false)).toEqual(["srv:plan"]);
    expect(shortcutKeys(true)).toEqual(["srv:plan", "srv:insha-773", "srv:sira-web"]);
  });

  it("leaves a pinned child pinned", () => {
    const projection = buildSidebarProjection(familyInput({ groupMode: "status", pinChild: true }));

    expect(projection.pinnedGroups.pinnedChats.map((workspace) => workspace.workspaceId)).toEqual([
      "insha-773",
    ]);
    expect(
      projection.families.childrenByParentKey.get("srv:plan")?.map((child) => child.name),
    ).toEqual(["sira-web"]);
  });
});
