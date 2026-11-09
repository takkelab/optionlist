import { describe, expect, it } from "vitest";
import { JsonLogger } from "../../src/infra/JsonLogger";
import type { LogEntry } from "../../src/middleware/Middleware";
import { FakeLineWriter } from "../fakes/FakeLineWriter";

// JSON のログ（architecture.md §4.3。docs/decisions/0042・0050）
// Cookie の鍵と同じ作り方（32 バイトの base64url。RandomSessionKeys）
const SESSION_KEY = Buffer.alloc(32, 0xab).toString("base64url");
const RECOVERY_CODE = "ABCD-EFGH-JKMN-PQRS";
const TITLE = "秘密のタイトル";

describe("JsonLogger", () => {
  it("writes one JSON line with severity, kind, route, status and durationMs", () => {
    const writer = new FakeLineWriter();
    new JsonLogger(writer).info({ kind: "server_started", message: "起動した", route: "/api/health", status: 200, durationMs: 3 });
    expect(writer.errLines()).toEqual([]);
    const [line = ""] = writer.outLines();
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      severity: "INFO",
      message: "起動した",
      kind: "server_started",
      route: "/api/health",
      status: 200,
      durationMs: 3,
    });
  });

  it("writes errors to stderr with only the name, message, code and stack of the error", () => {
    const writer = new FakeLineWriter();
    const error = Object.assign(new Error("duplicate key"), { code: "23505", detail: `Failing row contains (1, ${TITLE})` });
    new JsonLogger(writer).error({ kind: "unhandled_error", message: "想定外のエラー", error, route: "/api/options/:id", status: 500 });
    const [line = ""] = writer.errLines();
    const parsed: unknown = JSON.parse(line);
    expect(parsed).toMatchObject({ severity: "ERROR", kind: "unhandled_error", route: "/api/options/:id", status: 500 });
    expect(parsed).toHaveProperty("error.name", "Error");
    expect(parsed).toHaveProperty("error.code", "23505");
    expect(parsed).not.toHaveProperty("error.detail");
    expect(line).not.toContain(TITLE);
  });

  it("does not let keys outside the allowed fields into the line", () => {
    const writer = new FakeLineWriter();
    const entry = { kind: "orphan_file_error" as const, message: "x", title: TITLE, cookie: `ol_session=${SESSION_KEY}` };
    const typed: LogEntry = entry;
    new JsonLogger(writer).error(typed);
    const [line = ""] = writer.errLines();
    expect(line).not.toContain(TITLE);
    expect(line).not.toContain(SESSION_KEY);
  });

  it.each([
    ["a Cookie header", `Cookie: ol_session=${SESSION_KEY}; other=1`],
    ["a __Host- Cookie", `__Host-ol_session=${SESSION_KEY}`],
    ["a bare session key", `key ${SESSION_KEY} was rejected`],
    ["a recovery code", `code ${RECOVERY_CODE} did not match`],
    ["a recovery code without hyphens", `code ${RECOVERY_CODE.replaceAll("-", "")} did not match`],
    ["a lowercase recovery code with spaces", `code ${RECOVERY_CODE.toLowerCase().replaceAll("-", " ")} did not match`],
    ["a recovery code with mixed separators", "code ABCD-EFGH JKMN\t- PQRS did not match"],
    ["a recovery code with full-width separators", "code ABCD－EFGHーJKMN‐PQRS did not match"],
  ])("redacts %s in the message and in the error", (_name, text) => {
    const writer = new FakeLineWriter();
    const logger = new JsonLogger(writer);
    logger.error({ kind: "unhandled_error", message: text, error: new Error(text) });
    logger.error({ kind: "unhandled_error", message: "x", error: text });
    const output = writer.errLines().join("\n");
    expect(output).not.toContain(SESSION_KEY);
    expect(output.toUpperCase()).not.toMatch(/ABCD.?EFGH.?JKMN.?PQRS/);
    expect(output).toContain("[redacted]");
  });

  it("keeps ordinary text", () => {
    const writer = new FakeLineWriter();
    new JsonLogger(writer).info({ kind: "server_started", message: "server running at: http://localhost:8000" });
    const expected = { severity: "INFO", message: "server running at: http://localhost:8000", kind: "server_started" };
    expect(writer.outLines()).toEqual([JSON.stringify(expected)]);
  });
});
