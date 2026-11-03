"use client";

import type { CodeDrillProblem } from "@mokumoku-exams/data-schema/code-drill-data/schema";
import Link from "next/link";
import { useState } from "react";
import { LANGUAGE_LABELS } from "@/components/code-drill-player.tsx";
import { domainColorClasses } from "@/lib/domain-color.ts";

type Filter = "all" | CodeDrillProblem["language"];
type Domain = { code: string; name: string };

/** コードドリルの一覧: 分野ごとに問題を並べる。言語(すべて / SQL / PySpark)で絞り込める */
export function CodeDrillList({
  examCode,
  examName,
  domains,
  problems,
  basePath,
  preview,
}: {
  examCode: string;
  examName: string;
  domains: Domain[];
  problems: Pick<CodeDrillProblem, "id" | "domain" | "language" | "title" | "status">[];
  basePath: string;
  preview: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = problems.filter((p) => filter === "all" || p.language === filter);
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "すべて" },
    { id: "sql", label: "SQL" },
    { id: "pyspark", label: "PySpark" },
  ];
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <Link href={preview ? "/admin/preview" : `/exams/${examCode}`} className="text-sm text-primary hover:underline">
          {preview ? "全問のプレビューへ戻る" : "モード選択へ戻る"}
        </Link>
        <h1 className="h1">コードドリル</h1>
        <p className="text-sm text-muted">
          {examName}。コードの穴を埋めるか、コード全体を書いて解きます。コードは実行しません。
        </p>
      </div>
      {preview ? (
        <p className="rounded-md border border-warn bg-warn-bg px-3 py-2 text-sm">
          管理者のプレビューです。未検証の問題も出します(利用者の画面には、検証済みの問題だけを出します)。
        </p>
      ) : null}
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">言語で絞り込む</legend>
        {filters.map((f) => (
          <label
            key={f.id}
            className={`cursor-pointer rounded-md border px-3 py-1 text-sm font-bold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
              filter === f.id ? "border-primary bg-soft text-primary" : "border-line bg-surface"
            }`}
          >
            <input
              type="radio"
              name="code-drill-language"
              className="sr-only"
              checked={filter === f.id}
              onChange={() => setFilter(f.id)}
            />
            {f.label}
          </label>
        ))}
        <span className="text-sm text-muted">{shown.length} 問</span>
      </fieldset>
      {domains.map((domain) => {
        const own = shown.filter((p) => p.domain === domain.code);
        if (own.length === 0) return null;
        const color = domainColorClasses(domains, domain.code);
        return (
          <section key={domain.code} aria-labelledby={`code-drill-${domain.code}`} className="space-y-2">
            <h2 id={`code-drill-${domain.code}`} className={`h3 ${color?.text ?? ""}`}>
              {domain.name}
            </h2>
            <ul className="space-y-2">
              {own.map((problem) => (
                <li key={problem.id}>
                  <Link
                    href={`${basePath}/${problem.id}`}
                    className={`card flex flex-wrap items-center justify-between gap-2 border-l-4 p-3 ${color?.border ?? ""}`}
                  >
                    <span className="font-bold">{problem.title}</span>
                    <span className="flex gap-2">
                      {preview && problem.status === "unverified" ? (
                        <span className="chip tone-warn">! 未検証</span>
                      ) : null}
                      <span className="chip tone-primary">{LANGUAGE_LABELS[problem.language]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
