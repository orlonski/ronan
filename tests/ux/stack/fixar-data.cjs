// Pré-carregado (NODE_OPTIONS=--require) na API e no dashboard do stack de medidas de UX.
// Faz o "agora" desses processos valer UX_ANCHOR (default 2026-09-29T15:00:00Z) no instante
// UX_REAL_T0 (ms, definido por subir-stack.sh) e seguir andando em tempo real dali.
// Por quê: o seed ancora as datas em 29/09/2026; sem isso, "hoje", "há 3 dias" e os filtros
// de período mudariam a cada dia e o screenshot do ultrawide flutuaria. Só vale no stack de teste.
const Real = Date;
const anchor = Real.parse(process.env.UX_ANCHOR || "2026-09-29T15:00:00Z");
const t0 = Number(process.env.UX_REAL_T0 || Real.now());
const off = anchor - t0;
const agora = () => Real.now() + off;
globalThis.Date = new Proxy(Real, {
  construct(alvo, args, nt) {
    return args.length ? Reflect.construct(alvo, args, nt) : Reflect.construct(alvo, [agora()], nt);
  },
  apply() {
    return new globalThis.Date().toString();
  },
  get(alvo, prop) {
    if (prop === "now") return agora;
    return Reflect.get(alvo, prop, alvo);
  },
});
