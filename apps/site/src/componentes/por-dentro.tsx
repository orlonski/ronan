import { TituloSecao } from "./ui";

const DECISOES = [
  {
    titulo: "O km do motorista é lei",
    texto:
      "O número que ele informou fica guardado intocável, do jeito que ele mandou. O que você fatura pode ser outro — mas a versão dele nunca é sobrescrita.",
    tecnico:
      "Alterar o km faturado sem motivo escrito é recusado pelo sistema. O que passa vira registro de auditoria com autor, data e motivo, e sai do recálculo automático.",
  },
  {
    titulo: "Offline de verdade, não “offline quando dá”",
    texto:
      "Rede ruim não vira erro na cara do motorista. O lançamento é aceito no aparelho e sincroniza sozinho quando o sinal volta.",
    tecnico:
      "Falha de rede, timeout ou erro de servidor não queimam tentativa nem marcam o item como falho — ele continua pendente. Só erro real de conteúdo pede correção, e a correção tem tela.",
  },
  {
    titulo: "Ticket: foto agora, conferência depois",
    texto:
      "A foto do ticket vira dado na hora do lançamento. Depois, a conferência automática compara foto e lançado e devolve bate, diverge ou incerto.",
    tecnico:
      "Divergência não vira cobrança automática. Bruto/tara trocado, unidade diferente ou um caractere lido errado caem como revisão humana — erro de leitura não é motorista errado.",
  },
  {
    titulo: "Mínimo por faixa, sem mexer no real",
    texto:
      "O piso de faturamento é por empresa, material e faixa de km. O contrato do cliente é respeitado sem ninguém “arredondar” o que o caminhão rodou.",
    tecnico:
      "O km real nunca é reescrito no banco. O mínimo é aplicado na hora de exibir, somar e faturar — dá pra ver os dois números lado a lado a qualquer momento.",
  },
];

export function PorDentro() {
  return (
    <section id="por-dentro" className="secao relative overflow-hidden bg-[#0E1526]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(105deg, #A6B3D2 0 1px, transparent 1px 11px)",
        }}
      />
      <div className="caixa relative">
        <TituloSecao
          claro
          etiqueta="Por dentro"
          titulo="Quatro decisões que a gente tomou e ninguém mais tomou"
          apoio="Não são recursos de lista. São regras que o sistema aplica sozinho, todo dia, e que decidem quem tem razão no fim do mês."
        />

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl2 bg-white/12 md:grid-cols-2">
          {DECISOES.map((d, i) => (
            <article
              key={d.titulo}
              className="revelar bg-[#0E1526] p-7 lg:p-9"
              style={{ "--atraso": `${i * 80}ms` } as React.CSSProperties}
            >
              <span className="font-display text-[0.78rem] font-bold tracking-[0.2em] text-laranja">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-[1.35rem] leading-snug text-white">
                {d.titulo}
              </h3>
              <p className="mt-3 text-[1rem] leading-relaxed text-[#B9C4DC]">
                {d.texto}
              </p>
              <p className="mt-5 border-l-2 border-laranja/70 pl-4 text-[0.9rem] leading-relaxed text-[#93A1C0]">
                <span className="font-semibold text-[#C9D3E8]">
                  Detalhe técnico:
                </span>{" "}
                {d.tecnico}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
