// Service worker mínimo — existe só pra satisfazer o critério de "instalável" do
// Chrome (app na home/desktop, janela própria, splash). NÃO faz cache offline:
// toda requisição vai direto pra rede. Se um dia quiser offline-first, é aqui.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // passthrough: deixa o browser tratar a requisição normalmente
});
