import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { SimulatorDevice } from "@getpaseo/protocol/messages";

import { execCommand } from "../utils/spawn.js";

// serve-sim (https://github.com/EvanBacon/serve-sim) wraps Apple's SimulatorKit
// to stream an iOS Simulator framebuffer over MJPEG and inject touch/keyboard
// input. It is the same helper Orca uses for its emulator pane. The CLI entry is
// not in the package "exports" map, so resolve the exported middleware module
// and take the sibling serve-sim.js in the same dist directory.
export interface ServeSimSessionInfo {
  url: string;
  streamUrl: string;
  wsUrl: string | null;
  port: number;
  device: string;
  pid?: number;
}

const SERVE_SIM_TIMEOUT_MS = 30_000;
const SIMCTL_TIMEOUT_MS = 15_000;

let cachedEntryPath: string | null | undefined;

export function resolveServeSimEntry(): string | null {
  if (cachedEntryPath !== undefined) {
    return cachedEntryPath;
  }
  cachedEntryPath = (() => {
    try {
      const require = createRequire(import.meta.url);
      const middlewareEntry = require.resolve("serve-sim/middleware");
      const entry = join(dirname(middlewareEntry), "serve-sim.js");
      return entry;
    } catch {
      return null;
    }
  })();
  return cachedEntryPath;
}

export function resetServeSimEntryCache(): void {
  cachedEntryPath = undefined;
}

export class ServeSimUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServeSimUnavailableError";
  }
}

export async function runServeSim(args: string[]): Promise<string> {
  const entry = resolveServeSimEntry();
  if (!entry) {
    throw new ServeSimUnavailableError(
      "The serve-sim helper package is not installed on this daemon host.",
    );
  }
  try {
    const result = await execCommand(process.execPath, [entry, ...args], {
      timeout: SERVE_SIM_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    if (error instanceof ServeSimUnavailableError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "serve-sim command failed";
    throw new ServeSimUnavailableError(message);
  }
}

function parseJsonObjectLine(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split("\n").toReversed()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function parseServeSimSessionOutput(stdout: string): ServeSimSessionInfo | null {
  const parsed = parseJsonObjectLine(stdout);
  return parsed ? toServeSimSessionInfo(parsed) : null;
}

function toServeSimSessionInfo(parsed: Record<string, unknown>): ServeSimSessionInfo | null {
  const url = parsed.url;
  const streamUrl = parsed.streamUrl;
  const device = parsed.device;
  if (typeof url !== "string" || typeof streamUrl !== "string" || typeof device !== "string") {
    return null;
  }
  const port = typeof parsed.port === "number" ? parsed.port : 0;
  const wsUrl = typeof parsed.wsUrl === "string" ? parsed.wsUrl : null;
  const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
  return { url, streamUrl, wsUrl, port, device, ...(pid !== undefined ? { pid } : {}) };
}

export async function startServeSimHelper(deviceId: string): Promise<ServeSimSessionInfo> {
  const stdout = await runServeSim(["--detach", "-q", "--codec", "mjpeg", deviceId]);
  const info = parseServeSimSessionOutput(stdout);
  if (!info) {
    throw new ServeSimUnavailableError(
      `serve-sim did not return a stream session for device ${deviceId}.`,
    );
  }
  return info;
}

export async function stopServeSimHelper(deviceId: string): Promise<void> {
  await runServeSim(["--kill", "-q", deviceId]).catch(() => {});
}

interface SimctlDeviceEntry {
  udid?: string;
  name?: string;
  state?: string;
  deviceTypeIdentifier?: string;
  isAvailable?: boolean;
}

interface SimctlListOutput {
  devices?: Record<string, SimctlDeviceEntry[]>;
}

function runtimeLabelFromKey(key: string): string | undefined {
  const match = /SimRuntime\.([A-Za-z]+)-(\d+)-(\d+)$/.exec(key);
  if (!match) {
    return undefined;
  }
  return `${match[1]} ${match[2]}.${match[3]}`;
}

function deviceTypeLabel(identifier: string | undefined): string | undefined {
  if (!identifier) {
    return undefined;
  }
  const match = /SimDeviceType\.(.+)$/.exec(identifier);
  return match ? match[1].replaceAll("-", " ") : undefined;
}

function compareDevices(a: SimulatorDevice, b: SimulatorDevice): number {
  const bootedDiff = Number(b.state === "Booted") - Number(a.state === "Booted");
  if (bootedDiff !== 0) {
    return bootedDiff;
  }
  return a.name.localeCompare(b.name);
}

export function parseSimctlDevicesJson(stdout: string): SimulatorDevice[] {
  let parsed: SimctlListOutput;
  try {
    parsed = JSON.parse(stdout) as SimctlListOutput;
  } catch {
    throw new ServeSimUnavailableError("Unable to parse xcrun simctl output.");
  }
  const devices: SimulatorDevice[] = [];
  for (const [runtimeKey, entries] of Object.entries(parsed.devices ?? {})) {
    if (!runtimeKey.includes("SimRuntime.iOS")) {
      continue;
    }
    for (const entry of entries) {
      if (typeof entry.udid !== "string" || typeof entry.name !== "string") {
        continue;
      }
      if (entry.isAvailable === false) {
        continue;
      }
      devices.push({
        udid: entry.udid,
        name: entry.name,
        runtime: runtimeLabelFromKey(runtimeKey),
        state: typeof entry.state === "string" ? entry.state : undefined,
        deviceType: deviceTypeLabel(entry.deviceTypeIdentifier),
      });
    }
  }
  devices.sort(compareDevices);
  return devices;
}

export async function listIosSimulatorDevices(): Promise<SimulatorDevice[]> {
  let stdout: string;
  try {
    const result = await execCommand("xcrun", ["simctl", "list", "devices", "--json"], {
      timeout: SIMCTL_TIMEOUT_MS,
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "xcrun simctl failed";
    throw new ServeSimUnavailableError(`Unable to list iOS simulators: ${message}`);
  }
  return parseSimctlDevicesJson(stdout);
}
