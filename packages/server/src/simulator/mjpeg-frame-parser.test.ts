import { describe, expect, it } from "vitest";

import { MjpegFrameParser } from "./mjpeg-frame-parser.js";

function buildPart(payload: Buffer, contentLength = payload.byteLength): Buffer {
  const header = Buffer.from(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${contentLength}\r\n\r\n`,
    "utf8",
  );
  return Buffer.concat([header, payload, Buffer.from("\r\n", "utf8")]);
}

function jpeg(size: number, seed: number): Buffer {
  const bytes = Buffer.alloc(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  for (let index = 3; index < size; index += 1) {
    bytes[index] = (seed + index) % 256;
  }
  return bytes;
}

describe("MjpegFrameParser", () => {
  it("extracts a single frame from one chunk", () => {
    const parser = new MjpegFrameParser();
    const expected = jpeg(64, 1);
    const frames = parser.push(buildPart(expected));
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(expected)).toBe(true);
  });

  it("extracts multiple frames from one chunk", () => {
    const parser = new MjpegFrameParser();
    const first = jpeg(32, 2);
    const second = jpeg(48, 7);
    const frames = parser.push(Buffer.concat([buildPart(first), buildPart(second)]));
    expect(frames).toHaveLength(2);
    expect(frames[0].equals(first)).toBe(true);
    expect(frames[1].equals(second)).toBe(true);
  });

  it("reassembles frames split across arbitrary chunk boundaries", () => {
    const parser = new MjpegFrameParser();
    const expected = jpeg(100, 3);
    const whole = buildPart(expected);
    const collected: Buffer[] = [];
    // 7-byte chunks force splits inside the boundary, headers, and payload.
    for (let offset = 0; offset < whole.byteLength; offset += 7) {
      collected.push(...parser.push(whole.subarray(offset, offset + 7)));
    }
    expect(collected).toHaveLength(1);
    expect(collected[0].equals(expected)).toBe(true);
  });

  it("drops a part with an unparseable Content-Length and resynchronizes", () => {
    const parser = new MjpegFrameParser();
    const good = jpeg(24, 4);
    const badHeader = Buffer.from(
      "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: abc\r\n\r\n",
      "utf8",
    );
    const trailingGarbage = Buffer.alloc(16, 9);
    const frames = parser.push(Buffer.concat([badHeader, trailingGarbage, buildPart(good)]));
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(good)).toBe(true);
  });

  it("handles an EOI marker appearing inside the JPEG payload", () => {
    const parser = new MjpegFrameParser();
    const payload = jpeg(40, 5);
    payload[20] = 0xff;
    payload[21] = 0xd9;
    const frames = parser.push(buildPart(payload));
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(payload)).toBe(true);
  });
});
