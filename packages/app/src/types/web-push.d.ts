// web-push(3.x)のうち、このアプリが使う部分だけの型。パッケージ自体は型を持たない。
declare module "web-push" {
  type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
  type RequestOptions = {
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    timeout?: number;
  };
  type SendResult = { statusCode: number; body: string; headers: Record<string, string> };

  const webpush: {
    sendNotification(
      subscription: Subscription,
      payload?: string | null,
      options?: RequestOptions,
    ): Promise<SendResult>;
  };
  export default webpush;
}
