/** パスワードの規則(packages/infra の UserPool の設定と同じ。両方のテストで値を固定している) */
export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_RULE_TEXT = `${PASSWORD_MIN_LENGTH} 文字以上で、英大文字・英小文字・数字をそれぞれ 1 文字以上含めてください。`;

/** 画面で先に知らせるための確認。最終的な判断は Cognito が行う。 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `${PASSWORD_MIN_LENGTH} 文字以上にしてください。`;
  if (!/[a-z]/.test(password)) return "英小文字を含めてください。";
  if (!/[A-Z]/.test(password)) return "英大文字を含めてください。";
  if (!/[0-9]/.test(password)) return "数字を含めてください。";
  return null;
}
