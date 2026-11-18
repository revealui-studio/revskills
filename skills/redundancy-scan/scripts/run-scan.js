#!/usr/bin/env node
/**
 * run-scan.js — one-shot: hash dups + markers + name collisions → report.
 *
 * Usage:
 *   node run-scan.js --root ~/revealfleet/revealui --out-dir ~/revealfleet/archive/cold/audits/2026-07-22-redundancy-revealui
 *   node run-scan.js --root ~/revealfleet --fleet --out-dir $REVEALFLEET_ARCHIVE/audits/redundancy-fleet
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseArgs } = require("./lib.js");

function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    process.stderr.write(`run-scan: ${path.basename(script)} failed (${r.status})\n`);
    process.exit(r.status || 1);
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.root || !args["out-dir"]) {
    process.stderr.write(
      "Usage: node run-scan.js --root <dir> --out-dir <dir> [--fleet] [--config path] [--prefix name/]\n",
    );
    process.exit(args.help ? 0 : 1);
  }

  const scriptsDir = __dirname;
  const root = path.resolve(args.root);
  if (!fs.statSync(root).isDirectory()) throw new Error(`Not a scan directory: ${root}`);
  const outDir = path.resolve(args["out-dir"]);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });

  const configArgs = args.config ? ["--config", args.config] : [];

  const meta = {
    root,
    fleet: Boolean(args.fleet),
    started: new Date().toISOString(),
    outDir,
    prefix: args.prefix || "",
  };
  fs.writeFileSync(path.join(outDir, "RUN.json"), JSON.stringify(meta, null, 2) + "\n");

  if (!fs.statSync(root).isDirectory()) throw new Error(`Not a scan directory: ${root}`);
  const inputs = [];
  const scopeArgs = ["--root", root, ...configArgs];
  if (args.fleet) scopeArgs.push("--fleet");
  if (args.prefix) scopeArgs.push("--prefix", args.prefix);
  for (const [script, output] of [["hash-dups.js", "hash.jsonl"], ["marker-scan.js", "markers.jsonl"], ["name-collision.js", "names.jsonl"]]) {
    const file = path.join(outDir, "raw", output);
    run(path.join(scriptsDir, script), [...scopeArgs, "--out", file]);
    inputs.push(file);
  }
  run(path.join(scriptsDir, "merge-report.js"), ["--out-dir", outDir, "--inputs", JSON.stringify(inputs)]);

  meta.finished = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, "RUN.json"), JSON.stringify(meta, null, 2) + "\n");
  process.stdout.write(`run-scan complete → ${outDir}\n`);
}

main();
