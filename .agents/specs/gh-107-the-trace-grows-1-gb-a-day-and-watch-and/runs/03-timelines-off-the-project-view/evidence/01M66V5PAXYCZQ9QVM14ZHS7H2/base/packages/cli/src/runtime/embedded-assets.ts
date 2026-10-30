/**
 * Assets embedded in a compiled binary (X3). In the source tree and the npm bundle there are none;
 * `scripts/build.ts --bin` replaces this whole module with a generated one that lists every file
 * under `packages/cli/assets` (imported `with { type: "file" }`) and a content hash of them.
 */
export interface EmbeddedAssets {
  /** Content hash of all files; names the extraction dir so a new build never reuses stale files. */
  readonly hash: string;
  /** `[path relative to the assets dir, path readable with readFileSync]`. */
  readonly files: ReadonlyArray<readonly [string, string]>;
}

export const EMBEDDED_ASSETS: EmbeddedAssets | null = null;
