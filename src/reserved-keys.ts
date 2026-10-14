/**
 * Keys that reach an object's prototype chain. Content never names a key or an
 * id with one: assigning `__proto__` replaces an object's prototype, a plain
 * object answers a missing `constructor` with Object's own function, and
 * `constructor.prototype` is the path to Object.prototype itself.
 */
export const RESERVED_OBJECT_KEYS: readonly string[] = Object.freeze([
  "__proto__",
  "prototype",
  "constructor",
]);
