import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { House, RefreshCw, RotateCw, Smartphone } from "lucide-react-native";
import {
  Image,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput } from "@/components/ui/text-input";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { uint8ArrayToBase64 } from "@/panels/simulator/uint8-array-base64";
import { useSessionStore } from "@/stores/session-store";
import type { SimulatorDevice, SimulatorInputAction } from "@getpaseo/protocol/messages";

const ThemedSmartphone = withUnistyles(Smartphone);
const ThemedTypeInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const simulatorPanelPresentation = {
  label: (t) => t("panels.simulator.label"),
  subtitle: (t) => t("panels.simulator.subtitle"),
  tooltip: (t) => t("panels.simulator.tooltip"),
  icon: ThemedSmartphone,
} satisfies PanelPresentation;

const TOUCH_MOVE_INTERVAL_MS = 16;
const MAX_GESTURE_POINTS = 240;

interface TouchPoint {
  type: "begin" | "move" | "end";
  x: number;
  y: number;
}

function toTouchPoint(
  event: NativeSyntheticEvent<NativeTouchEvent>,
  width: number,
  height: number,
): TouchPoint {
  const safeWidth = width > 0 ? width : 1;
  const safeHeight = height > 0 ? height : 1;
  return {
    type: "move",
    x: Math.min(1, Math.max(0, event.nativeEvent.locationX / safeWidth)),
    y: Math.min(1, Math.max(0, event.nativeEvent.locationY / safeHeight)),
  };
}

interface DeviceChipProps {
  device: SimulatorDevice;
  selected: boolean;
  onSelect: (udid: string) => void;
}

function DeviceChip({ device, selected, onSelect }: DeviceChipProps) {
  const handlePress = useCallback(() => onSelect(device.udid), [device.udid, onSelect]);
  return (
    <Button variant={selected ? "secondary" : "ghost"} size="xs" onPress={handlePress}>
      {device.name}
    </Button>
  );
}

