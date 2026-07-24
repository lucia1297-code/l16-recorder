import { describe, it, expect } from "vitest";
import {
  GRACE_PERIOD_DAYS,
  isInGracePeriod,
  gracePeriodDaysRemaining,
} from "../core/gracePeriod";

describe("GRACE_PERIOD_DAYS", () => {
  it("is 14 days (2 weeks) as requested", () => {
    expect(GRACE_PERIOD_DAYS).toBe(14);
  });
});

describe("isInGracePeriod", () => {
  it("returns true when registered less than 14 days ago", () => {
    const registeredAt = "2026-07-10T00:00:00.000Z";
    const now = new Date("2026-07-15T00:00:00.000Z"); // 5일 후
    expect(isInGracePeriod(registeredAt, now)).toBe(true);
  });

  it("returns false when registered more than 14 days ago", () => {
    const registeredAt = "2026-07-01T00:00:00.000Z";
    const now = new Date("2026-07-20T00:00:00.000Z"); // 19일 후
    expect(isInGracePeriod(registeredAt, now)).toBe(false);
  });

  it("returns false when registeredAt is missing (pre-existing students)", () => {
    expect(isInGracePeriod(undefined, new Date())).toBe(false);
  });

  it("returns false exactly at the 14-day boundary", () => {
    const registeredAt = "2026-07-01T00:00:00.000Z";
    const now = new Date("2026-07-15T00:00:00.000Z"); // 정확히 14일 후
    expect(isInGracePeriod(registeredAt, now)).toBe(false);
  });
});

describe("gracePeriodDaysRemaining", () => {
  it("returns the number of days left in the grace period", () => {
    const registeredAt = "2026-07-10T00:00:00.000Z";
    const now = new Date("2026-07-15T00:00:00.000Z"); // 5일 경과
    expect(gracePeriodDaysRemaining(registeredAt, now)).toBe(9);
  });

  it("returns 0 when the grace period has ended or registeredAt is missing", () => {
    expect(gracePeriodDaysRemaining(undefined, new Date())).toBe(0);
    const registeredAt = "2026-07-01T00:00:00.000Z";
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(gracePeriodDaysRemaining(registeredAt, now)).toBe(0);
  });
});
