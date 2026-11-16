"use client";

import { SegmentedControl } from "@/components/segmented-control";

export type Lifespan = "7" | "30" | "90" | "custom" | "never";

/** The longest dated key; matches KEY_MAX_DAYS in services/application_feed.py. */
export const KEY_MAX_DAYS = 365;
const DAY_MS = 86_400_000;

const options = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "custom", label: "Custom" },
  { value: "never", label: "Never" },
] as const;

/**
 * The `expiresAt` to send: a time in milliseconds, `null` for a key with no
 * expiry, or `undefined` while a custom length is not a whole number of days
 * from 1 to KEY_MAX_DAYS. The server enforces the same bounds.
 */
export function lifespanExpiry(
  lifespan: Lifespan,
  customDays: string,
  now: number,
): number | null | undefined {
  if (lifespan === "never") return null;
  const raw = (lifespan === "custom" ? customDays : lifespan).trim();
  // Digits only: Number() alone would accept "1e2" or "0x10".
  if (!/^\d{1,4}$/.test(raw)) return undefined;
  const days = Number(raw);
  if (days < 1 || days > KEY_MAX_DAYS) return undefined;
  return now + days * DAY_MS;
}

export function KeyLifespan({
  id,
  lifespan,
  customDays,
  onLifespan,
  onCustomDays,
}: {
  id: string;
  lifespan: Lifespan;
  customDays: string;
  onLifespan: (value: Lifespan) => void;
  onCustomDays: (value: string) => void;
}) {
  return (
    <div className="field">
      <span id={`${id}-label`} className="field-label">
        Key lifespan
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Key lifespan"
          value={lifespan}
          onChange={onLifespan}
          options={options}
        />
        {lifespan === "custom" && (
          <span className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <input
              id={id}
              aria-label="Custom key lifespan in days"
              className="app-input mono w-24"
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={KEY_MAX_DAYS}
              step={1}
              value={customDays}
              onChange={(event) => onCustomDays(event.target.value)}
            />
            days
          </span>
        )}
      </div>
    </div>
  );
}
