"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { loadManifest, loadJsonl, readSnapshot } = require("./integrity");

// Mechanical classification may suggest a disposition, but cannot establish
// semantic truth, an agent read, or an L4 implementation/test cross-check.
function runCandidates(wave, classify, acceptedFlags) {
  const args = { manifests: [], dryRun: false };
  try {
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      if (acceptedFlags.includes(key)) args.manifests.push(process.argv[++i]);
      else if (key === "--ledger") args.ledger = process.argv[++i];
      else if (key === "--dry-run") args.dryRun = true;
      else if (key === "--write-findings") args.findings = process.argv[++i];
      else if (key === "--help" || key === "-h") {
        console.log(`${wave}: ${acceptedFlags.join(" FILE | ")} FILE --ledger FILE [--dry-run]. Emits review-required candidates only.`);
        return;
      } else throw new Error(`Unknown argument: ${key}`);
    }
    if (!args.manifests.length || args.manifests.some((f) => !f || f.startsWith("--")) || !args.ledger) throw new Error("Manifest and ledger paths are required");
    const existing = new Set(loadJsonl(args.ledger, true).map((r) => r.path));
    const rows = [], seen = new Set();
    for (const manifest of args.manifests) {
      for (const record of loadManifest(manifest)) {
        if (seen.has(record.path)) throw new Error(`Duplicate component path: ${record.path}`);
        seen.add(record.path);
        if (existing.has(record.path)) continue;
        const bytes = readSnapshot(record, manifest);
        const suggestion = classify(record.path, bytes.toString("utf8"));
        if (!suggestion) continue;
        rows.push({ path: record.path, status: "review-required", suggested_status: suggestion.status,
          classification_evidence: suggestion.proof || "path heuristic", manifest_lines: record.lines,
          mechanical_lines: record.lines, observed_sha256: record.sha256,
          agent: `${wave}-mechanical-classifier`, ts: new Date().toISOString(),
          notes: "Pinned bytes classified mechanically. Requires an auditor read and semantic review; no L2/L4 claim." });
      }
    }
    if (!args.dryRun && rows.length) {
      fs.mkdirSync(path.dirname(path.resolve(args.ledger)), { recursive: true });
      fs.appendFileSync(args.ledger, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    }
    console.log(JSON.stringify({ dryRun: args.dryRun, candidates: rows.length, status: "review-required", findings: 0 }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { runCandidates };
