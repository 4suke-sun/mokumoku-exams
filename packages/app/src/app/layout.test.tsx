import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREFS_COOKIE, prefsCookieValue } from "@/lib/prefs-cookie.ts";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
// 画面の部品は、この確認に関係しない(ルートの属性だけを見る)
vi.mock("@/components/navigation-progress.tsx", () => ({ NavigationProgress: () => null }));
vi.mock("@/components/page-main.tsx", () => ({ PageMain: () => null, PageFooter: () => null }));
vi.mock("@/components/session-provider.tsx", () => ({ SessionProvider: () => null }));
vi.mock("@/components/site-nav.tsx", () => ({ SiteNav: () => null }));
vi.mock("./globals.css", () => ({}));

const prefs = { theme: "dark", style: "simple", shuffleChoices: true } as const;

// 検証は、トークンが「token-<sub>」の形のものを通す代わり(本物の検証は verify.test.ts)
vi.mock("@/lib/auth/deps.ts", () => ({
  guardDeps: () => ({
    verifier: {
      async verifyIdToken(token: string) {
        return token.startsWith("token-") ? { sub: token.slice(6), groups: [] } : null;
      },
    },
    provider: {
      async refresh() {
        throw new Error("unavailable");
      },
    },
    secure: false,
  }),
}));

const { default: RootLayout } = await import("./layout.tsx");

async function rootProps(cookie: string | null) {
  vi.mocked(headers).mockResolvedValue(new Headers(cookie ? { cookie } : {}) as never);
  const element = (await RootLayout({ children: null })) as { props: Record<string, unknown> };
  return element.props;
}

beforeEach(() => {
  vi.mocked(headers).mockReset();
});

describe("ルートのレイアウトの表示の設定", () => {
  it("ログイン中で持ち主が一致_サーバーが最初の描画から反映する", async () => {
    const props = await rootProps(`mokumoku_id=token-user-a; ${PREFS_COOKIE}=${prefsCookieValue("user-a", prefs)}`);
    expect(props["data-prefs"]).toBe("1");
    expect(props["data-theme"]).toBe("dark");
    expect(props["data-style"]).toBe("simple");
  });

  it("端末に従う_data-theme を付けない(CSS の prefers-color-scheme に任せる)", async () => {
    const value = prefsCookieValue("user-a", { ...prefs, theme: "system" });
    const props = await rootProps(`mokumoku_id=token-user-a; ${PREFS_COOKIE}=${value}`);
    expect(props["data-prefs"]).toBe("1");
    expect("data-theme" in props).toBe(false);
  });

  it("別のアカウントの Cookie_反映しない(端末の設定を、初回描画の前のスクリプトが使う)", async () => {
    const props = await rootProps(`mokumoku_id=token-user-b; ${PREFS_COOKIE}=${prefsCookieValue("user-a", prefs)}`);
    expect("data-prefs" in props).toBe(false);
    expect("data-theme" in props).toBe(false);
    expect("data-style" in props).toBe(false);
  });

  it("未ログイン・設定の Cookie がない_反映しない", async () => {
    expect("data-prefs" in (await rootProps(null))).toBe(false);
    expect("data-prefs" in (await rootProps(`${PREFS_COOKIE}=${prefsCookieValue("user-a", prefs)}`))).toBe(false);
    expect("data-prefs" in (await rootProps("mokumoku_id=token-user-a"))).toBe(false);
  });

  it("リクエストの情報を読めない_反映せず描画する", async () => {
    vi.mocked(headers).mockRejectedValue(new Error("no request"));
    const element = (await RootLayout({ children: null })) as { props: Record<string, unknown> };
    expect("data-prefs" in element.props).toBe(false);
  });

  it("初回描画の前のスクリプトを head に持つ", async () => {
    const props = await rootProps(null);
    expect(props.lang).toBe("ja");
    expect(props.suppressHydrationWarning).toBe(true);
  });
});
