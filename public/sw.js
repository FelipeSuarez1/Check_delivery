/**
 * Service worker mínimo — existe para o navegador oferecer "instalar o app".
 *
 * DE PROPÓSITO não guarda nada de página, dado ou resposta de ação: o app mostra
 * encomendas, nomes e fotos de moradores, e cache offline disso ficaria legível
 * no aparelho depois do logout. Só reaproveita arquivos estáticos de build
 * (/_next/static, com hash no nome) e os ícones.
 */
const CACHE = "encomendas-estatico-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const build = url.pathname.startsWith("/_next/static/");
  const icone = url.pathname.startsWith("/icons/");
  if (!build && !icone) return; // todo o resto vai direto à rede, sempre

  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (build) {
        // nome com hash = imutável: cache primeiro
        const guardado = await cache.match(req);
        if (guardado) return guardado;
        const resposta = await fetch(req);
        if (resposta.ok) cache.put(req, resposta.clone());
        return resposta;
      }
      // ícones mantêm o nome ao mudar: rede primeiro, cache só se estiver offline
      try {
        const resposta = await fetch(req);
        if (resposta.ok) cache.put(req, resposta.clone());
        return resposta;
      } catch {
        const guardado = await cache.match(req);
        if (guardado) return guardado;
        throw new Error("offline");
      }
    })
  );
});
