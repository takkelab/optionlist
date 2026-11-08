import { describe, expect, it } from "vitest";
import { AppError } from "../../src/services/errors";

describe("AppError", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
  ] as const)("maps %s to %i", (code, status) => {
    const error = new AppError(code, "message");
    expect(error.code()).toBe(code);
    expect(error.status()).toBe(status);
    expect(error.message).toBe("message");
    expect(error).toBeInstanceOf(Error);
  });
});