function SimulatorPanel() {
  const { t } = useTranslation();
  const { serverId } = usePaneContext();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const simulatorSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.iosSimulator === true,
  );

  const [devices, setDevices] = useState<SimulatorDevice[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [selectedUdid, setSelectedUdid] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [landscape, setLandscape] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const typeInputRef = useRef<EditingTextInputHandle | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!client || !simulatorSupported) {
      return;
    }
    try {
      const payload = await client.listSimulatorDevices();
      if (payload.error) {
        setDevicesError(payload.error);
        return;
      }
      setDevicesError(null);
      setDevices(payload.devices);
      setSelectedUdid((current) => {
        if (current && payload.devices.some((device) => device.udid === current)) {
          return current;
        }
        return payload.devices.find((device) => device.state === "Booted")?.udid ?? null;
      });
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : "Failed to list simulators");
    }
  }, [client, simulatorSupported]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!client || !selectedUdid || !simulatorSupported) {
      return;
    }
    let active = true;
    setFrameUri(null);
    setStreamError(null);
    const unsubscribe = client.onSimulatorFrame((event) => {
      if (!active || event.deviceId !== selectedUdid) {
        return;
      }
      setFrameUri(`data:image/jpeg;base64,${uint8ArrayToBase64(event.jpeg)}`);
    });
    const start = async (): Promise<void> => {
      try {
        const payload = await client.startSimulatorStream(selectedUdid);
        if (active && payload.error) {
          setStreamError(payload.error);
        }
      } catch (error) {
        if (active) {
          setStreamError(error instanceof Error ? error.message : "Failed to start stream");
        }
      }
    };
    void start();
    return () => {
      active = false;
      unsubscribe();
      client.stopSimulatorStream(selectedUdid);
    };
  }, [client, selectedUdid, simulatorSupported]);

  const sendAction = useCallback(
    async (action: SimulatorInputAction) => {
      if (!client || !selectedUdid) {
        return;
      }
      setActionError(null);
      try {
        const payload = await client.sendSimulatorInput(selectedUdid, action);
        if (!payload.success && payload.error) {
          setActionError(payload.error);
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Input failed");
      }
    },
    [client, selectedUdid],
  );

  // Touch → normalized device coordinates. Taps fire on release; drags replay
  // the recorded path as one gesture when the finger lifts.
  const gesturePoints = useRef<TouchPoint[]>([]);
  const lastMoveTime = useRef(0);

  const handleStageTouchStart = useCallback(
    (event: NativeSyntheticEvent<NativeTouchEvent>) => {
      if (!frameUri) {
        return;
      }
      gesturePoints.current = [
        { ...toTouchPoint(event, stageSize.width, stageSize.height), type: "begin" },
      ];
      lastMoveTime.current = Date.now();
    },
    [frameUri, stageSize.height, stageSize.width],
  );

  const handleStageTouchMove = useCallback(
    (event: NativeSyntheticEvent<NativeTouchEvent>) => {
      if (gesturePoints.current.length === 0) {
        return;
      }
      const now = Date.now();
      if (now - lastMoveTime.current < TOUCH_MOVE_INTERVAL_MS) {
        return;
      }
      lastMoveTime.current = now;
      if (gesturePoints.current.length >= MAX_GESTURE_POINTS) {
        return;
      }
      gesturePoints.current.push(toTouchPoint(event, stageSize.width, stageSize.height));
    },
    [stageSize.height, stageSize.width],
  );

  const handleStageTouchEnd = useCallback(() => {
    const points = gesturePoints.current;
    gesturePoints.current = [];
    if (points.length === 0) {
      return;
    }
    if (points.length === 1) {
      const { x, y } = points[0];
      void sendAction({ kind: "tap", x, y });
      return;
    }
    const end = points[points.length - 1];
    void sendAction({
      kind: "gesture",
      points: [...points, { ...end, type: "end" }],
    });
  }, [sendAction]);

  const handleRotate = useCallback(() => {
    const orientation = landscape ? "portrait" : "landscape_left";
    setLandscape(!landscape);
    void sendAction({ kind: "rotate", orientation });
  }, [landscape, sendAction]);

  const handleSendType = useCallback(() => {
    const handle = typeInputRef.current;
    const text = (handle?.getText() ?? "").trim();
    if (!text) {
      return;
    }
    handle?.replaceText("");
    void sendAction({ kind: "type", text });
  }, [sendAction]);

  const handleStageLayout = useCallback((event: LayoutChangeEvent) => {
    setStageSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  }, []);

  const handleDeviceSelect = useCallback((udid: string) => {
    setSelectedUdid(udid);
  }, []);

  const handleRefresh = useCallback(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const handleHome = useCallback(() => {
    void sendAction({ kind: "button", name: "home" });
  }, [sendAction]);

  const frameSource = useMemo(() => (frameUri ? { uri: frameUri } : null), [frameUri]);
  const bootedDevices = devices.filter((device) => device.state === "Booted");

  if (!simulatorSupported) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>{t("panels.simulator.unsupported")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        {bootedDevices.map((device) => (
          <DeviceChip
            key={device.udid}
            device={device}
            selected={device.udid === selectedUdid}
            onSelect={handleDeviceSelect}
          />
        ))}
        {bootedDevices.length === 0 ? (
          <Text style={styles.toolbarHint}>{t("panels.simulator.noBootedDevices")}</Text>
        ) : null}
        <View style={styles.toolbarSpacer} />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={RefreshCw}
          onPress={handleRefresh}
          aria-label={t("panels.simulator.refresh")}
        />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={House}
          onPress={handleHome}
          aria-label={t("panels.simulator.home")}
        />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={RotateCw}
          onPress={handleRotate}
          aria-label={t("panels.simulator.rotate")}
        />
      </View>

      <View
        style={styles.stage}
        onTouchStart={handleStageTouchStart}
        onTouchMove={handleStageTouchMove}
        onTouchEnd={handleStageTouchEnd}
        onTouchCancel={handleStageTouchEnd}
        onLayout={handleStageLayout}
      >
        {frameSource ? (
          <Image source={frameSource} style={styles.frame} resizeMode="contain" />
        ) : (
          <View style={styles.centerState}>
            {streamError ? (
              <Text style={styles.stateTextError}>{streamError}</Text>
            ) : (
              <Text style={styles.stateText}>
                {selectedUdid ? t("panels.simulator.connecting") : t("panels.simulator.pickDevice")}
              </Text>
            )}
          </View>
        )}
      </View>

      {actionError ? <Text style={styles.errorRow}>{actionError}</Text> : null}
      {devicesError ? <Text style={styles.errorRow}>{devicesError}</Text> : null}

      <View style={styles.typeRow}>
        <ThemedTypeInput
          ref={typeInputRef}
          style={styles.typeInput}
          onSubmitEditing={handleSendType}
          placeholder={t("panels.simulator.typePlaceholder")}
          returnKeyType="send"
          blurOnSubmit={false}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <Button variant="secondary" size="xs" onPress={handleSendType}>
          {t("panels.simulator.send")}
        </Button>
      </View>
    </View>
  );
}

export const simulatorPanelRegistration = definePanel("simulator", {
  component: SimulatorPanel,
  presentation: simulatorPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  toolbarHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  toolbarSpacer: {
    flex: 1,
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: "100%",
    height: "100%",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  stateTextError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  errorRow: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  typeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  typeInput: {
    flex: 1,
    height: 28,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    paddingHorizontal: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
