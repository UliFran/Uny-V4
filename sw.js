/* UniHub V4 — service worker (offline-first do shell do aplicativo)
   Estratégia: pré-cache do shell; rede primeiro para HTML/JS/CSS (pega atualizações
   quando online) com queda para o cache quando offline. Os dados ficam no
   IndexedDB, nunca passam pelo service worker.
   Créditos: UliFran / Ulisystem® · desenvolvido com Claude (Anthropic). */
const VERSION = 'unihub-v4-shell-1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/config.js', 'js/utils.js', 'js/db.js', 'js/ui.js',
  'js/modules/dashboard.js', 'js/modules/estoque.js', 'js/modules/clientes.js',
  'js/modules/pedidos.js', 'js/modules/financeiro.js', 'js/import.js', 'js/app.js',
  'assets/favicon.svg', 'assets/hero.jpg', 'assets/icon-192.png', 'assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fontes e APIs externas passam direto
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
