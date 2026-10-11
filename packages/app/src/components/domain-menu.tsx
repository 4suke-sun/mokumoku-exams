import Link from "next/link";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { domainSelectHref } from "@/lib/quiz.ts";
import type { PublishedExam } from "@/lib/types.ts";

type Props = { exam: Pick<PublishedExam, "examCode" | "shortName" | "domains"> };

/** 資格の分野の一覧。分野ごとの色で示し、選ぶと、その分野を選んだモード選択に進む。 */
export function DomainMenu({ exam }: Props) {
  if (exam.domains.length === 0) return null;
  return (
    <nav aria-label={`${exam.shortName}の分野`}>
      <ul className="flex flex-wrap gap-2">
        {exam.domains.map((domain) => {
          const color = domainColorClasses(exam.domains, domain.code);
          return (
            <li key={domain.code}>
              <Link
                href={domainSelectHref(exam.examCode, domain.code)}
                className={`block rounded-md border border-l-4 border-line bg-surface px-3 py-1 text-sm font-bold hover:underline ${color?.border ?? ""} ${color?.text ?? ""}`}
              >
                {domain.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
