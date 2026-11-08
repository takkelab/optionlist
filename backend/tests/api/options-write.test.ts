import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MySqlDatabase } from "../../src/infra/MySqlDatabase";
import { MySqlPoolFactory } from "../../src/infra/MySqlPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";

// POST・PATCH・DELETE /api/options、PUT /api/options/order（api.md §2、testing.md §2）
const pool = new MySqlPoolFactory(process.env).create();
const data = new TestDatabase(pool);
const api = new OptionsApiClient(new TestApp({ db: new MySqlDatabase(pool, new PromMetrics()) }).build());
const VALIDATION_ERROR = { error: { code: "VALIDATION_ERROR" } };
const NOT_FOUND = { error: { code: "NOT_FOUND" } };
const PENDING = "?status=pending";

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  await pool.end();
});

describe("POST /api/options", () => {
  it("adds an option at the top of the pending list", async () => {
    const first = await api.added("  a  ");
    await api.added("b", 1);
    expect(first).toMatchObject({ title: "a", status: "pending", suggestionId: null, achievementCount: 0, completedAt: null });
    expect(first).toMatchObject({ createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) });
    expect(await api.titles(PENDING)).toEqual(["b", "a"]);
  });

  it("returns 409 when the suggestion is already added", async () => {
    await api.added("a", 1);
    const { status, body } = await api.create({ title: "a", suggestionId: 1 });
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: { code: "CONFLICT" } });
  });

  it.each([9999, 4_294_967_296])("returns 404 for the unknown suggestion %d", async (suggestionId) => {
    const { status, body } = await api.create({ title: "a", suggestionId });
    expect(status).toBe(404);
    expect(body).toMatchObject(NOT_FOUND);
  });

  it("stores a 200-character title of emoji (utf8mb4, VARCHAR(200))", async () => {
    const title = "🎉".repeat(200);
    expect(await api.added(title)).toMatchObject({ title });
    expect(await api.titles(PENDING)).toEqual([title]);
  });

  // 全角スペース（U+3000）だけのタイトルも空とみなす（data.md §3）
  it.each([{}, { title: " " }, { title: "　　" }, { title: "a".repeat(201) }])("returns 400 for %j", async (request) => {
    const { status, body } = await api.create(request);
    expect(status).toBe(400);
    expect(body).toMatchObject(VALIDATION_ERROR);
  });
});

describe("PATCH /api/options/:id", () => {
  it("updates the title", async () => {
    const { id } = await api.added("a");
    const { status, body } = await api.patch(id, { title: "renamed" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id, title: "renamed" });
  });

  it("moves an option to the done list and back to the top of the pending list", async () => {
    const { id } = await api.added("a");
    await api.added("b");
    await api.added("c");

    const done = await api.patch(id, { status: "completed" });
    expect(done).toMatchObject({ status: 200, body: { status: "completed", completedAt: expect.any(String) } });
    expect(await api.titles(PENDING)).toEqual(["c", "b"]);
    expect(await api.titles("?status=completed")).toEqual(["a"]);

    const back = await api.patch(id, { status: "pending" });
    expect(back).toMatchObject({ status: 200, body: { status: "pending", completedAt: null } });
    expect(await api.titles(PENDING)).toEqual(["a", "c", "b"]);
  });

  it("keeps a completed option in the done list when only the title changes", async () => {
    const { id } = await api.added("a");
    await api.patch(id, { status: "completed" });
    expect(await api.patch(id, { title: "renamed" })).toMatchObject({ status: 200, body: { status: "completed" } });
    expect(await api.titles("?status=completed")).toEqual(["renamed"]);
    expect(await api.titles(PENDING)).toEqual([]);
  });

  it("sets and clears the plan date, and returns the option", async () => {
    const { id } = await api.added("a");
    const set = await api.patch(id, { plannedOn: "2028-02-29" });
    expect(set).toMatchObject({ status: 200, body: { id, plannedOn: "2028-02-29" } });
    expect(set.body).not.toHaveProperty("achievements");
    expect(await api.detail(id)).toMatchObject({ body: { plannedOn: "2028-02-29" } });
    const cleared = await api.patch(id, { plannedOn: null });
    expect(cleared).toMatchObject({ status: 200, body: { plannedOn: null } });
  });

  it("moves an option to the top of the ones without a plan date when its date is cleared", async () => {
    const a = await api.added("a");
    await api.added("b");
    const c = await api.added("c");
    await api.patch(a.id, { plannedOn: "2028-02-29" });
    await api.patch(c.id, { plannedOn: "2028-03-01" });
    expect(await api.titles(PENDING)).toEqual(["a", "c", "b"]);
    await api.patch(a.id, { plannedOn: null });
    expect(await api.titles(PENDING)).toEqual(["c", "a", "b"]);
  });

  it.each(["999", "abc"])("returns 404 for the id %s", async (id) => {
    expect(await api.patch(id, { title: "x" })).toMatchObject({ status: 404, body: NOT_FOUND });
  });

  it.each([
    {},
    { title: "" },
    { title: "a".repeat(201) },
    { status: "done" },
    { plannedOn: "2026-02-29" },
    { plannedOn: "2026-11-23T00:00:00Z" },
    { plannedOn: "0999-12-31" },
    { plannedOn: 20261123 },
  ])("returns 400 for %j", async (request) => {
    const { id } = await api.added("a");
    expect(await api.patch(id, request)).toMatchObject({ status: 400, body: VALIDATION_ERROR });
  });
});

