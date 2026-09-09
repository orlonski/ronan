const NUMEROS = [
  { valor: "82", rotulo: "telas no painel" },
  { valor: "417", rotulo: "endpoints de API" },
  { valor: "110", rotulo: "permissões em 37 áreas" },
  { valor: "10", rotulo: "integrações externas" },
];

export function Prova() {
  return (
    <section className="border-y border-borda bg-superficie lg:mt-14">
      <div className="caixa">
        <dl className="grid grid-cols-2 divide-borda sm:grid-cols-4 sm:divide-x">
          {NUMEROS.map((n, i) => (
            <div
              key={n.rotulo}
              className="revelar px-1 py-7 text-center sm:px-6 sm:py-9"
              style={{ "--atraso": `${i * 70}ms` } as React.CSSProperties}
            >
              <dt className="sr-only">{n.rotulo}</dt>
              <dd>
                <span className="block font-display text-[2.1rem] font-bold leading-none text-azul sm:text-[2.6rem]">
                  {n.valor}
                </span>
                <span className="mt-2 block text-[0.86rem] leading-snug text-tinta-media">
                  {n.rotulo}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
