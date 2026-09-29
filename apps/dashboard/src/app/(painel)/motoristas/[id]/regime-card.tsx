"use client";

import { Briefcase, HandCoins, HelpCircle } from "lucide-react";
import Link from "next/link";
import { usePermissoes } from "@/lib/permissoes";

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
export function RegimeCard({
  regime,
  motoristaId,
}: {
  regime: RegimeDaPessoa;
  motoristaId?: string;
}) {
  const { temPermissao, temModulo } = usePermissoes();
  const podeRegistrar = temPermissao("funcionarios.criar") && temModulo("funcionarios.criar");

  // "Não declarado" é o caso mais comum e é uma resposta de verdade: o registro
  // só nasce com alocação em obra ou com contratação. Chutar "parceiro" aqui
  // seria o sistema afirmar vínculo — o assunto mais caro que ele toca.
  //
  // ⚠️ O botão mora AQUI porque é onde o gestor procura: o da Schaba abriu a
  // ficha do motorista, foi em "Dar ou tirar algo só dele" e não achou nada de
  // ponto. O caminho por Ponto › Quem bate ponto existia, mas ninguém dizia
  // que a ficha não é o lugar. O botão leva pra lá com a pessoa já escolhida.
  if (!regime) {
    // Sem o módulo Ponto o texto abaixo manda "registrar aqui" pra um lugar que
    // a empresa não tem — some junto com o botão.
    if (!temModulo("funcionarios.criar")) return null;
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4">
        <HelpCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Esta pessoa não bate ponto</p>
          <p className="text-sm text-muted-foreground">
            É o normal para quem só roda frete. Se ela é registrada em carteira e precisa
            bater ponto no app, registre aqui.
          </p>
          {podeRegistrar && motoristaId && (
            <Link
              href={`/ponto/funcionarios?motorista=${motoristaId}`}
              className="mt-2 inline-flex h-9 items-center rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Registrar pra bater ponto
            </Link>
          )}
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
            ? "Recebe por folha de pagamento. As viagens dele não entram em acerto."
            : "Recebe pelo que produz: viagem, tonelada ou km, conforme a modalidade."}
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
