import type pino from "pino";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type {
  SimulatorDeviceListRequest,
  SimulatorDeviceListResponse,
  SimulatorInputSendRequest,
  SimulatorInputSendResponse,
  SimulatorStreamStartRequest,
  SimulatorStreamStopRequest,
  SimulatorStreamStopResponse,
} from "@getpaseo/protocol/messages";
import {
  encodeSimulatorStreamFrame,
  SimulatorStreamOpcode,
} from "@getpaseo/protocol/binary-frames/index";

import type {
  SimulatorStreamBroker,
  SimulatorStreamSubscriber,
} from "./simulator-stream-broker.js";

const MAX_SIMULATOR_STREAM_SLOTS = 8;

type SimulatorInboundMessage =
  | SimulatorDeviceListRequest
  | SimulatorStreamStartRequest
  | SimulatorStreamStopRequest
  | SimulatorInputSendRequest;

export interface SimulatorSessionControllerOptions {
  broker?: SimulatorStreamBroker | null;
  emit: (msg: SessionOutboundMessage) => void;
  emitBinary: (frame: Uint8Array) => void;
  hasBinaryChannel: () => boolean;
  sessionLogger: pino.Logger;
}

function isSimulatorInboundMessage(message: { type: string }): message is SimulatorInboundMessage {
  return (
    message.type === "simulator.device.list.request" ||
    message.type === "simulator.stream.start.request" ||
    message.type === "simulator.stream.stop.request" ||
    message.type === "simulator.input.send.request"
  );
}

export class SimulatorSessionController {
  private readonly broker: SimulatorStreamBroker | null;
  private readonly emit: (msg: SessionOutboundMessage) => void;
  private readonly emitBinary: (frame: Uint8Array) => void;
  private readonly hasBinaryChannel: () => boolean;
  private readonly sessionLogger: pino.Logger;
  private readonly deviceIdToSlot = new Map<string, number>();
  private readonly slotToDeviceId = new Map<number, string>();
  private readonly subscribers = new Map<string, SimulatorStreamSubscriber>();

  constructor(options: SimulatorSessionControllerOptions) {
    this.broker = options.broker ?? null;
    this.emit = options.emit;
    this.emitBinary = options.emitBinary;
    this.hasBinaryChannel = options.hasBinaryChannel;
    this.sessionLogger = options.sessionLogger;
  }

  handleInboundMessage(message: { type: string }): void {
    if (!isSimulatorInboundMessage(message)) {
      return;
    }
    if (message.type === "simulator.device.list.request") {
      void this.handleDeviceListRequest(message);
      return;
    }
    if (message.type === "simulator.stream.start.request") {
      void this.handleStreamStartRequest(message);
      return;
    }
    if (message.type === "simulator.stream.stop.request") {
      this.handleStreamStopRequest(message);
      return;
    }
    void this.handleInputSendRequest(message);
  }

  dispose(): void {
    for (const deviceId of Array.from(this.deviceIdToSlot.keys())) {
      this.detachStream(deviceId);
    }
  }

  private emitListResponse(
    payload: SimulatorDeviceListResponse["payload"] | SimulatorDeviceListErrorPayload,
  ): void {
    this.emit({ type: "simulator.device.list.response", payload });
  }

  private async handleDeviceListRequest(request: SimulatorDeviceListRequest): Promise<void> {
    if (!this.broker) {
      this.emitListResponse({
        requestId: request.requestId,
        devices: [],
        error: "Simulator streaming is not available on this daemon host.",
      });
      return;
    }
    try {
      const devices = await this.broker.listDevices();
      this.emitListResponse({
        requestId: request.requestId,
        devices,
        error: null,
      });
    } catch (error) {
      this.sessionLogger.warn({ err: error }, "simulator device list failed");
      this.emitListResponse({
        requestId: request.requestId,
        devices: [],
        error: error instanceof Error ? error.message : "Failed to list iOS simulators.",
      });
    }
  }

