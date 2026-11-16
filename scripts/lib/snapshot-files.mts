import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export function validSessionId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const letter = (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
    const digit = char >= "0" && char <= "9";
    if (letter || digit) continue;
    if (i > 0 && (char === "." || char === "_" || char === "-")) continue;
    return false;
  }
  return true;
}

function checkedDirectory(dir: string, create: boolean): void {
  const base = path.parse(dir).root;
  let current = base;
  const parts = dir.slice(base.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !create) throw error;
      fs.mkdirSync(current, { mode: 0o700 });
      stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`unsafe snapshot directory: ${current}`);
    }
  }
}

export function safeSnapshotPath(coordRoot: string, sid: string, options: { create?: boolean } = {}): string {
  if (!validSessionId(sid)) throw new Error("invalid session id");
  if (typeof coordRoot !== "string" || !path.isAbsolute(coordRoot)) {
    throw new Error("coordination root must be absolute");
  }
  const root = path.resolve(coordRoot);
  const snapshots = path.join(root, "snapshots");
  checkedDirectory(root, Boolean(options.create));
  checkedDirectory(snapshots, Boolean(options.create));
  if (options.create) {
    fs.chmodSync(root, 0o700);
    fs.chmodSync(snapshots, 0o700);
  }
  const file = path.join(snapshots, `${sid}.md`);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe snapshot file: ${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return file;
}

export function safeSnapshotArchiveDir(coordRoot: string, options: { create?: boolean } = {}): string {
  if (typeof coordRoot !== "string" || !path.isAbsolute(coordRoot)) {
    throw new Error("coordination root must be absolute");
  }
  const root = path.resolve(coordRoot);
  const snapshots = path.join(root, "snapshots");
  const archive = path.join(snapshots, "archive");
  checkedDirectory(root, Boolean(options.create));
  checkedDirectory(snapshots, Boolean(options.create));
  checkedDirectory(archive, Boolean(options.create));
  if (options.create) {
    fs.chmodSync(root, 0o700);
    fs.chmodSync(snapshots, 0o700);
    fs.chmodSync(archive, 0o700);
  }
  return archive;
}

export function safeStampDirectory(coordRoot: string, options: { create?: boolean } = {}): string {
  if (typeof coordRoot !== "string" || !path.isAbsolute(coordRoot)) {
    throw new Error("coordination root must be absolute");
  }
  const root = path.resolve(coordRoot);
  const sessions = path.join(root, "harness-sessions");
  const byPid = path.join(sessions, "by-pid");
  checkedDirectory(root, Boolean(options.create));
  checkedDirectory(sessions, Boolean(options.create));
  checkedDirectory(byPid, Boolean(options.create));
  if (options.create) {
    fs.chmodSync(root, 0o700);
    fs.chmodSync(sessions, 0o700);
    fs.chmodSync(byPid, 0o700);
  }
  return byPid;
}

export function atomicPrivateWrite(coordRoot: string, sid: string, content: string): string {
  if (typeof content !== "string") throw new Error("snapshot content must be text");
  const file = safeSnapshotPath(coordRoot, sid, { create: true });
  const dir = path.dirname(file);
  fs.chmodSync(dir, 0o700);
  const temp = path.join(dir, `.${sid}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Recheck before rename so a concurrent symlink cannot be followed.
    safeSnapshotPath(coordRoot, sid);
    fs.renameSync(temp, file);
    return file;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

export function archiveSnapshot(coordRoot: string, sid: string): string | null {
  let file: string;
  try {
    file = safeSnapshotPath(coordRoot, sid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let sourceFd: number;
  try {
    sourceFd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let data: Buffer;
  try {
    if (!fs.fstatSync(sourceFd).isFile()) throw new Error("snapshot source is not a regular file");
    data = fs.readFileSync(sourceFd);
  } finally {
    fs.closeSync(sourceFd);
  }

  const dir = safeSnapshotArchiveDir(coordRoot, { create: true });
  const suffix = `${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
  const archive = path.join(dir, `${sid}.${suffix}.md`);
  const temp = path.join(dir, `.${sid}.${suffix}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Hard-link creation is atomic and exclusive: it cannot replace an
    // existing archive path, including a link planted by another process.
    fs.linkSync(temp, archive);
    return archive;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, root, sid] = process.argv.slice(2);
  try {
    if (operation === "valid-id") {
      if (!validSessionId(root)) process.exitCode = 1;
    } else if (operation === "path-read") {
      const file = safeSnapshotPath(root, sid);
      if (!fs.existsSync(file)) process.exitCode = 1;
      else process.stdout.write(`${file}\n`);
    } else if (operation === "path-write") {
      process.stdout.write(`${safeSnapshotPath(root, sid, { create: true })}\n`);
    } else if (operation === "archive-dir") {
      process.stdout.write(`${safeSnapshotArchiveDir(root, { create: true })}\n`);
    } else if (operation === "stamp-dir") {
      process.stdout.write(`${safeStampDirectory(root, { create: true })}\n`);
    } else if (operation === "stamp-dir-read") {
      process.stdout.write(`${safeStampDirectory(root)}\n`);
    } else if (operation === "atomic-write") {
      const content = fs.readFileSync(0, "utf8");
      process.stdout.write(`${atomicPrivateWrite(root, sid, content)}\n`);
    } else {
      process.stderr.write("usage: snapshot-files.mts valid-id SID | archive-dir|stamp-dir|stamp-dir-read ROOT | path-read|path-write|atomic-write ROOT SID\n");
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
