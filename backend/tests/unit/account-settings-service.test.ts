import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { AccountHasher } from "../../src/services/AccountHasher";
import { AccountSettingsService } from "../../src/services/AccountSettingsService";
import { AppError } from "../../src/services/errors";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { RecoveryCodes } from "../../src/services/RecoveryCodes";
import { FakeAccountStore, FixedSessionKeys } from "../fakes/FakeAccountStore";
import { FakeLogger } from "../fakes/FakeLogger";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";
import { SequenceRandom } from "../fakes/SequenceRandom";

const SECRET = "secret";
const KEY = "k".repeat(43);
const CREATED = "2026-11-01T00:00:00.000Z";
// SequenceRandom([8, 9, 10, 11]) が作るコード
const CODE = "ABCD-ABCD-ABCD-ABCD";

describe("AccountSettingsService", () => {
  let store: FakeAccountStore;
  let files: FakePhotoFiles;
  let metrics: PromMetrics;
  let service: AccountSettingsService;
  const sha256 = (value: string): string => {
    const hash = createHash("sha256");
    hash.update(value);
    return hash.digest("hex");
  };
  const failure = async (run: Promise<unknown>): Promise<unknown> => {
    const error = await run.then(() => null, (caught: unknown) => caught);
    if (!(error instanceof AppError)) throw new Error(`AppError ではない: ${String(error)}`);
    return { status: error.status(), retryAfter: error.retryAfterSeconds(), extra: error.extra() };
  };

  beforeEach(() => {
    store = new FakeAccountStore();
    files = new FakePhotoFiles();
    metrics = new PromMetrics();
    service = new AccountSettingsService({
      accounts: store,
      users: store,
      photos: new PhotoCleanup(files, metrics, new FakeLogger()),
      keys: new FixedSessionKeys([KEY]),
      codes: new RecoveryCodes(new SequenceRandom([8, 9, 10, 11])),
      hasher: new AccountHasher(SECRET),
    });
  });

  describe("status", () => {
    it("answers no account without a user or a row", async () => {
      const none = { hasAccount: false, hasRecoveryCode: false, createdAt: null };
      expect(await service.status(null)).toEqual(none);
      expect(await service.status(3)).toEqual(none);
    });

    it("answers the account and whether a recovery code is issued", async () => {
      store.giveRow(3, { createdAt: new Date(CREATED), hasRecoveryCode: true });
      expect(await service.status(3)).toEqual({ hasAccount: true, hasRecoveryCode: true, createdAt: CREATED });
    });
  });

  describe("issueRecoveryCode", () => {
    // DB に入れるのは正規化したコードの SHA-256 だけ。平文は応答でだけ返す
    it("returns the code and stores only the hash of the normalized code", async () => {
      store.giveRow(3, { createdAt: new Date(CREATED), hasRecoveryCode: false });
      expect(await service.issueRecoveryCode(3)).toEqual({ code: CODE });
      expect(store.codeOf(3)).toBe(sha256("ABCDABCDABCDABCD"));
      expect(await service.status(3)).toMatchObject({ hasRecoveryCode: true });
    });

    it.each([[null], [3]])("answers 404 without an account (%s)", async (userId) => {
      expect(await failure(service.issueRecoveryCode(userId))).toMatchObject({ status: 404 });
    });
  });

  describe("restore", () => {
    it("rejects a code of the wrong shape with 400 without asking the store", async () => {
      expect(await failure(service.restore(null, "ip", { code: "ABCD", replace: false }))).toMatchObject({ status: 400 });
      expect(store.restores()).toEqual([]);
    });

    it("passes the hashes of the normalized code and a new key, the HMAC of the IP, the current user and replace", async () => {
      store.answerRestore({ status: "ok", userId: 5 });
      expect(await service.restore(null, "203.0.113.1", { code: " abcd-abcd abcd-abcd ", replace: true })).toEqual({ userId: 5, sessionKey: KEY });
      const hmac = createHmac("sha256", SECRET);
      hmac.update("203.0.113.1");
      expect(store.restores()).toEqual([
        { codeHash: sha256("ABCDABCDABCDABCD"), newSessionHash: sha256(KEY), ipHash: hmac.digest("hex"), currentUserId: null, replace: true },
      ]);
    });

    it.each([
      [{ status: "not_found" } as const, { status: 404, retryAfter: null, extra: {} }],
      [{ status: "rate_limited", retryAfterSeconds: 90 } as const, { status: 429, retryAfter: 90, extra: {} }],
      [{ status: "needs_confirm", localItemCount: 4 } as const, { status: 409, retryAfter: null, extra: { localItemCount: 4 } }],
    ])("turns %j into an error", async (result, expected) => {
      store.answerRestore(result);
      store.giveRow(3, { createdAt: new Date(CREATED), hasRecoveryCode: false });
      expect(await failure(service.restore(3, "ip", { code: CODE, replace: false }))).toEqual(expected);
      expect(store.removed()).toEqual([]);
    });

    // 今の端末の別のアカウントは、移ったあとに消す（行と写真のファイル）
    it("removes the other account on this device after moving", async () => {
      const photo = await files.save(Buffer.from("x"), "jpg");
      store.giveRow(3, { createdAt: new Date(CREATED), hasRecoveryCode: false }, [photo]);
      store.answerRestore({ status: "ok", userId: 5 });
      await service.restore(3, "ip", { code: CODE, replace: true });
      expect([store.removed(), files.names()]).toEqual([[3], []]);
    });

    it("removes nothing when the code is of the account on this device", async () => {
      store.answerRestore({ status: "ok", userId: 3 });
      await service.restore(3, "ip", { code: CODE, replace: false });
      expect(store.removed()).toEqual([]);
    });
  });

  describe("removeAll", () => {
    it("does nothing without an account", async () => {
      await service.removeAll(null);
      expect(store.removed()).toEqual([]);
    });

    // 行を消したあとでファイルを消す。ファイルを消せなくても成功し、orphan_file_errors_total が増える
    it("removes the rows and then the photo files, and still succeeds when a file cannot be removed", async () => {
      const photo = await files.save(Buffer.from("x"), "jpg");
      store.giveRow(3, { createdAt: new Date(CREATED), hasRecoveryCode: false }, [photo]);
      files.failRemoving();
      await service.removeAll(3);
      expect([store.removed(), files.names()]).toEqual([[3], [photo]]);
      expect(await metrics.render()).toContain("orphan_file_errors_total 1");
    });
  });
});
