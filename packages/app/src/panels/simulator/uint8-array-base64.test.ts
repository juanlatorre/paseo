import { describe, expect, it } from "vitest";

import { uint8ArrayToBase64 } from "./uint8-array-base64.js";

describe("uint8ArrayToBase64", () => {
  it("matches btoa for ascii inputs", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const bytes = new TextEncoder().encode(text);
    expect(uint8ArrayToBase64(bytes)).toBe(btoa(text));
  });

  it("pads one and two trailing bytes", () => {
    expect(uint8ArrayToBase64(new Uint8Array([0x66]))).toBe(btoa("f"));
    expect(uint8ArrayToBase64(new Uint8Array([0x66, 0x6f]))).toBe(btoa("fo"));
    expect(uint8ArrayToBase64(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe(btoa("foo"));
  });

  it("encodes JPEG start-of-image bytes", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(uint8ArrayToBase64(jpeg)).toBe(Buffer.from(jpeg).toString("base64"));
  });

  it("handles empty input", () => {
    expect(uint8ArrayToBase64(new Uint8Array(0))).toBe("");
  });
});
