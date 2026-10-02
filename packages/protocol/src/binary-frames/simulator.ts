// Simulator mirror frames: [opcode:u8, slot:u8, jpegBytes...]. Each payload is
// one complete JPEG image (one MJPEG frame from the host-side simulator helper).
import { asUint8Array } from "./terminal.js";

export const SimulatorStreamOpcode = {
  Frame: 0x20,
} as const;

export type SimulatorStreamOpcode =
  (typeof SimulatorStreamOpcode)[keyof typeof SimulatorStreamOpcode];

export interface SimulatorStreamFrame {
  opcode: SimulatorStreamOpcode;
  slot: number;
  payload: Uint8Array;
}

function isSimulatorStreamOpcode(value: number): value is SimulatorStreamOpcode {
  return value === SimulatorStreamOpcode.Frame;
}

export function encodeSimulatorStreamFrame(input: {
  opcode: SimulatorStreamOpcode;
  slot: number;
  payload?: Uint8Array | ArrayBuffer | string;
}): Uint8Array {
  const payload = asUint8Array(input.payload ?? new Uint8Array(0)) ?? new Uint8Array(0);
  const bytes = new Uint8Array(2 + payload.byteLength);
  bytes[0] = input.opcode;
  bytes[1] = input.slot & 0xff;
  bytes.set(payload, 2);
  return bytes;
}

export function decodeSimulatorStreamFrame(bytes: Uint8Array): SimulatorStreamFrame | null {
  if (bytes.byteLength < 2) {
    return null;
  }
  const opcode = bytes[0];
  if (!isSimulatorStreamOpcode(opcode)) {
    return null;
  }
  return {
    opcode,
    slot: bytes[1],
    payload: bytes.subarray(2),
  };
}
