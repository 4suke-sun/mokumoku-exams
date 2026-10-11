import { EmptyState } from "@/components/empty-state.tsx";

export default function NotFound() {
  return (
    <EmptyState
      icon="🧭"
      headingLevel={1}
      title="ページが見つかりません"
      description="アドレスが違うか、ページが移動した可能性があります。トップから探し直してください。"
      action={{ label: "トップへ戻る", href: "/" }}
    />
  );
}
