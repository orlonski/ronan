import { Check, Minus } from "lucide-react";
import { TituloSecao } from "./ui";

const SIM = [
  "Você transporta granel — areia, brita, concreto, terra — e cobra por viagem, tonelada ou km.",
  "Seus motoristas rodam onde o sinal cai.",
  "Você fecha período pra faturar e hoje isso dói.",
  "Você tem mais de um cliente embarcador e cada um pede o relatório num formato.",
  "Você trabalha com motorista parceiro, agregado ou terceiro, e precisa que o número seja aceito pelos dois lados.",
];

const NAO = [
  "Você faz entrega fracionada ou e-commerce com muitas paradas por rota — não é esse o desenho.",
  "Você quer rastreador de veículo 24h: o Movatruck registra a viagem que o motorista lança, não persegue o caminhão.",
  "Você precisa emitir CT-e, MDF-e ou nota fiscal: a gente não emite documento fiscal.",
  "Você quer instalar tudo no seu próprio servidor: hoje é SaaS, roda na nossa infraestrutura.",
  "Você quer um app onde ninguém confere nada: metade do valor está na conferência.",
];

export function ParaQuem() {
  return (
    <section className="secao border-t border-borda bg-superficie">
      <div className="caixa">
        <TituloSecao
          etiqueta="Honestidade"
          titulo="Pra quem é — e pra quem não é"
          apoio="Preferimos perder a reunião agora do que perder o cliente no terceiro mês."
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="revelar rounded-xl2 border border-verde/30 bg-verde-lavado p-7">
            <h3 className="text-[1.15rem] font-semibold text-[#14603A]">
              É pra você se
            </h3>
            <ul className="mt-5 space-y-3.5">
              {SIM.map((s) => (
                <li key={s} className="flex items-start gap-3">
                  <Check
                    size={18}
                    className="mt-1 flex-none text-verde"
                    aria-hidden
                  />
                  <span className="text-[0.99rem] leading-relaxed text-tinta">{s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            className="revelar rounded-xl2 border border-borda bg-superficie-2 p-7"
            style={{ "--atraso": "90ms" } as React.CSSProperties}
          >
            <h3 className="text-[1.15rem] font-semibold text-tinta">
              Não é pra você se
            </h3>
            <ul className="mt-5 space-y-3.5">
              {NAO.map((s) => (
                <li key={s} className="flex items-start gap-3">
                  <Minus
                    size={18}
                    className="mt-1 flex-none text-tinta-fraca"
                    aria-hidden
                  />
                  <span className="text-[0.99rem] leading-relaxed text-tinta-media">
                    {s}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
