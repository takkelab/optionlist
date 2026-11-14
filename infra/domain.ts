// 独自ドメイン（docs/decisions/0063）。Cloud Run のドメインマッピング（domains.cloudrun.com/v1）の決めた形
// infra/setup.ts（作る）と scripts/infra-check.ts（確かめる）が同じものを使う。gcloud では beta にしかないので REST で扱う
import { DOMAIN_MAPPINGS_API, PROJECT_ID, envConfig } from "./config.ts";
import type { EnvName } from "./config.ts";

export type ResourceRecord = { name?: string; rrdata?: string; type?: string };
export type DomainMapping = {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: { routeName?: string; certificateMode?: string };
  status?: { conditions?: { type?: string; status?: string; message?: string }[]; resourceRecords?: ResourceRecord[] };
};

export const domainMappingUrl = (env: EnvName): string => `${DOMAIN_MAPPINGS_API}/${envConfig(env).domain}`;

// 証明書は Google が自動で出す（AUTOMATIC）。DNS は Cloudflare に手で書く（プロキシはオフ。オンだと証明書が出ない）
export const domainMappingBody = (env: EnvName): DomainMapping => ({
  apiVersion: "domains.cloudrun.com/v1",
  kind: "DomainMapping",
  metadata: { name: envConfig(env).domain, namespace: PROJECT_ID },
  spec: { routeName: envConfig(env).service, certificateMode: "AUTOMATIC" },
});

// DNS に書くレコード（Cloudflare の画面で入れる形）。name が空なら apex（@）
export const recordLines = (mapping: DomainMapping): string[] =>
  (mapping.status?.resourceRecords ?? []).map((r) => `${r.type ?? "?"}\t${r.name === undefined || r.name === "" ? "@" : r.name}\t${r.rrdata ?? "?"}`);
