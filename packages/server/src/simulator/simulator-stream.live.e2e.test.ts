import { describe, expect, test } from "vitest";
import pino from "pino";

import { DaemonClient } from "../server/test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../server/test-utils/paseo-daemon.js";

// Live test against a real Xcode simulator on this Mac. Requires a booted iOS
// simulator; skipped everywhere else and in CI.
const liveTest = process.env.RUN_LIVE_SIMULATOR_E2E === "1" ? test : test.skip;

describe("simulator stream (live)", () => {
  liveTest("lists devices, streams frames, and injects a tap", { timeout: 60_000 }, async () => {
    const logger = pino({ level: "warn" });
    const daemon = await createTestPaseoDaemon({ logger });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.7.2",
    });
    try {
      await client.connect();
      await client.fetchAgents({ subscribe: { subscriptionId: "simulator-e2e" } });

      const list = await client.listSimulatorDevices();
      expect(list.error).toBeNull();
      const booted = list.devices.find((device) => device.state === "Booted");
      expect(booted).toBeDefined();
      if (!booted) {
        return;
      }

      const frames: Uint8Array[] = [];
      const unsubscribe = client.onSimulatorFrame((event) => {
        if (event.deviceId === booted.udid) {
          frames.push(event.jpeg);
        }
      });

      const start = await client.startSimulatorStream(booted.udid);
      expect(start.error).toBeNull();
      expect(typeof start.slot).toBe("number");

      // MJPEG frames should start arriving within a few seconds.
      const deadline = Date.now() + 15_000;
      while (frames.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      unsubscribe();
      expect(frames.length).toBeGreaterThanOrEqual(3);
      for (const frame of frames) {
        // JPEG SOI marker.
        expect(frame[0]).toBe(0xff);
        expect(frame[1]).toBe(0xd8);
      }

      const tap = await client.sendSimulatorInput(booted.udid, {
        kind: "tap",
        x: 0.5,
        y: 0.5,
      });
      expect(tap.success).toBe(true);

      const stop = await new Promise<void>((resolve) => {
        client.stopSimulatorStream(booted.udid);
        setTimeout(resolve, 500);
      });
      await stop;
    } finally {
      await client.close();
      await daemon.close();
    }
  });
});
