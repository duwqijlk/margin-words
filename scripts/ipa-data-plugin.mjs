import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MODULE = "virtual:local-ipa-data";
const INTERNAL = "\0" + MODULE;

/** Explicit opt-in only: ordinary builds cannot include the local research database. */
export function localIpaData({ mode, root, directory }) {
  if (directory && mode !== "local-ipa") throw new Error("LOCAL_IPA_DATA_DIR requires local-ipa mode");
  let manifest;
  let dataDir;
  if (mode === "local-ipa") {
    if (!directory || !isAbsolute(directory)) throw new Error("An absolute LOCAL_IPA_DATA_DIR is required");
    dataDir = realpathSync(directory);
    const allowed = realpathSync(resolve(root, "local-exports"));
    const rel = relative(allowed, dataDir);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("IPA data must remain inside local-exports");
    const previewPath = resolve(root, "local-exports/ipa-word-card/preview");
    const previewDir = existsSync(previewPath) ? realpathSync(previewPath) : previewPath;
    const fromPreview = relative(previewDir, dataDir);
    if (!fromPreview || (!isAbsolute(fromPreview) && fromPreview !== ".." && !fromPreview.startsWith(".." + sep))) throw new Error("IPA source must not be inside the build output");
    manifest = JSON.parse(readFileSync(resolve(dataDir, "manifest.json"), "utf8"));
    if (manifest.schemaVersion !== 1 || typeof manifest.version !== "string" || !manifest.version || !manifest.shards || typeof manifest.shards !== "object") throw new Error("Invalid local IPA manifest");
    for (const [letter, shard] of Object.entries(manifest.shards)) {
      if (!/^[a-z]$/.test(letter) || shard.file !== letter + ".json" || !/^[a-f0-9]{64}$/.test(shard.sha256)) throw new Error("Invalid IPA shard descriptor");
      const file = realpathSync(resolve(dataDir, shard.file));
      if (relative(dataDir, file) !== shard.file) throw new Error("IPA shard escapes data directory");
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== shard.sha256) throw new Error("IPA shard hash mismatch");
    }
  }
  return {
    name: "margin-words:local-ipa-data",
    config() {
      if (!manifest) return;
      return { server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1" },
        build: { outDir: resolve(root, "local-exports/ipa-word-card/preview"), emptyOutDir: true,
        rollupOptions: { input: { app: resolve(root, "index.html"), ipaPreview: resolve(root, "scripts/fixtures/ipa-preview.html") } } } };
    },
    configResolved(config) {
      if (manifest && resolve(config.build.outDir) !== resolve(root, "local-exports/ipa-word-card/preview")) throw new Error("Local IPA build must use its isolated preview directory");
      if (manifest && (config.server.host !== "127.0.0.1" || config.preview.host !== "127.0.0.1")) throw new Error("Local IPA servers must bind to loopback only");
    },
    resolveId(id) { if (id === MODULE) return INTERNAL; },
    load(id) {
      if (id !== INTERNAL) return;
      if (!manifest) return "export const version = ''; export const loaders = {};";
      const imports = [];
      const entries = Object.entries(manifest.shards).sort(([a], [b]) => a.localeCompare(b)).map(([letter, shard]) => {
        const path = resolve(dataDir, shard.file).replaceAll("\\", "/");
        imports.push(`import url_${letter} from ${JSON.stringify(path + "?url&no-inline")};`);
        return `${JSON.stringify(letter)}: () => fetch(url_${letter}).then(response => { if (!response.ok) throw new Error('IPA resource unavailable'); return response.json(); })`;
      });
      // Optional display data must not invoke Vite's failed-code-chunk page reload.
      // Static URL imports emit hashed JSON assets; fetches stay lazy and retryable.
      return `${imports.join("\n")}\nexport const version = ${JSON.stringify(manifest.version)}; export const loaders = {${entries.join(",")}};`;
    },
  };
}
