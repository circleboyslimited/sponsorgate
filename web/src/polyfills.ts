// The Stellar SDK expects Node's Buffer; browsers don't have it.
import { Buffer } from "buffer";

if (!("Buffer" in globalThis)) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
