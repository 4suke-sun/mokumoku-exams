// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "./session-provider.tsx";
import { SiteHeader } from "./site-header.tsx";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

const far = () => Date.now() / 1000 + 3600;

function signedIn(isAdmin: boolean | undefined) {
  const body = { signedIn: true, email: "u@example.com", expiresAt: far(), isAdmin };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SiteHeader の管理の項目", () => {
  it("管理者_ナビゲーションに管理を出す", async () => {
    signedIn(true);
    render(
      <SessionProvider>
        <SiteHeader />
      </SessionProvider>,
    );
    expect((await screen.findByRole("link", { name: "管理" })).getAttribute("href")).toBe("/admin");
  });

  it.each([false, undefined])("管理者でない(%s)_管理を出さない", async (isAdmin) => {
    signedIn(isAdmin);
    render(
      <SessionProvider>
        <SiteHeader />
      </SessionProvider>,
    );
    expect(await screen.findByRole("link", { name: "アカウント" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "管理" })).toBeNull();
  });
});
