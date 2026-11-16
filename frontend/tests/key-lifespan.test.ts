import { expect, test } from "vitest";
import { KEY_MAX_DAYS, lifespanExpiry } from "@/features/applications/key-lifespan";

const now = 1_700_000_000_000;
const day = 86_400_000;

test("presets, custom days and never map to the expiry the API accepts", () => {
  expect(lifespanExpiry("7", "", now)).toBe(now + 7 * day);
  expect(lifespanExpiry("30", "", now)).toBe(now + 30 * day);
  expect(lifespanExpiry("90", "", now)).toBe(now + 90 * day);
  expect(lifespanExpiry("custom", "12", now)).toBe(now + 12 * day);
  expect(lifespanExpiry("custom", String(KEY_MAX_DAYS), now)).toBe(now + KEY_MAX_DAYS * day);
  expect(lifespanExpiry("never", "", now)).toBeNull();
});

test("a custom length must be whole days from 1 to the server's limit", () => {
  for (const value of ["", "0", "-1", "1.5", "1e2", "abc", String(KEY_MAX_DAYS + 1)])
    expect(lifespanExpiry("custom", value, now)).toBeUndefined();
});
