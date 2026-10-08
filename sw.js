/* =========================================================
   Service worker : il garde une copie des fichiers de l'appli
   dans le téléphone pour qu'elle marche sans internet.

   ⚠️ À CHAQUE MISE À JOUR DE L'APPLI :
   change le numéro ci-dessous (v1 → v2 → v3...).
   C'est ce qui dit au téléphone « il y a du nouveau ».
   ========================================================= */
const VERSION_CACHE = 'budget-v1';

// Liste des fichiers à garder hors connexion (chemins relatifs)
const FICHIERS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Installation : on télécharge et on range tous les fichiers
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION_CACHE)
      .then((cache) => cache.addAll(FICHIERS))
      .then(() => self.skipWaiting()) // la nouvelle version prend la main tout de suite
  );
});

// Activation : on supprime les anciennes versions du cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms.filter((n) => n !== VERSION_CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Chaque demande de fichier : on sert la copie locale si elle existe,
// sinon on va la chercher sur internet.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((enCache) => {
      if (enCache) return enCache;
      return fetch(event.request).catch(() => {
        // Hors connexion et fichier inconnu : on renvoie la page principale
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
