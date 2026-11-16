#!/usr/bin/env node
"use strict";
// A receipt is an auditor's declaration, not proof of semantic review. This gate
// verifies scope, pinned bytes, exact read ranges and required disposition evidence.
const fs = require("node:fs");
const path = require("node:path");
const { loadManifest, loadJsonl, nonempty, digest, relativePath } = require("./lib/integrity");
const CODE = new Set(["verified", "finding", "waived", "skipped-generated"]);
const MD = new Set([...CODE, "historical-ok", "generated-ok", "non-claim", "policy-enforced", "fact-match", "fact-doc-drift", "fact-code-drift"]);
function argsFrom(argv) {
  const args = { mode: "code", allowEmpty: false };
  const values = new Map([["--manifest", "manifest"], ["--ledger", "ledger"], ["--findings", "findings"], ["--generated-allowlist", "generatedAllowlist"], ["--mode", "mode"], ["--write-md", "writeMd"]]);
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (values.has(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value: ${key}`);
      args[values.get(key)] = argv[++i];
    } else if (key === "--allow-empty") args.allowEmpty = true;
    else if (key === "--check-hash") { /* retained alias: hashes are always checked */ }
    else if (key === "--help" || key === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}
function main() {
  const args = argsFrom(process.argv);
  if (args.help) {
    console.log("coverage-status --manifest FILE --ledger FILE [--findings FILE] [--mode code|md-truth] [--generated-allowlist FILE] [--allow-empty] [--write-md FILE]. Snapshot/read hashes are mandatory.");
    return;
  }
  if (!args.manifest || !args.ledger) throw new Error("--manifest and --ledger are required");
  if (!new Set(["code", "md-truth"]).has(args.mode)) throw new Error("Unknown coverage mode");
  const manifest = loadManifest(args.manifest, args.allowEmpty);
  const paths = new Set(manifest.map((row) => row.path));
  const byPath = new Map();
  for (const row of loadJsonl(args.ledger, true)) {
    if (!relativePath(row.path) || !paths.has(row.path)) throw new Error(`Receipt outside inventory: ${row.path}`);
    byPath.set(row.path, row); // append-only superseding receipts remain supported
  }
  const findings = new Map();
  const findingFile = args.findings || path.join(path.dirname(args.ledger), "findings.jsonl");
  for (const row of loadJsonl(findingFile, true)) {
    if (!nonempty(row.id) || findings.has(row.id) || !relativePath(row.path)) throw new Error("Invalid or duplicate finding identity");
    findings.set(row.id, row);
  }
  let generated = new Set();
  if (args.generatedAllowlist) {
    const list = JSON.parse(fs.readFileSync(args.generatedAllowlist, "utf8"));
    if (!Array.isArray(list) || !list.every(relativePath)) throw new Error("Generated allowlist must be an array of exact relative paths");
    generated = new Set(list);
  }
  const missing = [], invalid = [], counts = {};
  const terminals = args.mode === "code" ? CODE : MD;
  for (const row of manifest) {
    const cov = byPath.get(row.path);
    if (!cov) { missing.push(row.path); continue; }
    let error = null;
    if (cov.status === "blocked") error = nonempty(cov.reason) ? "blocked: accounted but not fully read" : "blocked without reason";
    else if (!terminals.has(cov.status)) error = "review required or unknown status";
    else if (!nonempty(cov.agent)) error = "missing auditor identity";
    else if (!digest(cov.read_sha256) || cov.read_sha256 !== row.sha256) error = "missing or mismatched read_sha256";
    else if (cov.manifest_lines !== row.lines) error = "manifest_lines mismatch";
    else if (row.lines !== null && (!Array.isArray(cov.lines_read) || cov.lines_read.length !== 2 ||
      !cov.lines_read.every(Number.isSafeInteger) || cov.lines_read[0] !== (row.lines === 0 ? 0 : 1) || cov.lines_read[1] !== row.lines)) error = "missing or invalid full read span";
    else if (row.lines === null && !nonempty(cov.review_method)) error = "binary review requires review_method";
    if (!error && (cov.status === "finding" || cov.status === "fact-doc-drift" || cov.status === "fact-code-drift")) {
      if (!Array.isArray(cov.finding_ids) || !cov.finding_ids.length || !cov.finding_ids.every((id) => {
        const found = findings.get(id);
        return found && (found.path === row.path || (Array.isArray(found.related_paths) && found.related_paths.includes(row.path)));
      })) error = "finding references must resolve for this path";
    }
    if (!error && cov.status === "waived" && (!cov.waiver || !nonempty(cov.waiver.owner) || !nonempty(cov.waiver.reason))) error = "waiver requires owner and reason";
    if (!error && (cov.status === "skipped-generated" || cov.status === "generated-ok") && (!generated.has(row.path) || !nonempty(cov.generated_evidence))) error = "generated disposition requires exact allowlist and verifier evidence";
    if (!error && !CODE.has(cov.status) && !nonempty(cov.review_evidence)) error = "markdown truth requires review evidence";
    if (error) invalid.push({ path: row.path, status: error });
    else counts[cov.status] = (counts[cov.status] || 0) + 1;
  }
  const summary = { complete: !missing.length && !invalid.length, mode: args.mode, manifestFiles: manifest.length,
    covered: manifest.length - missing.length - invalid.length, missing: missing.length, nonTerminal: invalid.length,
    counts, sampleMissing: missing.slice(0, 20), sampleNonTerminal: invalid.slice(0, 20) };
  console.log(JSON.stringify(summary, null, 2));
  if (args.writeMd) {
    fs.mkdirSync(path.dirname(path.resolve(args.writeMd)), { recursive: true });
    fs.writeFileSync(args.writeMd, `# Audit coverage\n\nComplete: **${summary.complete}**\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
  }
  if (!summary.complete) process.exitCode = 1;
}
try { main(); } catch (error) {
  console.error(JSON.stringify({ complete: false, error: error.message }));
  process.exitCode = 1;
}
