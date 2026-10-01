import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { sidebarWorkspaceRowStyles } from "@/components/sidebar/sidebar-workspace-row-content";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import type { Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

type ChildTone = "danger" | "warning" | "running" | "success" | "idle";

/**
 * One dot per child, so a folded family still says whether anything in it went wrong. Live agent
 * state outranks the PR: a child waiting on you matters more than its checks. Once the agent is
 * done, the PR is what is left to review, so its checks and merge state take over.
 */
function resolveChildTone(child: SidebarWorkspaceEntry): ChildTone {
  switch (child.statusBucket) {
    case "needs_input":
      return "warning";
    case "failed":
      return "danger";
    case "running":
      return "running";
    case "attention":
    case "done":
      break;
  }
  const pr = child.prHint;
  if (pr?.checksStatus === "failure" || pr?.reviewDecision === "changes_requested") {
    return "danger";
  }
  if (pr?.state === "merged" || pr?.checksStatus === "success") return "success";
  return child.statusBucket === "attention" ? "success" : "idle";
}

/**
 * The child workspaces an orchestrating agent launched, folded under its row.
 *
 * Families start collapsed: you review the orchestrator, and its children are one tap away.
 * The toggle sits on the parent's title rail and the expanded children hang off a guide line
 * from the parent's status slot, so the tree reads without a second row style.
 */
export function SidebarWorkspaceFamily({
  parentWorkspaceKey,
  childWorkspaces,
  indented,
  renderChild,
}: {
  parentWorkspaceKey: string;
  childWorkspaces: readonly SidebarWorkspaceEntry[];
  /** Matches the parent row: status-group rows indent from their header, project rows don't. */
  indented: boolean;
  renderChild: (workspace: SidebarWorkspaceEntry) => ReactNode;
}) {
  const expanded = useSidebarCollapsedSectionsStore((state) =>
    state.expandedWorkspaceFamilyKeys.has(parentWorkspaceKey),
  );
  const toggleExpanded = useSidebarCollapsedSectionsStore(
    (state) => state.toggleWorkspaceFamilyExpanded,
  );
  const handleToggle = useCallback(
    () => toggleExpanded(parentWorkspaceKey),
    [parentWorkspaceKey, toggleExpanded],
  );

  if (childWorkspaces.length === 0) return null;
  return (
    <View testID={`sidebar-workspace-family-${parentWorkspaceKey}`}>
      <SidebarWorkspaceFamilyToggle
        expanded={expanded}
        childWorkspaces={childWorkspaces}
        indented={indented}
        onPress={handleToggle}
        testID={`sidebar-workspace-family-toggle-${parentWorkspaceKey}`}
      />
      {expanded ? (
        <View style={[styles.children, indented && styles.childrenIndented]}>
          {childWorkspaces.map((child) => (
            <View key={child.workspaceKey}>{renderChild(child)}</View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SidebarWorkspaceFamilyToggle({
  expanded,
  childWorkspaces,
  indented,
  onPress,
  testID,
}: {
  expanded: boolean;
  childWorkspaces: readonly SidebarWorkspaceEntry[];
  indented: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const count = childWorkspaces.length;
  const label =
    count === 1
      ? t("sidebar.workspace.actions.subagentsOne")
      : t("sidebar.workspace.actions.subagentsMany", { count });
  const accessibilityLabel = t(
    expanded
      ? "sidebar.workspace.actions.hideSubagents"
      : "sidebar.workspace.actions.showSubagents",
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toggleRow,
      indented && sidebarWorkspaceRowStyles.rowIndented,
      hovered && !pressed && styles.toggleRowHovered,
      pressed && styles.toggleRowPressed,
    ],
    [indented],
  );

  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={rowStyle}
      testID={testID}
    >
      {({ hovered, pressed }) => {
        const active = hovered || pressed;
        const iconColor = active ? foregroundColorMapping : foregroundMutedColorMapping;
        return (
          <>
            <View style={styles.iconSlot}>
              {expanded ? (
                <ThemedChevronDown size={14} uniProps={iconColor} />
              ) : (
                <ThemedChevronRight size={14} uniProps={iconColor} />
              )}
            </View>
            <Text style={active ? styles.textHovered : styles.text} numberOfLines={1}>
              {label}
            </Text>
            <View style={styles.dots}>
              {childWorkspaces.map((child) => (
                <View
                  key={child.workspaceKey}
                  style={[styles.dot, dotToneStyles[resolveChildTone(child)]]}
                />
              ))}
            </View>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Shorter than a workspace row: it labels the rows below rather than being one of them.
  toggleRow: {
    minHeight: 28,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  toggleRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  toggleRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  // The workspace row's status slot, so the chevron sits under the parent's status icon and the
  // label lands on its title rail.
  iconSlot: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 0,
    flexShrink: 1,
  },
  textHovered: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    minWidth: 0,
    flexShrink: 1,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // The guide drops from the centre of the parent's status slot; children indent past it.
  children: {
    marginLeft: theme.spacing[2] + theme.iconSize.md / 2,
    paddingLeft: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  childrenIndented: {
    marginLeft: theme.spacing[2] + theme.spacing[2] + theme.spacing[2] + theme.iconSize.md / 2,
  },
}));

const dotToneStyles = StyleSheet.create((theme) => ({
  danger: { backgroundColor: theme.colors.statusDotDanger },
  warning: { backgroundColor: theme.colors.statusDotWarning },
  running: { backgroundColor: theme.colors.statusDotRunning },
  success: { backgroundColor: theme.colors.statusDotSuccess },
  idle: { backgroundColor: theme.colors.border },
}));
