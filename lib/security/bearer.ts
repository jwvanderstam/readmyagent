import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare an `Authorization: Bearer <token>` header with the expected secret in constant time.
 * Hashing first gives equal-length inputs, so the length of the secret does not leak either.
 */
export function hasBearer(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(secret));
}
