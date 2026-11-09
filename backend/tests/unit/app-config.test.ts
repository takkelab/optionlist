import { describe, expect, it } from "vitest";
import { AppEnvRules, EnvAppConfig } from "../../src/infra/AppConfig";

// 環境変数の読み取り（architecture.md §4.2。docs/decisions/0050）
const DEPLOYED = { APP_ORIGIN: "https://optionlist.example", METRICS_TOKEN: "t", IP_HASH_SECRET: "s", PHOTO_BUCKET: "photos" };

describe("EnvAppConfig", () => {
  it("treats a missing APP_ENV as development without an origin", () => {
    expect(new EnvAppConfig({ IP_HASH_SECRET: "s" }, new AppEnvRules()).read()).toEqual({
      appEnv: "development",
      appOrigin: null,
      metricsToken: "",
      ipHashSecret: "s",
      photoBucket: null,
    });
  });

  it.each(["staging", "production"])("reads the deployed settings for %s", (appEnv) => {
    expect(new EnvAppConfig({ APP_ENV: appEnv, ...DEPLOYED }, new AppEnvRules()).read()).toEqual({
      appEnv,
      appOrigin: "https://optionlist.example",
      metricsToken: "t",
      ipHashSecret: "s",
      photoBucket: "photos",
    });
  });

  it.each(["APP_ORIGIN", "METRICS_TOKEN", "IP_HASH_SECRET", "PHOTO_BUCKET"])("stops in production without %s", (name) => {
    const env = { APP_ENV: "production", ...DEPLOYED, [name]: "" };
    expect(() => new EnvAppConfig(env, new AppEnvRules()).read()).toThrow(name);
  });

  it.each(["https://optionlist.example/app", "optionlist.example", "https://optionlist.example:443"])(
    "rejects APP_ORIGIN %s",
    (origin) => {
      expect(() => new EnvAppConfig({ APP_ORIGIN: origin }, new AppEnvRules()).read()).toThrow("APP_ORIGIN");
    },
  );

  it("rejects an unknown APP_ENV", () => {
    expect(() => new EnvAppConfig({ APP_ENV: "prod" }, new AppEnvRules()).read()).toThrow("APP_ENV");
  });
});
