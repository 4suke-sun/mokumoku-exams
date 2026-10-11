import { describe, expect, it } from "vitest";
import { isPushServiceEndpoint, MAX_ENDPOINT_LENGTH, pushKey } from "./endpoint.ts";

describe("isPushServiceEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-example.notify.windows.com/w/?token=abc",
  ])("主なブラウザのプッシュサービス_受け付ける_%s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ["http", "http://fcm.googleapis.com/fcm/send/abc"],
    ["既知でないホスト", "https://example.com/push"],
    ["末尾だけ似たホスト", "https://fcm.googleapis.com.example.com/abc"],
    ["接尾辞の前に点がない", "https://evilpush.apple.com/abc"],
    ["ポートの指定", "https://fcm.googleapis.com:8443/abc"],
    ["認証情報の埋め込み", "https://user:pass@fcm.googleapis.com/abc"],
    ["内部のアドレス", "https://169.254.169.254/latest"],
    ["URL でない", "fcm.googleapis.com/abc"],
    ["長すぎる", `https://fcm.googleapis.com/${"a".repeat(MAX_ENDPOINT_LENGTH)}`],
  ])("受け付けない_%s", (_name, endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});

describe("pushKey", () => {
  it("endpoint のハッシュを使い_endpoint そのものは含めない", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/device-1";
    const key = pushKey(endpoint);
    expect(key).toMatch(/^PUSH#[0-9a-f]{64}$/);
    expect(key).not.toContain("device-1");
    expect(pushKey(endpoint)).toBe(key);
    expect(pushKey(`${endpoint}x`)).not.toBe(key);
  });
});
