export type BarRow = {
  key: string;
  label: string;
  /** バーの長さ(0〜100) */
  percent: number;
  /** 行の右に添える数値の文字(読み上げにも使う) */
  detail: string;
  /** 文字の色のクラス(分野の色) */
  textClass?: string;
  /** バーの色のクラス */
  barClass: string;
  /** 注意の印(合格ラインより下)。色だけでなく文字でも伝える */
  warn?: boolean;
};

type Props = {
  rows: readonly BarRow[];
  /** 表の見出し・バーの一覧の名前 */
  caption: string;
  /** シンプル表示では、バーの代わりに表にする */
  tableInSimple?: boolean;
  /** 表の 2 列目の見出し(既定は「結果」) */
  valueLabel?: string;
};

function Bars({ rows, caption }: Pick<Props, "rows" | "caption">) {
  return (
    <ul aria-label={caption} className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className={`font-bold ${row.textClass ?? ""}`}>
              {row.label}
              {row.warn ? <span className="ml-2 chip tone-orange">合格ラインより下</span> : null}
            </span>
            <span>{row.detail}</span>
          </div>
          <div aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-line">
            <div className={`motion-bar h-full rounded-full ${row.barClass}`} style={{ width: `${row.percent}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Table({ rows, caption, valueLabel = "結果" }: Pick<Props, "rows" | "caption" | "valueLabel">) {
  return (
    <table className="w-full text-left text-sm tabular-nums">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-muted">
          <th scope="col" className="py-1 pr-3 font-normal">
            分野
          </th>
          <th scope="col" className="py-1 font-normal">
            {valueLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-line last:border-0">
            <th scope="row" className={`py-2 pr-3 font-bold ${row.textClass ?? ""}`}>
              {row.label}
              {row.warn ? <span className="ml-2 chip tone-orange">合格ラインより下</span> : null}
            </th>
            <td className="py-2">{row.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 分野ごとのバー。リッチはバー、シンプルは表(`tableInSimple`)。見た目の出し分けは CSS で行う。
 * 数値は文字でも添えるので、バーは飾りとして読み上げない。
 */
export function DomainBars({ rows, caption, tableInSimple = false, valueLabel }: Props) {
  if (!tableInSimple) return <Bars rows={rows} caption={caption} />;
  return (
    <>
      <div className="rich-only">
        <Bars rows={rows} caption={caption} />
      </div>
      <div className="simple-only">
        <Table rows={rows} caption={caption} valueLabel={valueLabel} />
      </div>
    </>
  );
}
