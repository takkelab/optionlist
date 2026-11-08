import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PortGuard, PortInUseError } from "../../src/infra/PortGuard";
import { TestApp } from "../fakes/TestApp";

// 8000 番ポートの衝突チェック（process.md §2 の例）と待ち受けの開始。実際のソケットを使う
const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

describe("PortGuard.ensureFree", () => {
  it("rejects with a message naming the port when something is listening", async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const check = new PortGuard(500).ensureFree(port);
    await expect(check).rejects.toBeInstanceOf(PortInUseError);
    await expect(check).rejects.toThrow(`${port} 番ポート`);
  });

  it("rejects when something is listening only on ::1", async (context) => {
    const server = net.createServer();
    const listened = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(0, "::1", () => resolve(true));
    });
    // IPv6 が無効な環境では確かめられない
    if (!listened) context.skip();
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    await expect(new PortGuard(500).ensureFree(port)).rejects.toBeInstanceOf(PortInUseError);
  });

  it("resolves when nothing is listening", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));

    await expect(new PortGuard(500).ensureFree(port)).resolves.toBeUndefined();
  });
});

describe("ExpressApp.listen", () => {
  it("resolves with the listening server", async () => {
    const server = await new TestApp().listen(0);
    servers.push(server);
    expect(server.listening).toBe(true);
  });

  it("rejects with EADDRINUSE when the port is taken", async () => {
    const server = await new TestApp().listen(0);
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    await expect(new TestApp().listen(port)).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
