// pipeline のテストは fixture だけを使う。外部への通信を試みたら、その場で失敗させる。
import dns from "node:dns";
import net from "node:net";

const BLOCKED = "テストでは外部への通信を許していません";

globalThis.fetch = () => Promise.reject(new Error(BLOCKED));

net.Socket.prototype.connect = () => {
  throw new Error(BLOCKED);
};

dns.lookup = (() => {
  throw new Error(BLOCKED);
}) as unknown as typeof dns.lookup;
