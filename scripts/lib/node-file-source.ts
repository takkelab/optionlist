import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FileSource } from "./types.ts";

const IGNORED_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

// パスはすべて root からの相対パス（区切りは /）で扱う
export class NodeFileSource implements FileSource {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  list(dirs: string[], extensions: string[]): string[] {
    return dirs.flatMap((dir) => this.#walk(join(this.#root, dir), extensions));
  }

  exists(path: string): boolean {
    return existsSync(join(this.#root, path));
  }

  read(path: string): string {
    return readFileSync(join(this.#root, path), "utf8");
  }

  #walk(dir: string, extensions: string[]): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name) ? [] : this.#walk(full, extensions);
      if (!extensions.some((ext) => entry.name.endsWith(ext))) return [];
      return [relative(this.#root, full).replaceAll("\\", "/")];
    });
  }
}
