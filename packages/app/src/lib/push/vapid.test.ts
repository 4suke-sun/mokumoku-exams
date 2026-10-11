import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrivateKeyLoader, readSsmParameter, readVapid, VapidKeyUnavailableError } from "./vapid.ts";

const PARAMETER = "/example/push/vapid-private-key";
// 見本の秘密鍵(実際の鍵ではない)
const PRIVATE_KEY = "k".repeat(43);

describe("readVapid", () => {
  const env = {
    VAPID_PUBLIC_KEY: "public",
    VAPID_PRIVATE_KEY_PARAMETER: PARAMETER,
    VAPID_SUBJECT: "mailto:admin@example.com",
  };

  it("3 つそろっているときだけ_設定を返す", () => {
    expect(readVapid(env)).toEqual({
      publicKey: "public",
      privateKeyParameter: PARAMETER,
      subject: "mailto:admin@example.com",
    });
    expect(readVapid({ ...env, VAPID_PRIVATE_KEY_PARAMETER: "" })).toBeNull();
    expect(readVapid({})).toBeNull();
  });

  it("秘密鍵の値を環境変数に置いても_使わない", () => {
    const { VAPID_PRIVATE_KEY_PARAMETER: _, ...rest } = env;
    expect(readVapid({ ...rest, VAPID_PRIVATE_KEY: PRIVATE_KEY })).toBeNull();
    expect(JSON.stringify(readVapid({ ...env, VAPID_PRIVATE_KEY: PRIVATE_KEY }))).not.toContain(PRIVATE_KEY);
  });
});

describe("createPrivateKeyLoader", () => {
  it("同時に呼ばれても_1 度だけ読み_そのあとは覚えた値を使う", async () => {
    const read = vi.fn(async () => PRIVATE_KEY);
    const load = createPrivateKeyLoader(read);
    expect(await Promise.all([load(PARAMETER), load(PARAMETER), load(PARAMETER)])).toEqual([
      PRIVATE_KEY,
      PRIVATE_KEY,
      PRIVATE_KEY,
    ]);
    expect(await load(PARAMETER)).toBe(PRIVATE_KEY);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(PARAMETER);
  });

  it("読めない_原因を捨てて失敗にし_次に呼ばれたときに読み直す", async () => {
    const cause = `AccessDeniedException: ${PARAMETER}`;
    const read = vi.fn<(name: string) => Promise<string | undefined>>(async () => {
      throw new Error(cause);
    });
    const load = createPrivateKeyLoader(read);
    const failure = await load(PARAMETER).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VapidKeyUnavailableError);
    expect((failure as Error).message).not.toContain(cause);
    expect((failure as Error).message).not.toContain(PARAMETER);
    expect((failure as Error).cause).toBeUndefined();

    read.mockResolvedValueOnce(PRIVATE_KEY);
    expect(await load(PARAMETER)).toBe(PRIVATE_KEY);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("値がない・空_失敗にする", async () => {
    for (const value of [undefined, ""]) {
      const load = createPrivateKeyLoader(async () => value);
      await expect(load(PARAMETER)).rejects.toBeInstanceOf(VapidKeyUnavailableError);
    }
  });
});

describe("readSsmParameter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("パラメーターを_復号して読む", async () => {
    const send = vi
      .spyOn(SSMClient.prototype, "send")
      .mockImplementation(async () => ({ Parameter: { Value: PRIVATE_KEY } }));
    expect(await readSsmParameter(PARAMETER)).toBe(PRIVATE_KEY);
    const [command] = send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(GetParameterCommand);
    expect((command as GetParameterCommand).input).toEqual({ Name: PARAMETER, WithDecryption: true });
  });
});
