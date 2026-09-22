"use client";

import { Briefcase, HandCoins, HelpCircle } from "lucide-react";

export type RegimeDaPessoa = {
  tipo: "PARCEIRO" | "EMPREGADO";
  desde: string;
} | null;

/**
 * COMO ESTA PESSOA É PAGA nesta empresa.
 *
 * ⚠️ Não existia lugar nenhum no painel que respondesse isso — e é por isso
 * que quatro regras de pagamento divergiram sem ninguém perceber. Quem opera
 * não tinha como ver o que o sistema achava, e quando o operador não enxerga o
 * estado, ele não corrige o estado errado: ele contorna.
 *
 * ⚠️ Este cartão NÃO decide nada. É leitura. As regras de pagamento já
 * perguntam por conta própria, e repetir a decisão aqui recriaria exatamente o
 * defeito que este trabalho desfez — mais um lugar com a sua própria resposta.
 *
 * ⚠️ E não é "que cadastro ele tem". Motorista CLT da própria transportadora
 * tem os dois cadastros de propósito: dirige e bate ponto. O que muda é por
 * onde ele recebe.
 */
export function RegimeCard({ regime }: { regime: RegimeDaPessoa }) {
  // "Não declarado" é o caso mais comum e é uma resposta de verdade: o registro
  // só nasce com alocação em obra ou com contratação. Chutar "parceiro" aqui
  // seria o sistema afirmar vínculo — o assunto mais caro que ele toca.
  if (!regime) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4">
        <HelpCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Regime não declarado</p>
          <p className="text-sm text-muted-foreground">
            É o normal para quem só roda frete. O registro nasce quando você aloca a
            pessoa numa obra ou registra a contratação dela.
          </p>
        </div>
      </div>
    );
  }

  const empregado = regime.tipo === "EMPREGADO";
  const Icone = empregado ? Briefcase : HandCoins;

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 ${
        empregado ? "border-blue-300 bg-blue-50" : "border-border bg-card"
      }`}
    >
      <Icone
        className={`mt-0.5 size-5 shrink-0 ${empregado ? "text-blue-700" : "text-muted-foreground"}`}
      />
      <div>
        <p className="text-sm font-medium">
          {empregado ? "Registrado em carteira" : "Parceiro autônomo"}
          {" · desde "}
          {dataBR(regime.desde)}
        </p>
        <p className="text-sm text-muted-foreground">
          {empregado
            ? "Recebe por folha de pagamento. Viagem e dia de obra dele não entram em acerto, e a diária não se aplica."
            : "Recebe pelo que produz: viagem, tonelada, km ou diária, conforme a modalidade."}
        </p>
      </div>
    </div>
  );
}

function dataBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
