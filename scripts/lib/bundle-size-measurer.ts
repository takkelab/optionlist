import { gzipSync } from "node:zlib";
import type { FileSource } from "./types.ts";

export interface BundleSizeMeasurer {
  // index.html が最初に読む JS の gzip 後の合計（KB）。dist がないか、JS が 1 本も見つからなければ null
  initialJsGzipKb(distDir: string): number | null;
}

const SCRIPT_SRC = /<script\b[^>]*\bsrc="([^"]+\.js)"/g;
const MODULE_PRELOAD = /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+\.js)"|<link\b[^>]*\bhref="([^"]+\.js)"[^>]*\brel="modulepreload"/g;

export class ViteBundleSizeMeasurer implements BundleSizeMeasurer {
  readonly #files: FileSource;

  constructor(files: FileSource) {
    this.#files = files;
  }

  initialJsGzipKb(distDir: string): number | null {
    const indexPath = `${distDir}/index.html`;
    if (!this.#files.exists(indexPath)) return null;
    const html = this.#files.read(indexPath);
    const scripts = new Set([
      ...[...html.matchAll(SCRIPT_SRC)].map((m) => m[1]),
      ...[...html.matchAll(MODULE_PRELOAD)].map((m) => m[1] ?? m[2]),
    ]);
    if (scripts.size === 0) return null;
    const bytes = [...scripts].reduce((sum, src) => sum + this.#gzipSize(`${distDir}/${src.replace(/^\//, "")}`), 0);
    return Math.round((bytes / 1024) * 10) / 10;
  }

  #gzipSize(path: string): number {
    return gzipSync(this.#files.read(path)).length;
  }
}
