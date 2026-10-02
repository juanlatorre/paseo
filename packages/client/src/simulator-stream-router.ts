import type { SimulatorStreamFrame } from "@getpaseo/protocol/binary-frames/index";

export interface SimulatorStreamEvent {
  deviceId: string;
  type: "frame";
  jpeg: Uint8Array;
}

export class SimulatorStreamRouter {
  private readonly deviceSlots = new Map<string, number>();
  private readonly slotDevices = new Map<number, string>();
  private readonly listeners = new Set<(event: SimulatorStreamEvent) => void>();

  onEvent(handler: (event: SimulatorStreamEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  setSlot(deviceId: string, slot: number): void {
    const existingDeviceId = this.slotDevices.get(slot);
    if (existingDeviceId && existingDeviceId !== deviceId) {
      this.deviceSlots.delete(existingDeviceId);
    }
    const existingSlot = this.deviceSlots.get(deviceId);
    if (typeof existingSlot === "number" && existingSlot !== slot) {
      this.slotDevices.delete(existingSlot);
    }
    this.deviceSlots.set(deviceId, slot);
    this.slotDevices.set(slot, deviceId);
  }

  removeDevice(deviceId: string): void {
    const slot = this.deviceSlots.get(deviceId);
    if (typeof slot !== "number") {
      return;
    }
    this.deviceSlots.delete(deviceId);
    if (this.slotDevices.get(slot) === deviceId) {
      this.slotDevices.delete(slot);
    }
  }

  clearSlots(): void {
    this.deviceSlots.clear();
    this.slotDevices.clear();
  }

  handleFrame(frame: SimulatorStreamFrame): boolean {
    const deviceId = this.slotDevices.get(frame.slot);
    if (!deviceId) {
      return false;
    }
    const event: SimulatorStreamEvent = {
      deviceId,
      type: "frame",
      jpeg: frame.payload,
    };
    for (const listener of this.listeners) {
      listener(event);
    }
    return true;
  }
}
