// 通知を受け取る Service Worker。プッシュ通知を表示し、押されたら、このサイトの画面を開く。
// 画面のキャッシュ(オフライン対応)はしない。

const DEFAULT_TITLE = "もくもく問題集";

/** このサイトの中の画面だけを開く(別のサイトになる値や、ほかの形は、ホームにする)。 */
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : DEFAULT_TITLE;
  const body = typeof data.body === "string" ? data.body : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(safePath(event.notification.data?.url)));
});
