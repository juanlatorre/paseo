// Parser for multipart/x-mixed-replace MJPEG streams as produced by serve-sim:
//
//   --frame\r\nContent-Type: image/jpeg\r\nContent-Length: 278230\r\n\r\n<jpeg bytes>\r\n
//
// Parts are separated by the boundary declared in the response Content-Type.
// Content-Length lets us slice exact JPEG payloads instead of scanning for the
// EOI marker, which can legitimately appear inside JPEG entropy-coded data.
export class MjpegFrameParser {
  private buffer = Buffer.alloc(0);
  private readonly boundary: Buffer;

  constructor(boundary = "frame") {
    this.boundary = Buffer.from(`--${boundary}`, "utf8");
  }

  /** Feeds bytes and returns every complete JPEG frame they completed. */
  push(chunk: Uint8Array): Buffer[] {
    this.buffer =
      this.buffer.byteLength === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const frames: Buffer[] = [];
    for (;;) {
      const frame = this.extractNextFrame();
      if (!frame) {
        break;
      }
      frames.push(frame);
    }
    return frames;
  }

  private extractNextFrame(): Buffer | null {
    const boundaryIndex = this.buffer.indexOf(this.boundary);
    if (boundaryIndex < 0) {
      // Keep a tail in case a boundary is split across chunks.
      this.trimProcessed(this.buffer.byteLength);
      return null;
    }
    const headerStart = boundaryIndex + this.boundary.byteLength;
    const headerEnd = this.buffer.indexOf("\r\n\r\n", headerStart);
    if (headerEnd < 0) {
      this.trimProcessed(boundaryIndex);
      return null;
    }
    const headerText = this.buffer.subarray(headerStart, headerEnd).toString("utf8");
    const contentLength = parseContentLength(headerText);
    if (contentLength === null) {
      // Malformed part header: drop through this boundary and resynchronize.
      this.buffer = this.buffer.subarray(headerEnd + 4);
      return this.extractNextFrame();
    }
    const payloadStart = headerEnd + 4;
    const payloadEnd = payloadStart + contentLength;
    if (this.buffer.byteLength < payloadEnd) {
      this.trimProcessed(boundaryIndex);
      return null;
    }
    const frame = Buffer.from(this.buffer.subarray(payloadStart, payloadEnd));
    this.buffer = this.buffer.subarray(payloadEnd);
    return frame;
  }

  // Drops consumed bytes from the front while preserving everything from
  // `keepFrom` onward, so a partial part header is not lost.
  private trimProcessed(keepFrom: number): void {
    if (keepFrom <= 0) {
      return;
    }
    this.buffer = this.buffer.subarray(keepFrom);
  }
}

function parseContentLength(headerText: string): number | null {
  for (const line of headerText.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    if (name !== "content-length") {
      continue;
    }
    const value = Number.parseInt(line.slice(separator + 1).trim(), 10);
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    return null;
  }
  return null;
}
