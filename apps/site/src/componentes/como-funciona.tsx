import { ArrowRight } from "lucide-react";
import { Tela, TituloSecao } from "./ui";
import { WHATSAPP_URL } from "../lib/config";

const PASSOS = [
  {
    titulo: "O motorista lança",
    texto:
      "Na pedreira, na obra, no meio do nada. Sem sinal também: o app guarda e envia sozinho quando a rede volta.",
  },
  {
    titulo: "O sistema confere",
    texto:
      "Foto do ticket vira dado na hora. A conferência compara o que está na foto com o que foi lançado e dá o veredito: bate, diverge ou incerto.",
  },
  {
    titulo: "Você fecha e fatura",
    texto:
      "Fecha o período, aplica o mínimo contratado por cliente e material, exporta no layout que aquele embarcador pede. Com registro de quem conferiu o quê.",
  },
];

export function ComoFunciona() {
  return (
    <section id="como-funciona" className="secao border-t border-borda bg-superficie">
      <div className="caixa">
        <TituloSecao
          etiqueta="Como funciona"
          titulo="Três passos. Um por dia útil de trabalho."
        />

        <ol className="mt-12 grid gap-px overflow-hidden rounded-xl2 border border-borda bg-borda md:grid-cols-3">
          {PASSOS.map((p, i) => (
            <li
              key={p.titulo}
              className="revelar bg-superficie p-7 lg:p-8"
              style={{ "--atraso": `${i * 90}ms` } as React.CSSProperties}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-azul font-display text-[1.05rem] font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-5 text-[1.2rem] font-semibold">{p.titulo}</h3>
              <p className="mt-2.5 text-[0.99rem] leading-relaxed text-tinta-media">
                {p.texto}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1.35fr_1fr] lg:gap-14">
          <Tela
            src="/telas/06c-conciliacao-linhas.webp"
            alt="Tela de fechamento do Movatruck com as linhas do período conferidas, uma a uma, prontas pra virar fatura."
            className="revelar"
          />
          <div className="revelar">
            <h3 className="text-[1.35rem] leading-snug">
              O fechamento não é um relatório. É a linha que vira fatura.
            </h3>
            <p className="mt-3 text-[1rem] leading-relaxed text-tinta-media">
              Cada viagem do período aparece com km, tonelada, mínimo aplicado e o
              estado da conferência. Se alguém mudou alguma coisa, está escrito quem
              mudou, quando e por quê.
            </p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-secundario mt-6"
            >
              Ver os três passos numa demonstração
              <ArrowRight size={17} aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
