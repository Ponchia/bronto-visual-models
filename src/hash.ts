import { digest } from "lib0/hash/sha256";
const TEXT_ENCODER = new TextEncoder();

/**
 * SHA-256 of a string's UTF-8 bytes, as lowercase hex. Byte-for-byte identical
 * to `createHash("sha256").update(input).digest("hex")` — the handle vocabulary
 * agents already hold depends on that, so the differential test against
 * `node:crypto` in this module's suite is the contract, not a formality.
 */
export function sha256Hex(input: string): string {
  return sha256BytesHex(TEXT_ENCODER.encode(input));
}

/**
 * SHA-256 of exact bytes, as lowercase hex.
 *
 * Kept beside `sha256Hex` so browser-safe callers that already own an
 * unambiguous byte encoding do not have to round-trip it through a JavaScript
 * string. `sha256Hex` remains the public UTF-8 string contract above.
 */
export function sha256BytesHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of digest(bytes)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

