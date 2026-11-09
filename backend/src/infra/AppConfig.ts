export type AppEnv = "development" | "test" | "staging" | "production";

// 環境変数から読んだアプリの設定（architecture.md §4.2）
export type AppSettings = {
  appEnv: AppEnv;
  // 自分のオリジン（Origin の確認。api.md §1）。なければ手元の扱い（リクエストの Host と比べる）
  appOrigin: string | null;
  // /api/metrics のトークン。空なら /api/metrics はいつも 404
  metricsToken: string;
  ipHashSecret: string;
  // 写真の Cloud Storage の入れ物の名前。null なら UPLOAD_DIR のフォルダに置く（手元・CI。api.md §5）
  photoBucket: string | null;
  // ビルド済みの frontend のフォルダ（architecture.md §4.3）。null なら画面を配らない（手元の npm run dev は Vite が配る）
  frontendDist: string | null;
  // 検索エンジンに載せてよいか（PUBLIC_INDEXING=true のときだけ。docs/decisions/0045）。false なら noindex を付ける
  publicIndexing: boolean;
};

export interface AppConfigSource {
  read(): AppSettings;
}

const APP_ENVS: readonly AppEnv[] = ["development", "test", "staging", "production"];
// 確認用・本番で、ないと起動を止める値（docs/decisions/0050）
// PHOTO_BUCKET がないと、写真が Cloud Run のディスク（再起動で消える）に置かれてしまう（docs/decisions/0051）
const REQUIRED_WHEN_DEPLOYED = ["APP_ORIGIN", "METRICS_TOKEN", "IP_HASH_SECRET", "PHOTO_BUCKET"] as const;

// 確認用・本番か（Secure の Cookie、エラーの中身を隠す、必須の環境変数。architecture.md §4.3）
export interface DeployedCheck {
  isDeployed(appEnv: AppEnv): boolean;
}

export class AppEnvRules implements DeployedCheck {
  isDeployed(appEnv: AppEnv): boolean {
    return appEnv === "staging" || appEnv === "production";
  }
}

// 値が足りない・形が違うときは、起動の時点で止める（本番で Origin の確認やトークンが黙って効かなくならないように）
export class EnvAppConfig implements AppConfigSource {
  readonly #env: NodeJS.ProcessEnv;
  readonly #rules: DeployedCheck;

  constructor(env: NodeJS.ProcessEnv, rules: DeployedCheck) {
    this.#env = env;
    this.#rules = rules;
  }

  read(): AppSettings {
    const appEnv = this.#appEnv();
    if (this.#rules.isDeployed(appEnv)) {
      const missing = REQUIRED_WHEN_DEPLOYED.filter((name) => this.#value(name) === "");
      if (missing.length > 0) throw new Error(`APP_ENV=${appEnv} では ${missing.join("・")} が必要です`);
    }
    const origin = this.#value("APP_ORIGIN");
    return {
      appEnv,
      appOrigin: origin === "" ? null : this.#origin(origin),
      metricsToken: this.#value("METRICS_TOKEN"),
      ipHashSecret: this.#value("IP_HASH_SECRET"),
      photoBucket: this.#optional("PHOTO_BUCKET"),
      frontendDist: this.#optional("FRONTEND_DIST"),
      publicIndexing: this.#value("PUBLIC_INDEXING") === "true",
    };
  }

  #optional(name: string): string | null {
    const value = this.#value(name);
    return value === "" ? null : value;
  }

  #appEnv(): AppEnv {
    const value = this.#value("APP_ENV");
    if (value === "") return "development";
    const found = APP_ENVS.find((name) => name === value);
    if (found === undefined) throw new Error(`APP_ENV は ${APP_ENVS.join(" / ")} のどれか（今は ${value}）`);
    return found;
  }

  // https://example.com のように、パスや末尾の / のないオリジンだけを受け付ける（ブラウザの Origin ヘッダーと文字列で比べるため）
  #origin(value: string): string {
    const url = URL.parse(value);
    if (url !== null && url.origin === value) return value;
    throw new Error(`APP_ORIGIN はパスのないオリジン（https://example.com の形）で書く（今は ${value}）`);
  }

  #value(name: string): string {
    return this.#env[name] ?? "";
  }
}
