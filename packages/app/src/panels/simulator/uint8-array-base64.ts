// Hand-rolled base64 encoder for JPEG mirror frames. Runs on web (btoa exists)
// and native (no Buffer polyfill), so the frame bytes can ride a data URI into
// a plain <Image> on every platform.
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const n = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    out +=
      BASE64_ALPHABET[n >> 18] +
      BASE64_ALPHABET[(n >> 12) & 0x3f] +
      BASE64_ALPHABET[(n >> 6) & 0x3f] +
      BASE64_ALPHABET[n & 0x3f];
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const n = bytes[index] << 16;
    out += BASE64_ALPHABET[n >> 18] + BASE64_ALPHABET[(n >> 12) & 0x3f] + "==";
  } else if (remaining === 2) {
    const n = (bytes[index] << 16) | (bytes[index + 1] << 8);
    out +=
      BASE64_ALPHABET[n >> 18] +
      BASE64_ALPHABET[(n >> 12) & 0x3f] +
      BASE64_ALPHABET[(n >> 6) & 0x3f] +
      "=";
  }
  return out;
}