describe("DELETE /api/options/:id", () => {
  it("deletes the option with its achievements", async () => {
    const { id } = await api.added("a");
    const other = await api.added("b");
    await pool.query("INSERT INTO achievements (option_id, achieved_at) VALUES (?, NOW(3)), (?, NOW(3))", [id, other.id]);

    expect(await api.remove(id)).toMatchObject({ status: 204, text: "" });
    expect(await api.detail(id)).toMatchObject({ status: 404 });
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS achievements FROM achievements",
    );
    expect(rows).toEqual([{ achievements: 1 }]);
  });

  it.each(["999", "abc"])("returns 404 for the id %s", async (id) => {
    expect(await api.remove(id)).toMatchObject({ status: 404, body: NOT_FOUND });
  });
});

describe("PUT /api/options/order", () => {
  it("reorders all pending options and keeps the order for later additions", async () => {
    const a = await api.added("a");
    const b = await api.added("b");
    const c = await api.added("c");
    expect(await api.reorder({ ids: [a.id, c.id, b.id] })).toMatchObject({ status: 204, text: "" });
    expect(await api.titles(PENDING)).toEqual(["a", "c", "b"]);
    await api.added("d");
    expect(await api.titles(PENDING)).toEqual(["d", "a", "c", "b"]);
  });

  it("renumbers every pending option when a moved one does not fit between its neighbours", async () => {
    await pool.query(
      `INSERT INTO options (id, title, sort_order, created_at, updated_at) VALUES
       (1, 'a', 1, NOW(3), NOW(3)), (2, 'b', 2, NOW(3), NOW(3)), (3, 'c', 3, NOW(3), NOW(3))`,
    );
    expect(await api.reorder({ ids: [1, 3, 2] })).toMatchObject({ status: 204 });
    expect(await api.titles(PENDING)).toEqual(["a", "c", "b"]);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT id, sort_order FROM options ORDER BY sort_order");
    expect(rows).toEqual([
      { id: 1, sort_order: 1024 },
      { id: 3, sort_order: 2048 },
      { id: 2, sort_order: 3072 },
    ]);
  });

  it("accepts an empty list when there is no pending option", async () => {
    expect(await api.reorder({ ids: [] })).toMatchObject({ status: 204 });
  });

  it("returns 400 for duplicated, completed or unknown ids", async () => {
    const { id } = await api.added("a");
    const other = await api.added("b");
    const done = await api.added("c");
    await api.patch(done.id, { status: "completed" });
    for (const ids of [[id, id], "x", [id, other.id, done.id], [id, other.id, 999]]) {
      expect(await api.reorder({ ids })).toMatchObject({ status: 400, body: VALIDATION_ERROR });
    }
  });
});

// PC とスマホから使う（SPEC.md §1.2）。片方の画面が、もう片方の変更を読み直す前に操作したとき
describe("two devices", () => {
  it("keeps options added on the other device at the top when reordering from an old list", async () => {
    const a = await api.added("a");
    const b = await api.added("b");
    const c = await api.added("c");
    // PC の画面は c・b・a のまま。スマホで d を追加した
    await api.added("d");
    expect(await api.reorder({ ids: [a.id, c.id, b.id] })).toMatchObject({ status: 204 });
    expect(await api.titles(PENDING)).toEqual(["d", "a", "c", "b"]);
  });

  it("rejects a reorder that still contains an option completed or deleted on the other device", async () => {
    const a = await api.added("a");
    const b = await api.added("b");
    const c = await api.added("c");
    await api.patch(b.id, { status: "completed" });
    expect(await api.reorder({ ids: [a.id, b.id, c.id] })).toMatchObject({ status: 400, body: VALIDATION_ERROR });
    await api.remove(c.id);
    expect(await api.reorder({ ids: [a.id, c.id] })).toMatchObject({ status: 400, body: VALIDATION_ERROR });
  });

  it("returns 404 when updating or deleting an option deleted on the other device", async () => {
    const { id } = await api.added("a");
    await api.remove(id);
    expect(await api.patch(id, { title: "x" })).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(await api.remove(id)).toMatchObject({ status: 404, body: NOT_FOUND });
  });

  it("adds both options when the two devices add at the same time", async () => {
    const results = await Promise.all([api.create({ title: "pc" }), api.create({ title: "phone" })]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect((await api.titles(PENDING)).toSorted()).toEqual(["pc", "phone"]);
  });

  it("lets only one device add the same suggestion", async () => {
    const results = await Promise.all([api.create({ title: "s", suggestionId: 1 }), api.create({ title: "s", suggestionId: 1 })]);
    expect(results.map((r) => r.status).toSorted()).toEqual([201, 409]);
    expect(await api.titles(PENDING)).toEqual(["s"]);
  });
});
