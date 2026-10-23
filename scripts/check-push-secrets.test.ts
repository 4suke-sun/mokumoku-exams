import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAUDE_NOREPLY } from "./lib/pr-secrets-check.ts";

const script = fileURLToPath(new URL("./check-push-secrets.ts", import.meta.url));
const ZERO = "0".repeat(40);
const NOREPLY = "1+x@users.noreply.github.com";
// フィクスチャの値は、実在しない組み立て済みのダミー。
const fakeKey = "AK" + "IA" + "ABCDEFGHIJKLMNOP";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function makeRepo(email: string, files: Record<string, string | Buffer>, message: string, branch = "work"): string {
  const dir = mkdtempSync(join(tmpdir(), "push-check-"));
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "user.email", email);
  git(dir, "config", "user.name", "tester");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--no-verify", "-m", message);
  return dir;
}

function runCheck(dir: string, branch = "work", remoteSha = ZERO) {
  const input = `refs/heads/${branch} ${git(dir, "rev-parse", "HEAD")} refs/heads/${branch} ${remoteSha}\n`;
  return spawnSync("node", [script], { cwd: dir, input, encoding: "utf8", env: { ...process.env, CI: "1" } });
}

describe("check-push-secrets(基準のブランチが無い最初の push)", () => {
  it("履歴の最初から検査し、違反を止める", () => {
    const dir = makeRepo(NOREPLY, { ".vscode/settings.json": "{}", "a.txt": `key = ${fakeKey}\n` }, "chore: add");
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/エディタの設定/);
    expect(r.stderr).toMatch(/アクセスキー ID: a\.txt:1/);
    expect(r.stderr).not.toContain(fakeKey);
  });

  it("メタデータのある画像を、場所と種類だけで止める", () => {
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, "latin1");
      return Buffer.concat([head, body, Buffer.alloc(4)]);
    };
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const image = (...extra: Buffer[]) =>
      Buffer.concat([signature, chunk("IHDR", Buffer.alloc(13)), ...extra, chunk("IEND", Buffer.alloc(0))]);
    const dir = makeRepo(
      NOREPLY,
      { "clean.png": image(), "tagged.png": image(chunk("tEXt", Buffer.from("k\0v"))) },
      "chore: add",
    );
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/画像のメタデータ\(埋め込みテキスト\): tagged\.png/);
    expect(r.stderr).not.toMatch(/clean\.png/);
  });

  it("noreply ではない作者を止める", () => {
    const dir = makeRepo("someone@example.com", { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/noreply ではない作者アドレス/);
  });

  it("作者が Claude の署名用の noreply_通す", () => {
    const dir = makeRepo(CLAUDE_NOREPLY, { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it("作者が Claude の署名用の noreply に似た別のアドレス_止める", () => {
    const dir = makeRepo(`support@${CLAUDE_NOREPLY.split("@")[1]}`, { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/noreply ではない作者アドレス/);
  });

  it("問題がなければ通す", () => {
    const dir = makeRepo(NOREPLY, { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it("main の最初の push でも、全履歴を検査する", () => {
    const dir = makeRepo(NOREPLY, { "a.txt": `key = ${fakeKey}\n` }, "chore: add", "main");
    const r = runCheck(dir, "main");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/アクセスキー ID: a\.txt:1/);
  });

  it("途中のコミットで追加して、あとで消した値も見つける", () => {
    const dir = makeRepo(NOREPLY, { "a.txt": `key = ${fakeKey}\n` }, "chore: add");
    writeFileSync(join(dir, "a.txt"), "ok\n");
    git(dir, "commit", "-q", "--no-verify", "-am", "chore: remove");
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/アクセスキー ID: a\.txt:1 \(コミット [0-9a-f]{7}\)/);
  });

  it("内容が `++ ` で始まる行に隠した値も見つける", () => {
    const dir = makeRepo(NOREPLY, { "a.txt": `++ key = ${fakeKey}\n` }, "chore: add");
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/アクセスキー ID: a\.txt:1/);
  });

  it("検査を完了できないとき(リモートの SHA がローカルに無い)は、止める", () => {
    const dir = makeRepo(NOREPLY, { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir, "work", "1".repeat(40));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/検査を完了できませんでした/);
  });
});
