import { describe, expect, it } from "vitest";
import { hasBearer } from "@/lib/security/bearer";

describe("hasBearer", () => {
  const secret = "cron-secret-0123456789";

  it("accepts only the exact bearer token", () => {
    expect(hasBearer(`Bearer ${secret}`, secret)).toBe(true);
    expect(hasBearer(`Bearer ${secret}x`, secret)).toBe(false);
    expect(hasBearer(`bearer ${secret}`, secret)).toBe(false);
    expect(hasBearer(secret, secret)).toBe(false);
    expect(hasBearer(null, secret)).toBe(false);
    expect(hasBearer("Bearer ", secret)).toBe(false);
  });
});
