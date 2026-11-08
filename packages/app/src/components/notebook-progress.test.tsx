// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookProgressProvider, NotebookResume } from "./notebook-progress.tsx";

const replace = vi.hoisted(() => vi.fn<(href: string) => void>());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

type Data = { units: Map<string, string>; entries: Map<string, string> };
const client = vi.hoisted(() => ({
  fetchNotebook: vi.fn<(examCode: string) => Promise<Data | null>>(),
  putNotebookEntry: vi.fn<(examCode: string, unit: string, entry: string) => Promise<boolean>>(),
}));
vi.mock("@/lib/history/client.ts", () => client);

const unit = { id: "domain1-1", entries: [{ id: "a" }, { id: "b" }, { id: "c" }] };
const AT = "2026-10-11T15:30:00.000Z";
const BASE = "/exams/TEST/notebook";

beforeEach(() => {
  replace.mockReset();
  client.fetchNotebook.mockReset();
});

async function renderResume(preview = false) {
  render(
    <NotebookProgressProvider examCode="TEST" preview={preview}>
      <NotebookResume unit={unit} basePath={BASE} />
    </NotebookProgressProvider>,
  );
  await act(async () => {});
}

describe("NotebookResume", () => {
  it("読み込み中_移さない(最初の節を出したまま)", async () => {
    client.fetchNotebook.mockReturnValue(new Promise(() => {}));
    await renderResume();
    expect(replace).not.toHaveBeenCalled();
  });

  it("読み込みのあと_最初の完了していない節へ移す", async () => {
    client.fetchNotebook.mockResolvedValue({
      units: new Map(),
      entries: new Map([
        ["domain1-1#a", AT],
        ["domain1-1#b", AT],
      ]),
    });
    await renderResume();
    expect(replace).toHaveBeenLastCalledWith(`${BASE}/domain1-1/c`);
  });

  it("すべて完了_最初の節へ移す", async () => {
    client.fetchNotebook.mockResolvedValue({ units: new Map([["domain1-1", AT]]), entries: new Map() });
    await renderResume();
    expect(replace).toHaveBeenLastCalledWith(`${BASE}/domain1-1/a`);
  });

  it("読めない_最初の節へ移す", async () => {
    client.fetchNotebook.mockResolvedValue(null);
    await renderResume();
    expect(replace).toHaveBeenLastCalledWith(`${BASE}/domain1-1/a`);
  });

  it("管理者のプレビュー_完了を読まず_最初の節へ移す", async () => {
    await renderResume(true);
    expect(client.fetchNotebook).not.toHaveBeenCalled();
    expect(replace).toHaveBeenLastCalledWith(`${BASE}/domain1-1/a`);
  });
});
