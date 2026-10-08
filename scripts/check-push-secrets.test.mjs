import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-push-secrets.mjs", import.meta.url));
const ZERO = "0".repeat(40);
// フィクスチャの値は、実在しない組み立て済みのダミー。
const fakeKey = "AK" + "IA" + "ABCDEFGHIJKLMNOP";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function makeRepo(email, files, message, branch = "work") {
  const dir = mkdtempSync(join(tmpdir(), "push-check-"));
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "user.email", email);
  git(dir, "config", "user.name", "tester");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--no-verify", "-m", message);
  return dir;
}

function runCheck(dir, branch = "work", remoteSha = ZERO) {
  const input = `refs/heads/${branch} ${git(dir, "rev-parse", "HEAD")} refs/heads/${branch} ${remoteSha}\n`;
  return spawnSync("node", [script], { cwd: dir, input, encoding: "utf8" });
}

describe("check-push-secrets(基準のブランチが無い最初の push)", () => {
  it("履歴の最初から検査し、違反を止める", () => {
    const dir = makeRepo("1+x@users.noreply.github.com", { ".vscode/settings.json": "{}", "a.txt": `key = ${fakeKey}\n` }, "chore: add");
    const r = runCheck(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /エディタの設定/);
    assert.match(r.stderr, /アクセスキー ID: a\.txt:1/);
    assert.ok(!r.stderr.includes(fakeKey), "値を報告に含めない");
  });

  it("noreply ではない作者を止める", () => {
    const dir = makeRepo("someone@example.com", { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /noreply ではない作者アドレス/);
  });

  it("問題がなければ通す", () => {
    const dir = makeRepo("1+x@users.noreply.github.com", { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir);
    assert.equal(r.status, 0, r.stderr);
  });

  it("main の最初の push でも、全履歴を検査する", () => {
    const dir = makeRepo("1+x@users.noreply.github.com", { "a.txt": `key = ${fakeKey}\n` }, "chore: add", "main");
    const r = runCheck(dir, "main");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /アクセスキー ID: a\.txt:1/);
  });

  it("途中のコミットで追加して、あとで消した値も見つける", () => {
    const dir = makeRepo("1+x@users.noreply.github.com", { "a.txt": `key = ${fakeKey}\n` }, "chore: add");
    writeFileSync(join(dir, "a.txt"), "ok\n");
    git(dir, "commit", "-q", "--no-verify", "-am", "chore: remove");
    const r = runCheck(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /アクセスキー ID: a\.txt:1 \(コミット [0-9a-f]{7}\)/);
  });

  it("検査を完了できないとき(リモートの SHA がローカルに無い)は、止める", () => {
    const dir = makeRepo("1+x@users.noreply.github.com", { "a.txt": "ok\n" }, "chore: add");
    const r = runCheck(dir, "work", "1".repeat(40));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /検査を完了できませんでした/);
  });
});
