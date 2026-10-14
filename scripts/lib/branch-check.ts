const PROTECTED = new Set(["main"]);

/**
 * commit してよいブランチかを判定する。branch は現在のブランチ名で、detached HEAD は null。
 * リベース中の commit は detached HEAD で作られるため、detached HEAD は止めない。
 */
export function checkBranch(branch: string | null): { ok: true } | { ok: false; message: string } {
  if (branch === null || !PROTECTED.has(branch)) return { ok: true };
  return {
    ok: false,
    message: [
      `コミットを中止しました。${branch} への直接の commit は禁止です。`,
      "作業ブランチを作ってから commit してください(未コミットの変更は引き継がれます)。",
      "  git switch -c <prefix>/#<Issue番号>-<kebab-case-説明>",
    ].join("\n"),
  };
}
