// 独自ドメイン（docs/decisions/0063）の判定。scripts/infra-check.ts が gcloud の REST と DNS で読んだものを渡す（ここは読まない）
import { envConfig } from "../../infra/config.ts";
import type { EnvName } from "../../infra/config.ts";
import type { DomainMapping } from "../../infra/domain.ts";

// DNS で引いた値（種類 → 値）。引けなかった種類は空の配列
export type ResolvedRecords = Map<string, string[]>;

// 証明書・ルーティングが済んだかの条件（どれも True になってはじめて https で使える）
const READY_CONDITIONS = ["Ready", "CertificateProvisioned", "DomainRoutable"] as const;

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\.$/, "");

// マッピングが出せと言っている種類。apex は A・AAAA、サブドメインは CNAME
export const expectedRecords = (mapping: DomainMapping): Map<string, string[]> => {
  const records = new Map<string, string[]>();
  for (const r of mapping.status?.resourceRecords ?? []) {
    if (r.type === undefined || r.rrdata === undefined) continue;
    records.set(r.type, [...(records.get(r.type) ?? []), normalize(r.rrdata)]);
  }
  return records;
};

export const domainMappingProblems = (env: EnvName, mapping: DomainMapping | null, resolved: ResolvedRecords): string[] => {
  const c = envConfig(env);
  const label = `ドメインマッピング ${c.domain}`;
  if (mapping === null) return [`${label} がない（npm run infra:setup -- domain ${env}）`];
  const problems: string[] = [];
  if (mapping.spec?.routeName !== c.service) problems.push(`${label} が ${mapping.spec?.routeName ?? "（なし）"} を指している（${c.service} にする）`);
  if (mapping.spec?.certificateMode !== "AUTOMATIC") problems.push(`${label} の証明書が自動（AUTOMATIC）でない`);
  for (const type of READY_CONDITIONS) {
    const condition = mapping.status?.conditions?.find((x) => x.type === type);
    if (condition?.status !== "True") problems.push(`${label} の ${type} が True でない（${condition?.message ?? condition?.status ?? "まだない"}）`);
  }
  const expected = expectedRecords(mapping);
  if (expected.size === 0) problems.push(`${label} が DNS に書くレコードを出していない`);
  for (const [type, want] of expected) {
    const have = [...new Set((resolved.get(type) ?? []).map(normalize))].sort();
    const sortedWant = [...new Set(want)].sort();
    if (JSON.stringify(have) !== JSON.stringify(sortedWant)) {
      // Cloudflare のプロキシがオンだと、Cloudflare の IP が返る
      problems.push(`${c.domain} の DNS の ${type} が違う（決めた形 ${sortedWant.join(", ")}、今 ${have.join(", ") || "（なし）"}。Cloudflare のプロキシはオフにする）`);
    }
  }
  return problems;
};
