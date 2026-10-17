/** 場所(項目のパス)だけを持ち、値は持たない誤りの基底。種類ごとの名前(メッセージ)は、サブクラスが決める */
export class PathsError extends Error {
  readonly paths: string[];
  constructor(message: string, paths: string[]) {
    super(message);
    this.paths = paths;
  }
}
