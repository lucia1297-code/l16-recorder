import { describe, it, expect } from "vitest";
import { validatePendingRegistration } from "../core/pendingRegistration";

describe("validatePendingRegistration", () => {
  it("accepts a fully filled registration", () => {
    const errs = validatePendingRegistration({
      name: "홍길동",
      school: "창동고",
      grade: "3",
      phone: "01012345678",
    });
    expect(errs.length).toBe(0);
  });

  it("requires name, school, grade", () => {
    expect(
      validatePendingRegistration({ name: "", school: "창동고", grade: "3", phone: "01012345678" })
        .length,
    ).toBeGreaterThan(0);
    expect(
      validatePendingRegistration({ name: "홍길동", school: "", grade: "3", phone: "01012345678" })
        .length,
    ).toBeGreaterThan(0);
    expect(
      validatePendingRegistration({ name: "홍길동", school: "창동고", grade: "", phone: "01012345678" })
        .length,
    ).toBeGreaterThan(0);
  });
});
