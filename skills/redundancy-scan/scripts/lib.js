"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function loadConfig(configPath) {
  const defaultsPath = path.join(__dirname, "..", "config", "defaults.json");
  const base = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
  if (!configPath) return base;
  const abs = path.resolve(configPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`config not found: ${abs}`);
  }
  const over = JSON.parse(fs.readFileSync(abs, "utf8"));
  return {
    ...base,
    ...over,
    excludeDirNames: over.excludeDirNames || base.excludeDirNames,
    textExtensions: over.textExtensions || base.textExtensions,
    deprecationSubstrings: over.deprecationSubstrings || base.deprecationSubstrings,
    redundancySubstrings: over.redundancySubstrings || base.redundancySubstrings,
  };
}

function shouldSkipDir(name, excludeSet) {
  return excludeSet.has(name);
}

function walkFiles(rootAbs, relBase, excludeSet, textExtSet, maxFileBytes, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(rootAbs, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot scan directory ${rootAbs}: ${error.message}`);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const name = ent.name;
    if (ent.isDirectory()) {
      if (shouldSkipDir(name, excludeSet)) continue;
      walkFiles(
        path.join(rootAbs, name),
        path.join(relBase, name),
        excludeSet,
        textExtSet,
        maxFileBytes,
        onFile,
      );
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (textExtSet.size && !textExtSet.has(ext) && name !== "Dockerfile") continue;
    const abs = path.join(rootAbs, name);
    let st;
    try {
      st = fs.statSync(abs);
    } catch (error) {
      throw new Error(`Cannot stat ${abs}: ${error.message}`);
    }
    if (st.size > maxFileBytes) continue;
    const rel = path.join(relBase, name).split(path.sep).join("/");
    onFile({ abs, rel, size: st.size, ext });
  }
}

// Fleet detectors share one callback/map across all selected child roots, so
// cross-repository groups are retained instead of merging already-filtered groups.
function walkScope(args, cfg, onFile) {
  const root = path.resolve(args.root);
  if (!fs.statSync(root).isDirectory()) throw new Error(`Not a scan directory: ${root}`);
  const exclude = new Set(cfg.excludeDirNames || []);
  const extensions = new Set(cfg.textExtensions || []);
  const max = cfg.maxFileBytes ?? 1_500_000;
  if (!Number.isFinite(max) || max < 0) throw new Error("Invalid maxFileBytes");
  if (!args.fleet) return walkFiles(root, "", exclude, extensions, max, onFile);
  const excludedRoots = new Set(["archive", "node_modules", "wt", "tmp", "docs", "scripts", "worktrees"]);
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".") || excludedRoots.has(ent.name) || ent.name.endsWith("-wt")) continue;
    walkFiles(path.join(root, ent.name), ent.name, exclude, extensions, max, onFile);
  }
}
function findingId(kind, identity) {
  return `${kind}-${crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function writeJsonl(filePath, rows) {
  ensureDirFor(filePath);
  const fd = fs.openSync(filePath, "w");
  for (const r of rows) {
    fs.writeSync(fd, JSON.stringify(r) + "\n");
  }
  fs.closeSync(fd);
}

function appendJsonl(filePath, row) {
  ensureDirFor(filePath);
  fs.appendFileSync(filePath, JSON.stringify(row) + "\n");
}

module.exports = {
  parseArgs,
  loadConfig,
  walkFiles,
  walkScope,
  findingId,
  writeJsonl,
  appendJsonl,
  ensureDirFor,
};
