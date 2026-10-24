// 홈 화면 앱으로 열 수 있게 화면 파일만 보관 (내용은 늘 드라이브에서)
const CACHE = "dlteacher-v1";
const SHELL = ["./", "index.html", "app.js", "style.css", "icon.png", "manifest.webmanifest"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  // 화면 파일은 새것 먼저, 안 되면 보관한 것
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
