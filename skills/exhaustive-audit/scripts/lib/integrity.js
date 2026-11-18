"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { countLines } = require("./text-lines");

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function relativePath(value) {
  return nonempty(value) && !path.isAbsolute(value) && !value.includes("\\") &&
    !value.includes("\0") && value.split("/").every((part) => part && part !== "." && part !== "..");
}
function digest(value) {
  return typeof value === "string" && value.length === 64 &&
    [...value].every((c) => "0123456789abcdef".includes(c));
}
function loadJsonl(file, optional = false) {
  if (optional && !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    const row = JSON.parse(line);
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Invalid object in ${file}:${index + 1}`);
    return row;
  });
}
function readSnapshot(row, manifestFile) {
  if (!relativePath(row.snapshot)) throw new Error(`Missing or unsafe snapshot for ${row.path}`);
  const root = fs.realpathSync(path.dirname(path.resolve(manifestFile)));
  const file = path.resolve(root, row.snapshot);
  const real = fs.realpathSync(file);
  const rel = path.relative(root, real);
  if (!relativePath(rel.split(path.sep).join("/"))) throw new Error(`Snapshot escapes run: ${row.path}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`Snapshot is not a regular file: ${row.path}`);
    const bytes = fs.readFileSync(fd);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== row.sha256 || bytes.length !== row.bytes) {
      throw new Error(`Snapshot integrity mismatch: ${row.path}`);
    }
    if (row.lines !== null && countLines(bytes) !== row.lines) throw new Error(`Snapshot line mismatch: ${row.path}`);
    return bytes;
  } finally { fs.closeSync(fd); }
}
function loadManifest(file, allowEmpty = false) {
  const rows = loadJsonl(file);
  if (!rows.length && !allowEmpty) throw new Error("Empty inventory requires explicit --allow-empty");
  const seen = new Set();
  for (const row of rows) {
    if (!relativePath(row.path) || seen.has(row.path)) throw new Error(`Invalid or duplicate manifest path: ${row.path}`);
    seen.add(row.path);
    if (row.error) throw new Error(`Incomplete inventory at ${row.path}: ${row.error}`);
    if (!digest(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 ||
        !(row.lines === null ? row.binary === true : Number.isSafeInteger(row.lines) && row.lines >= 0)) {
      throw new Error(`Invalid manifest metadata: ${row.path}`);
    }
    readSnapshot(row, file);
  }
  return rows;
}
module.exports = { nonempty, relativePath, digest, loadJsonl, readSnapshot, loadManifest };
