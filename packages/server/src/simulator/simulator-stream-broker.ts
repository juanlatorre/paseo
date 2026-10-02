import { request as httpRequest, type ClientRequest } from "node:http";

import { WebSocket } from "ws";
import type pino from "pino";
import type { SimulatorDevice } from "@getpaseo/protocol/messages";

import { MjpegFrameParser } from "./mjpeg-frame-parser.js";
import {
  listIosSimulatorDevices,
  resolveServeSimEntry,
  runServeSim,
  startServeSimHelper,
  stopServeSimHelper,
  ServeSimUnavailableError,
  type ServeSimSessionInfo,
} from "./serve-sim.js";

export interface SimulatorStreamSubscriber {
  onFrame: (jpeg: Uint8Array) => void;
  onError: (message: string) => void;
}

// serve-sim touch frames over its helper WebSocket: [tag:u8][JSON]. The tag and
// shape are serve-sim's touch protocol (same one Orca's gesture sender drives);
// the daemon pins the serve-sim version, so treat drift as a pinned-dep update.
const SERVE_SIM_TOUCH_MESSAGE_TAG = 0x03;
const GESTURE_POINT_INTERVAL_MS = 16;
const HELPER_IDLE_KILL_DELAY_MS = 10_000;
const STREAM_CONNECT_TIMEOUT_MS = 15_000;

interface ManagedDeviceStream {
  info: ServeSimSessionInfo;
  subscribers: Set<SimulatorStreamSubscriber>;
  parser: MjpegFrameParser;
  request: ClientRequest | null;
  inputSocket: WebSocket | null;
  inputSocketReady: Promise<WebSocket> | null;
  idleKillTimer: NodeJS.Timeout | null;
  starting: Promise<ServeSimSessionInfo> | null;
}

export class SimulatorStreamBroker {
  private readonly streams = new Map<string, ManagedDeviceStream>();
  private readonly logger: pino.Logger;
  private disposed = false;

  constructor(options: { logger: pino.Logger }) {
    this.logger = options.logger.child({ module: "simulator-stream-broker" });
  }

  // Advertising the feature without a resolvable helper would give clients a
  // panel that always fails, so availability is helper resolution.
  isSupported(): boolean {
    return process.platform === "darwin" && resolveServeSimEntry() !== null;
  }

  async listDevices(): Promise<SimulatorDevice[]> {
    return listIosSimulatorDevices();
  }

  async subscribe(deviceId: string, subscriber: SimulatorStreamSubscriber): Promise<void> {
    if (this.disposed) {
      throw new ServeSimUnavailableError("Simulator streaming is shutting down.");
    }
    const stream = await this.getOrCreateStream(deviceId);
    stream.subscribers.add(subscriber);
  }

  unsubscribe(deviceId: string, subscriber: SimulatorStreamSubscriber): void {
    const stream = this.streams.get(deviceId);
    if (!stream) {
      return;
    }
    stream.subscribers.delete(subscriber);
    if (stream.subscribers.size > 0 || stream.starting) {
      return;
    }
    stream.idleKillTimer ??= setTimeout(() => {
      stream.idleKillTimer = null;
      void this.teardownStream(deviceId, { killHelper: true });
    }, HELPER_IDLE_KILL_DELAY_MS);
    if (typeof stream.idleKillTimer.unref === "function") {
      stream.idleKillTimer.unref();
    }
  }

