/** 終了コード。scripts/ の検査と同じく、1 は検査の失敗、2 は入力の誤り */
export const EXIT = {
  ok: 0,
  checkFailed: 1,
  inputError: 2,
  internalError: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