  private async handleStreamStartRequest(request: SimulatorStreamStartRequest): Promise<void> {
    const emitStart = (payload: SimulatorStartPayload): void => {
      this.emit({ type: "simulator.stream.start.response", payload });
    };
    if (!this.broker) {
      emitStart({
        requestId: request.requestId,
        deviceId: request.deviceId,
        error: "Simulator streaming is not available on this daemon host.",
      });
      return;
    }
    if (!this.hasBinaryChannel()) {
      emitStart({
        requestId: request.requestId,
        deviceId: request.deviceId,
        error: "This connection does not support binary simulator streaming.",
      });
      return;
    }
    const existingSlot = this.deviceIdToSlot.get(request.deviceId);
    if (typeof existingSlot === "number") {
      emitStart({
        requestId: request.requestId,
        deviceId: request.deviceId,
        slot: existingSlot,
        error: null,
      });
      return;
    }
    const slot = this.allocateSlot();
    if (slot === null) {
      emitStart({
        requestId: request.requestId,
        deviceId: request.deviceId,
        error: "Too many active simulator streams.",
      });
      return;
    }
    const subscriber: SimulatorStreamSubscriber = {
      onFrame: (jpeg) => {
        this.emitBinary(
          encodeSimulatorStreamFrame({
            opcode: SimulatorStreamOpcode.Frame,
            slot,
            payload: jpeg,
          }),
        );
      },
      onError: (message) => {
        this.sessionLogger.warn({ deviceId: request.deviceId, message }, "simulator stream error");
        this.detachStream(request.deviceId);
        emitStart({
          requestId: request.requestId,
          deviceId: request.deviceId,
          error: message,
        });
      },
    };
    try {
      await this.broker.subscribe(request.deviceId, subscriber);
    } catch (error) {
      this.slotToDeviceId.delete(slot);
      emitStart({
        requestId: request.requestId,
        deviceId: request.deviceId,
        error: error instanceof Error ? error.message : "Failed to start simulator stream.",
      });
      return;
    }
    this.deviceIdToSlot.set(request.deviceId, slot);
    this.slotToDeviceId.set(slot, request.deviceId);
    this.subscribers.set(request.deviceId, subscriber);
    emitStart({
      requestId: request.requestId,
      deviceId: request.deviceId,
      slot,
      error: null,
    });
  }

  private handleStreamStopRequest(request: SimulatorStreamStopRequest): void {
    this.detachStream(request.deviceId);
    const payload: SimulatorStreamStopResponse["payload"] = {
      requestId: request.requestId,
      deviceId: request.deviceId,
      success: true,
      error: null,
    };
    this.emit({ type: "simulator.stream.stop.response", payload });
  }

  private async handleInputSendRequest(request: SimulatorInputSendRequest): Promise<void> {
    const emitInput = (payload: SimulatorInputSendResponse["payload"]): void => {
      this.emit({ type: "simulator.input.send.response", payload });
    };
    if (!this.broker) {
      emitInput({
        requestId: request.requestId,
        deviceId: request.deviceId,
        success: false,
        error: "Simulator streaming is not available on this daemon host.",
      });
      return;
    }
    try {
      await this.broker.sendInput(request.deviceId, request.action);
      emitInput({
        requestId: request.requestId,
        deviceId: request.deviceId,
        success: true,
        error: null,
      });
    } catch (error) {
      this.sessionLogger.warn({ err: error }, "simulator input failed");
      emitInput({
        requestId: request.requestId,
        deviceId: request.deviceId,
        success: false,
        error: error instanceof Error ? error.message : "Simulator input failed.",
      });
    }
  }

  private detachStream(deviceId: string): void {
    if (!this.broker) {
      return;
    }
    const slot = this.deviceIdToSlot.get(deviceId);
    const subscriber = this.subscribers.get(deviceId);
    if (subscriber) {
      this.broker.unsubscribe(deviceId, subscriber);
    }
    this.subscribers.delete(deviceId);
    this.deviceIdToSlot.delete(deviceId);
    if (typeof slot === "number") {
      this.slotToDeviceId.delete(slot);
    }
  }

  private allocateSlot(): number | null {
    for (let slot = 0; slot < MAX_SIMULATOR_STREAM_SLOTS; slot += 1) {
      if (!this.slotToDeviceId.has(slot)) {
        return slot;
      }
    }
    return null;
  }
}

type SimulatorDeviceListErrorPayload = SimulatorDeviceListResponse["payload"] & {
  devices: [];
  error: string;
};

type SimulatorStartPayload = Extract<
  SessionOutboundMessage,
  { type: "simulator.stream.start.response" }
>["payload"];