  async sendInput(
    deviceId: string,
    action:
      | { kind: "tap"; x: number; y: number }
      | { kind: "gesture"; points: { type: "begin" | "move" | "end"; x: number; y: number }[] }
      | { kind: "type"; text: string }
      | { kind: "button"; name: string }
      | { kind: "rotate"; orientation: string },
  ): Promise<void> {
    const info = await this.ensureHelper(deviceId);
    if (action.kind === "tap") {
      await this.sendTouch(info, [
        { type: "begin", x: action.x, y: action.y },
        { type: "end", x: action.x, y: action.y },
      ]);
      return;
    }
    if (action.kind === "gesture") {
      await this.sendTouch(info, action.points);
      return;
    }
    if (action.kind === "type") {
      await this.runHelperCommand(["type", action.text, "-d", deviceId]);
      return;
    }
    if (action.kind === "button") {
      await this.runHelperCommand(["button", action.name, "-d", deviceId]);
      return;
    }
    await this.runHelperCommand(["rotate", action.orientation, "-d", deviceId]);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const deviceIds = Array.from(this.streams.keys());
    await Promise.all(
      deviceIds.map((deviceId) => this.teardownStream(deviceId, { killHelper: true })),
    );
  }

  private async ensureHelper(deviceId: string): Promise<ServeSimSessionInfo> {
    const existing = this.streams.get(deviceId);
    if (existing) {
      return existing.info;
    }
    return startServeSimHelper(deviceId);
  }

  private async getOrCreateStream(deviceId: string): Promise<ManagedDeviceStream> {
    const existing = this.streams.get(deviceId);
    if (existing) {
      await existing.starting;
      return existing;
    }
    const stream: ManagedDeviceStream = {
      info: { url: "", streamUrl: "", wsUrl: null, port: 0, device: deviceId },
      subscribers: new Set(),
      parser: new MjpegFrameParser(),
      request: null,
      inputSocket: null,
      inputSocketReady: null,
      idleKillTimer: null,
      starting: null,
    };
    this.streams.set(deviceId, stream);
    stream.starting = this.connectStream(deviceId, stream)
      .then((info) => {
        stream.info = info;
        return info;
      })
      .catch((error: unknown) => {
        void this.teardownStream(deviceId, { killHelper: false });
        throw error;
      })
      .finally(() => {
        stream.starting = null;
      });
    await stream.starting;
    return stream;
  }

