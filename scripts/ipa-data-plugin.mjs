import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MODULE = "virtual:local-ipa-data";
const INTERNAL = "\0" + MODULE;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const WORD = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/;

function invalid(message) {
  throw new Error(`Invalid IPA runtime data: ${message}`);
}

function validateReadings(value, location) {
  if (!Array.isArray(value) || value.length > 1) invalid(`${location} must contain at most one reading`);
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || typeof item.ipa !== "string" || !item.ipa.trim()
      || item.ipa.length > 160 || /[<>/\[\]\u0000-\u001f]/.test(item.ipa)) {
      invalid(`${location}[${index}] has invalid IPA`);
    }
    if (item.pos !== undefined && (typeof item.pos !== "string" || item.pos.length > 40)) {
      invalid(`${location}[${index}] has invalid annotation`);
    }
    if (Object.keys(item).some(key => key !== "ipa" && key !== "pos")) invalid(`${location}[${index}] has an unknown field`);
  }
}

function validateShard(value, version, letter, file) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.version !== version
    || !value.words || typeof value.words !== "object" || Array.isArray(value.words)) {
    invalid(`${file} has an invalid schema or version`);
  }
  for (const [word, raw] of Object.entries(value.words)) {
    if (!WORD.test(word) || word[0].toLowerCase() !== letter || !raw || typeof raw !== "object") {
      invalid(`${file} contains invalid word ${word}`);
    }
    if (Object.keys(raw).some(key => key !== "UK" && key !== "US")) invalid(`${file} contains an unknown word field`);
    validateReadings(raw.UK, `${file}:${word}:UK`);
    validateReadings(raw.US, `${file}:${word}:US`);
    if (!Array.isArray(raw.UK) || !Array.isArray(raw.US)) invalid(`${file}:${word} has invalid accent arrays`);
    if (!raw.UK.length && !raw.US.length) invalid(`${file}:${word} has no accent`);
  }
}

function readManifest(dataDir, complete) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(resolve(dataDir, "manifest.json"), "utf8")); }
  catch (error) { invalid(`cannot read manifest (${error.message})`); }
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.version !== "string" || !manifest.version
    || !manifest.shards || typeof manifest.shards !== "object" || Array.isArray(manifest.shards)) {
    invalid("manifest schema");
  }
  const letters = Object.keys(manifest.shards).sort().join("");
  if (!letters || (complete && letters !== LETTERS)) invalid(complete ? "manifest must contain exactly a-z shards" : "manifest must contain at least one shard");
  for (const letter of Object.keys(manifest.shards)) {
    if (!/^[a-z]$/.test(letter)) invalid(`invalid shard key ${letter}`);
    const shard = manifest.shards[letter];
    if (!shard || typeof shard !== "object" || shard.file !== `${letter}.json` || !/^[a-f0-9]{64}$/.test(shard.sha256)) invalid(`invalid ${letter} descriptor`);
    let file;
    try { file = realpathSync(resolve(dataDir, shard.file)); }
    catch (error) { invalid(`cannot read ${letter}.json (${error.message})`); }
    if (relative(dataDir, file) !== shard.file) invalid(`${letter}.json escapes data directory`);
    const bytes = readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== shard.sha256) invalid(`${letter}.json hash mismatch`);
    let value;
    try { value = JSON.parse(bytes); } catch (error) { invalid(`${letter}.json is not JSON (${error.message})`); }
    validateShard(value, manifest.version, letter, `${letter}.json`);
  }
  return manifest;
}

/**
 * Ordinary builds use the reviewed runtime snapshot committed under src/data/ipa. The explicit
 * local-ipa mode remains a loopback-only research preview and may read only local-exports data.
 */
export function localIpaData({ mode, root, directory }) {
  if (directory && mode !== "local-ipa") throw new Error("LOCAL_IPA_DATA_DIR requires local-ipa mode");
  let manifest;
  let dataDir;
  const preview = mode === "local-ipa";
  if (preview) {
    if (!directory || !isAbsolute(directory)) throw new Error("An absolute LOCAL_IPA_DATA_DIR is required");
    dataDir = realpathSync(directory);
    const allowed = realpathSync(resolve(root, "local-exports"));
    const rel = relative(allowed, dataDir);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("IPA data must remain inside local-exports");
    const previewPath = resolve(root, "local-exports/ipa-word-card/preview");
    const previewDir = existsSync(previewPath) ? realpathSync(previewPath) : previewPath;
    const fromPreview = relative(previewDir, dataDir);
    if (!fromPreview || (!isAbsolute(fromPreview) && fromPreview !== ".." && !fromPreview.startsWith(".." + sep))) throw new Error("IPA source must not be inside the build output");
  } else {
    dataDir = resolve(root, "src/data/ipa");
  }
  manifest = readManifest(dataDir, !preview);
  return makePlugin(manifest, dataDir, preview, root);
}

function makePlugin(manifest, dataDir, preview, root) {
  return {
    name: "margin-words:local-ipa-data",
    config() {
      if (!preview) return;
      return { server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1" },
        build: { outDir: resolve(root, "local-exports/ipa-word-card/preview"), emptyOutDir: true,
          rollupOptions: { input: { app: resolve(root, "index.html"), ipaPreview: resolve(root, "scripts/fixtures/ipa-preview.html") } } } };
    },
    configResolved(config) {
      if (preview && resolve(config.build.outDir) !== resolve(root, "local-exports/ipa-word-card/preview")) throw new Error("Local IPA build must use its isolated preview directory");
      if (preview && (config.server.host !== "127.0.0.1" || config.preview.host !== "127.0.0.1")) throw new Error("Local IPA servers must bind to loopback only");
    },
    resolveId(id) { if (id === MODULE) return INTERNAL; },
    load(id) {
      if (id !== INTERNAL) return;
      const imports = [];
      const entries = Object.entries(manifest.shards).sort(([a], [b]) => a.localeCompare(b)).map(([letter, shard]) => {
        const path = resolve(dataDir, shard.file).replaceAll("\\", "/");
        imports.push(`import url_${letter} from ${JSON.stringify(path + "?url&no-inline")};`);
        return `${JSON.stringify(letter)}: () => fetch(url_${letter}).then(response => { if (!response.ok) throw new Error('IPA resource unavailable'); return response.json(); })`;
      });
      return `${imports.join("\n")}\nexport const version = ${JSON.stringify(manifest.version)}; export const loaders = {${entries.join(",")}};`;
    },
  };
}
