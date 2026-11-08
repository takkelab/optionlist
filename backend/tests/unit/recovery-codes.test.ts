import { describe, expect, it } from "vitest";
import { CryptoRandomIndex, RecoveryCodes } from "../../src/services/RecoveryCodes";
import { SequenceRandom } from "../fakes/SequenceRandom";

// 復旧コード（data.md §3）: 0・O・1・I・L を除く 31 文字の 16 文字。4 文字ずつハイフンで区切る
describe("RecoveryCodes", () => {
  it("builds 16 characters from the 31-character alphabet in groups of 4", () => {
    const codes = new RecoveryCodes(new SequenceRandom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 29, 30]));
    expect(codes.next()).toBe("2345-6789-ABCD-EFYZ");
  });

  it("never uses the confusing characters 0, O, 1, I and L", () => {
    const codes = new RecoveryCodes(new CryptoRandomIndex());
    for (let i = 0; i < 200; i++) expect(codes.next()).toMatch(/^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
  });

  it.each([
    ["ABCD-EFGH-JKMN-PQRS", "ABCDEFGHJKMNPQRS"],
    ["abcd efgh jkmn pqrs", "ABCDEFGHJKMNPQRS"],
    [" abcd-EFGH　jkmn－pqrs ", "ABCDEFGHJKMNPQRS"],
    ["ABCDEFGHJKMNPQRS", "ABCDEFGHJKMNPQRS"],
  ])("normalizes %j", (input, expected) => {
    expect(new RecoveryCodes(new CryptoRandomIndex()).normalize(input)).toBe(expected);
  });

  it.each(["", "ABCD-EFGH-JKMN-PQR", "ABCD-EFGH-JKMN-PQRST", "ABCD-EFGH-JKMN-PQR0", "ABCD-EFGH-JKMN-PQRI", "ABCD-EFGH-JKMN-PQR!"])(
    "rejects %j",
    (input) => {
      expect(new RecoveryCodes(new CryptoRandomIndex()).normalize(input)).toBeNull();
    },
  );
});
