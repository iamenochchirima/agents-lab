/** JSON values accepted by the low-level Cua browser gateway.
 *
 * Bigints are deliberately part of this type: Cua's native window_id is an
 * unsigned integer that must not pass through JavaScript's lossy number type.
 */
export type CuaJsonValue =
  | null
  | boolean
  | string
  | number
  | bigint
  | readonly CuaJsonValue[]
  | { readonly [key: string]: CuaJsonValue };

const MAX_JSON_STRING_BYTES = 64 * 1024;
const MAX_JSON_ARRAY_ITEMS = 128;
const MAX_JSON_OBJECT_KEYS = 64;
const MAX_JSON_DEPTH = 12;

function jsonString(value: string): string {
  if (Buffer.byteLength(value, "utf8") > MAX_JSON_STRING_BYTES) {
    throw new TypeError(`Cua JSON strings must be at most ${MAX_JSON_STRING_BYTES} bytes.`);
  }
  return JSON.stringify(value);
}

function encode(value: unknown, depth: number): string {
  if (depth > MAX_JSON_DEPTH) {
    throw new TypeError(`Cua JSON values may not exceed ${MAX_JSON_DEPTH} nested levels.`);
  }
  if (value === null) return "null";
  if (typeof value === "string") return jsonString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cua JSON numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_ITEMS) {
      throw new TypeError(`Cua JSON arrays may contain at most ${MAX_JSON_ARRAY_ITEMS} items.`);
    }
    return `[${value.map((item) => encode(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Cua JSON objects must be plain objects.");
    }
    const keys = Object.keys(object);
    if (keys.length > MAX_JSON_OBJECT_KEYS) {
      throw new TypeError(`Cua JSON objects may contain at most ${MAX_JSON_OBJECT_KEYS} keys.`);
    }
    return `{${keys.map((key) => `${jsonString(key)}:${encode(object[key], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported Cua JSON value type: ${typeof value}.`);
}

/** Encode a bounded Cua argument object without coercing bigint to number. */
export function encodeCuaJson(value: CuaJsonValue): string {
  return encode(value, 0);
}