  private async connectStream(
    deviceId: string,
    stream: ManagedDeviceStream,
  ): Promise<ServeSimSessionInfo> {
    const info = await startServeSimHelper(deviceId);
    if (this.disposed) {
      throw new ServeSimUnavailableError("Simulator streaming is shutting down.");
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleError = (error: ServeSimUnavailableError): void => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const connectTimeout = setTimeout(() => {
        settleError(new ServeSimUnavailableError("Simulator stream connection timed out."));
      }, STREAM_CONNECT_TIMEOUT_MS);
      connectTimeout.unref?.();
      const upstream = httpRequest(info.streamUrl, {
        headers: { accept: "multipart/x-mixed-replace" },
      });
      stream.request = upstream;
      upstream.on("response", (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          settleError(
            new ServeSimUnavailableError(
              `Simulator stream responded with HTTP ${response.statusCode ?? 0}.`,
            ),
          );
          return;
        }
        clearTimeout(connectTimeout);
        settled = true;
        resolve();
        response.on("data", (chunk: Buffer) => {
          this.ingestParsedFrames(stream, stream.parser.push(chunk));
        });
        response.on("error", (error: Error) => {
          this.handleStreamFailure(deviceId, stream, error.message);
        });
        response.on("end", () => {
          this.handleStreamFailure(deviceId, stream, "Simulator stream ended.");
        });
      });
      upstream.on("error", (error) => {
        settleError(
          new ServeSimUnavailableError(`Simulator stream connection failed: ${error.message}`),
        );
      });
      upstream.end();
    });
    return info;
  }

  private ingestParsedFrames(stream: ManagedDeviceStream, frames: Buffer[]): void {
    for (const frame of frames) {
      for (const subscriber of stream.subscribers) {
        try {
          subscriber.onFrame(frame);
        } catch (error) {
          this.logger.warn({ err: error }, "simulator frame subscriber failed");
        }
      }
    }
  }

  private handleStreamFailure(
    deviceId: string,
    stream: ManagedDeviceStream,
    message: string,
  ): void {
    this.logger.warn({ deviceId, message }, "simulator stream failed");
    const stillCurrent = this.streams.get(deviceId) === stream;
    if (stillCurrent) {
      void this.teardownStream(deviceId, { killHelper: false });
    }
    for (const subscriber of stream.subscribers) {
      try {
        subscriber.onError(message);
      } catch {
        // Subscriber callbacks must not break teardown.
      }
    }
  }

  private async teardownStream(deviceId: string, options: { killHelper: boolean }): Promise<void> {
    const stream = this.streams.get(deviceId);
    if (!stream) {
      return;
    }
    this.streams.delete(deviceId);
    if (stream.idleKillTimer) {
      clearTimeout(stream.idleKillTimer);
      stream.idleKillTimer = null;
    }
    stream.request?.destroy();
    stream.request = null;
    const socket = stream.inputSocket;
    stream.inputSocket = null;
    stream.inputSocketReady = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
    if (options.killHelper) {
      await stopServeSimHelper(deviceId);
    }
  }

  private async runHelperCommand(args: string[]): Promise<void> {
    await runServeSim(args);
  }

  private async sendTouch(
    info: ServeSimSessionInfo,
    points: { type: "begin" | "move" | "end"; x: number; y: number }[],
  ): Promise<void> {
    if (!info.wsUrl) {
      throw new ServeSimUnavailableError("serve-sim helper exposes no input socket.");
    }
    const socket = await this.ensureInputSocket(info);
    await new Promise<void>((resolve, reject) => {
      let index = 0;
      let timer: NodeJS.Timeout | null = null;
      const finish = (error?: Error): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const sendNext = (): void => {
        if (socket.readyState !== WebSocket.OPEN) {
          finish(new ServeSimUnavailableError("Simulator input socket is not open."));
          return;
        }
        if (index >= points.length) {
          timer = setTimeout(() => finish(), 50);
          return;
        }
        const point = points[index++];
        const json = Buffer.from(JSON.stringify(point), "utf8");
        const frame = Buffer.alloc(1 + json.byteLength);
        frame[0] = SERVE_SIM_TOUCH_MESSAGE_TAG;
        json.copy(frame, 1);
        socket.send(frame, (error) => {
          if (error) {
            finish(new ServeSimUnavailableError(`Simulator input failed: ${error.message}`));
            return;
          }
          timer = setTimeout(sendNext, GESTURE_POINT_INTERVAL_MS);
        });
      };
      sendNext();
    });
  }

  private ensureInputSocket(info: ServeSimSessionInfo): Promise<WebSocket> {
    const stream = this.streams.get(info.device);
    if (stream?.inputSocket && stream.inputSocket.readyState === WebSocket.OPEN) {
      return Promise.resolve(stream.inputSocket);
    }
    if (stream?.inputSocketReady) {
      return stream.inputSocketReady;
    }
    if (!info.wsUrl) {
      return Promise.reject(
        new ServeSimUnavailableError("serve-sim helper exposes no input socket."),
      );
    }
    const socket = new WebSocket(info.wsUrl);
    const ready = new Promise<WebSocket>((resolve, reject) => {
      socket.once("open", () => resolve(socket));
      socket.once("error", (error) => {
        reject(new ServeSimUnavailableError(`Simulator input socket failed: ${error.message}`));
      });
      socket.once("close", () => {
        reject(new ServeSimUnavailableError("Simulator input socket closed before opening."));
      });
    });
    // A cached rejected readiness promise must not surface as unhandled when
    // nobody is awaiting it.
    ready.catch(() => {});
    // Drop the cached socket once it dies so the next input opens a fresh one.
    const clearCached = (): void => {
      if (stream?.inputSocket === socket) {
        stream.inputSocket = null;
        stream.inputSocketReady = null;
      }
    };
    socket.on("error", clearCached);
    socket.on("close", clearCached);
    if (stream) {
      stream.inputSocket = socket;
      stream.inputSocketReady = ready;
    }
    return ready;
  }
}
