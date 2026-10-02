import { describe, expect, it } from "vitest";

import { parseServeSimSessionOutput, parseSimctlDevicesJson } from "./serve-sim.js";

describe("parseServeSimSessionOutput", () => {
  it("parses the JSON line serve-sim --detach prints", () => {
    const stdout = `${JSON.stringify({
      url: "http://127.0.0.1:3100",
      streamUrl: "http://127.0.0.1:3100/helper/UDID/stream.mjpeg",
      wsUrl: "ws://127.0.0.1:3100/helper/UDID/ws",
      port: 3100,
      device: "UDID",
    })}\n`;
    expect(parseServeSimSessionOutput(stdout)).toEqual({
      url: "http://127.0.0.1:3100",
      streamUrl: "http://127.0.0.1:3100/helper/UDID/stream.mjpeg",
      wsUrl: "ws://127.0.0.1:3100/helper/UDID/ws",
      port: 3100,
      device: "UDID",
      pid: undefined,
    });
  });

  it("returns null when no JSON object line is present", () => {
    expect(parseServeSimSessionOutput("Recording started\n")).toBeNull();
    expect(parseServeSimSessionOutput("")).toBeNull();
  });
});

describe("parseSimctlDevicesJson", () => {
  it("maps iOS devices and sorts booted first", () => {
    const stdout = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-0": [
          {
            udid: "shutdown-udid",
            name: "iPhone 15 Pro",
            state: "Shutdown",
            isAvailable: true,
            deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro",
          },
          {
            udid: "booted-udid",
            name: "iPhone 15",
            state: "Booted",
            isAvailable: true,
            deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-15",
          },
        ],
        "com.apple.CoreSimulator.SimRuntime.tvOS-17-0": [
          { udid: "tv-udid", name: "Apple TV", state: "Shutdown" },
        ],
      },
    });
    const devices = parseSimctlDevicesJson(stdout);
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      udid: "booted-udid",
      name: "iPhone 15",
      runtime: "iOS 17.0",
      state: "Booted",
      deviceType: "iPhone 15",
    });
    expect(devices[1].state).toBe("Shutdown");
  });

  it("skips unavailable devices", () => {
    const stdout = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
          { udid: "gone", name: "iPhone 16", state: "Shutdown", isAvailable: false },
        ],
      },
    });
    expect(parseSimctlDevicesJson(stdout)).toEqual([]);
  });

  it("throws ServeSimUnavailableError on non-JSON output", () => {
    expect(() => parseSimctlDevicesJson("xcrun: error: no Xcode")).toThrow();
  });
});
