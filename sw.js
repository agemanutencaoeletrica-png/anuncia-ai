// Service worker do Anuncia Aí: sempre confere a versão nova no servidor;
// sem internet, abre a última cópia guardada. Dados e pagamentos nunca ficam aqui.
var CACHE = "anuncia-v1";
var BASICOS = ["./index.html", "./app.html", "./estilo.css", "./comum.js", "./artes.js", "./app.js", "./config.js", "./icone.svg", "./manifest.webmanifest"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BASICOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf("anuncia-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r.url, { cache: "no-cache", credentials: "same-origin" }).then(function (resp) {
    if (resp.ok) { var c = resp.clone(); caches.open(CACHE).then(function (k) { k.put(r, c); }); }
    return resp;
  }).catch(function () { return caches.match(r, { ignoreSearch: true }).then(function (m) { return m || Response.error(); }); }));
});
