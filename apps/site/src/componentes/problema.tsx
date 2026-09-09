import { TituloSecao } from "./ui";

const DORES = [
  "A viagem nasce num áudio de WhatsApp e morre numa planilha que só uma pessoa entende.",
  "O ticket volta amassado no bolso — quando volta.",
  "O km vira discussão no dia 30, sem ninguém ter o número original de ninguém.",
  "Onde o sinal cai, o registro some. E some justo onde a viagem acontece.",
];

export function Problema() {
  return (
    <section className="secao">
      <div className="caixa grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
        <TituloSecao
          etiqueta="O problema hoje"
          titulo={<>Hoje o mês fecha na base do “eu acho”</>}
          apoio="Não é falta de esforço. É que o dado nasce fora do sistema — e chega tarde, incompleto e sem prova."
        />

        <ul className="regua">
          {DORES.map((d, i) => (
            <li
              key={d}
              className="revelar flex items-start gap-4 border-b border-borda py-5"
              style={{ "--atraso": `${i * 80}ms` } as React.CSSProperties}
            >
              <span className="mt-0.5 font-display text-[0.8rem] font-bold tabular-nums text-tinta-fraca">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[1.02rem] leading-relaxed text-tinta">{d}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
