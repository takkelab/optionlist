import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOMAIN, envConfig } from "../../infra/config.ts";
import { domainMappingBody } from "../../infra/domain.ts";
import type { DomainMapping } from "../../infra/domain.ts";
import { domainMappingProblems } from "../lib/domain-checks.ts";
import type { ResolvedRecords } from "../lib/domain-checks.ts";

const ready = [
  { type: "Ready", status: "True" },
  { type: "CertificateProvisioned", status: "True" },
  { type: "DomainRoutable", status: "True" },
];
const apexRecords = [
  { type: "A", rrdata: "216.239.32.21" },
  { type: "A", rrdata: "216.239.34.21" },
  { type: "AAAA", rrdata: "2001:4860:4802:32::15" },
];
const mapping = (env: "staging" | "production", status: DomainMapping["status"]): DomainMapping => ({ ...domainMappingBody(env), status });
const apexDns: ResolvedRecords = new Map([
  ["A", ["216.239.34.21", "216.239.32.21"]],
  ["AAAA", ["2001:4860:4802:32::15"]],
]);

describe("独自ドメインの割り当て", () => {
  it("本番は apex、確認用は staging. で、APP_ORIGIN はそのオリジン", () => {
    assert.equal(envConfig("production").origin, `https://${DOMAIN}`);
    assert.equal(envConfig("staging").origin, `https://staging.${DOMAIN}`);
  });
});

describe("domainMappingProblems", () => {
  it("証明書が出ていて、DNS が決めたレコードを返せば合格（順番と末尾の . は問わない）", () => {
    assert.deepEqual(domainMappingProblems("production", mapping("production", { conditions: ready, resourceRecords: apexRecords }), apexDns), []);
    const cname = mapping("staging", { conditions: ready, resourceRecords: [{ name: "staging", type: "CNAME", rrdata: "ghs.googlehosted.com." }] });
    assert.deepEqual(domainMappingProblems("staging", cname, new Map([["CNAME", ["ghs.googlehosted.com"]]])), []);
  });

  it("マッピングがなければ、作る手順を出す", () => {
    assert.match(domainMappingProblems("staging", null, new Map()).join("\n"), /infra:setup -- domain staging/);
  });

  it("別のサービスを指していれば不合格", () => {
    const wrong: DomainMapping = { ...mapping("production", { conditions: ready, resourceRecords: apexRecords }), spec: { routeName: "optionlist-staging", certificateMode: "AUTOMATIC" } };
    assert.match(domainMappingProblems("production", wrong, apexDns).join("\n"), /optionlist-staging を指している/);
  });

  it("証明書がまだなら不合格", () => {
    const pending = [{ type: "Ready", status: "Unknown" }, { type: "CertificateProvisioned", status: "Unknown", message: "Waiting for certificate provisioning." }, { type: "DomainRoutable", status: "True" }];
    const problems = domainMappingProblems("production", mapping("production", { conditions: pending, resourceRecords: apexRecords }), apexDns);
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /CertificateProvisioned が True でない（Waiting for certificate provisioning\.）/);
  });

  it("DNS が足りない・Cloudflare のプロキシの IP を返すなら不合格", () => {
    const proxied: ResolvedRecords = new Map([["A", ["104.21.1.1", "172.67.1.1"]], ["AAAA", []]]);
    const problems = domainMappingProblems("production", mapping("production", { conditions: ready, resourceRecords: apexRecords }), proxied);
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /プロキシはオフ/);
  });

  it("確認用の CNAME が引けない（プロキシがオンなど）なら不合格", () => {
    const cname = mapping("staging", { conditions: ready, resourceRecords: [{ name: "staging", type: "CNAME", rrdata: "ghs.googlehosted.com." }] });
    assert.match(domainMappingProblems("staging", cname, new Map([["CNAME", []]])).join("\n"), /CNAME が違う.*（なし）/);
  });

  it("証明書が自動でない・条件がまだないなら不合格", () => {
    const manual: DomainMapping = { ...mapping("production", { resourceRecords: apexRecords }), spec: { routeName: "optionlist-production", certificateMode: "NONE" } };
    const problems = domainMappingProblems("production", manual, apexDns);
    assert.match(problems.join("\n"), /自動（AUTOMATIC）でない/);
    assert.equal(problems.filter((p) => p.includes("まだない")).length, 3);
  });

  it("レコードをまだ出していなければ不合格", () => {
    assert.match(domainMappingProblems("production", mapping("production", { conditions: ready }), apexDns).join("\n"), /レコードを出していない/);
  });
});
