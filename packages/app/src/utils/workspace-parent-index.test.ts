import { describe, expect, it } from "vitest";
import { buildWorkspaceParentIndex } from "./workspace-parent-index";

function agent(input: {
  id: string;
  workspaceId: string;
  parentAgentId?: string;
  archived?: boolean;
}) {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    parentAgentId: input.parentAgentId ?? null,
    archivedAt: input.archived ? new Date("2026-01-01T00:00:00.000Z") : null,
  };
}

function index(agents: ReturnType<typeof agent>[]) {
  return buildWorkspaceParentIndex(new Map(agents.map((entry) => [entry.id, entry])));
}

describe("buildWorkspaceParentIndex", () => {
  it("links a workspace to the workspace whose agent launched it", () => {
    const parents = index([
      agent({ id: "orchestrator", workspaceId: "plan" }),
      agent({ id: "insha-773", workspaceId: "ws-773", parentAgentId: "orchestrator" }),
      agent({ id: "insha-778", workspaceId: "ws-778", parentAgentId: "orchestrator" }),
    ]);

    expect(Object.fromEntries(parents)).toEqual({ "ws-773": "plan", "ws-778": "plan" });
  });

  it("keeps a workspace standalone when the user started an agent there", () => {
    const parents = index([
      agent({ id: "orchestrator", workspaceId: "plan" }),
      agent({ id: "child", workspaceId: "ws-child", parentAgentId: "orchestrator" }),
      agent({ id: "mine", workspaceId: "ws-child" }),
    ]);

    expect(parents.size).toBe(0);
  });

  it("ignores subagents that share their parent's workspace", () => {
    const parents = index([
      agent({ id: "orchestrator", workspaceId: "plan" }),
      agent({ id: "helper", workspaceId: "plan", parentAgentId: "orchestrator" }),
    ]);

    expect(parents.size).toBe(0);
  });

  it("keeps a workspace standalone when two workspaces launched agents into it", () => {
    const parents = index([
      agent({ id: "a", workspaceId: "plan-a" }),
      agent({ id: "b", workspaceId: "plan-b" }),
      agent({ id: "child-a", workspaceId: "shared", parentAgentId: "a" }),
      agent({ id: "child-b", workspaceId: "shared", parentAgentId: "b" }),
    ]);

    expect(parents.size).toBe(0);
  });

  it("drops the link once the child's agents are archived", () => {
    const parents = index([
      agent({ id: "orchestrator", workspaceId: "plan" }),
      agent({
        id: "child",
        workspaceId: "ws-child",
        parentAgentId: "orchestrator",
        archived: true,
      }),
    ]);

    expect(parents.size).toBe(0);
  });

  it("returns the previous index when nothing moved", () => {
    const agents = new Map(
      [
        agent({ id: "orchestrator", workspaceId: "plan" }),
        agent({ id: "child", workspaceId: "ws-child", parentAgentId: "orchestrator" }),
      ].map((entry) => [entry.id, entry]),
    );
    const previous = buildWorkspaceParentIndex(agents);

    expect(buildWorkspaceParentIndex(new Map(agents), previous)).toBe(previous);
  });
});
