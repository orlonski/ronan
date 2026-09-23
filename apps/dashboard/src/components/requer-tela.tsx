"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MODULOS_POR_CHAVE, moduloDaChave } from "@ronan/shared-types";
import { permDaRota, rotaAberta, usePermissoes } from "@/lib/permissoes";

const AcessoRestrito = () => (
  <div className="rounded-md border bg-muted/30 p-6">
    <p className="text-sm text-muted-foreground">
      Você não tem acesso a esta tela. Fale com um administrador.
    </p>
  </div>
);

/**
 * Tela de módulo não contratado.
 *
 * Deliberadamente diferente de "acesso restrito": ali o usuário tem que falar
 * com o administrador da empresa dele, aqui o administrador é que precisa falar
 * com a gente. Mandar os dois pro mesmo texto ("fale com um administrador") é
 * uma mentira no segundo caso — o administrador não pode resolver — e mata a
 * única chance de isso virar conversa comercial.
 *
 * Sem cadeado, sem paywall, sem preço: o modelo é recorrência vendida por gente,
 * não self-service, e o produto não sabe do plano.
 */
function ModuloNaoContratado({ chave }: { chave: string }) {
  const modulo = moduloDaChave(chave);
  const def = modulo ? MODULOS_POR_CHAVE[modulo] : null;
  if (!def) return <AcessoRestrito />;

  return (
    <div className="rounded-md border bg-muted/30 p-6">
      <p className="text-base font-semibold">{def.nome} não está ativo na sua empresa</p>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{def.pitch}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Fale com a Movatruck pra ativar.
      </p>
    </div>
  );
}

/**
 * Mostra os filhos só se o papel tiver a permissão. Usado pra esconder botões
 * de ação (Novo, Editar, Excluir, etc.) que o usuário não pode usar.
 */
/**
 * Ações que continuam valendo com a empresa em somente leitura.
 *
 * A régua é "isso muda o dado da empresa?" — a mesma de
 * `@PermiteSomenteLeitura` no backend. Ver e exportar não mudam, e são
 * justamente o que a gente promete que continua funcionando quando o teste
 * acaba; esconder o botão de exportar seria desmentir a própria faixa.
 *
 * `baixar` NÃO entra: no painel é dar baixa em cobrança, que é escrita.
 */
const ACOES_DE_LEITURA = new Set(["ver", "exportar", "documentos"]);

export function Permitido({ chave, children }: { chave: string; children: ReactNode }) {
  const { temPermissao, temModulo, estadoConta } = usePermissoes();

  /**
   * Empresa em somente leitura não mostra botão de escrever.
   *
   * Antes daqui só a faixa do topo sabia disso: a tela de Materiais dizia "pra
   * voltar a lançar, fale com a gente" no estado vazio e mantinha um "Novo
   * material" logo acima — a pessoa clicava, preenchia o formulário inteiro e
   * só descobria no Salvar. Aqui é o lugar certo de resolver porque é por onde
   * passam os 120 e poucos botões de ação do painel; resolver tela a tela
   * deixaria metade para trás e a outra metade envelheceria.
   */
  const acao = chave.split(".")[1] ?? "";
  if (estadoConta?.podeEscrever === false && !ACOES_DE_LEITURA.has(acao)) return null;

  // Botão de módulo não contratado some igual a botão sem permissão: botão
  // morto é pior que ausência, e o upsell mora na tela, não no botão.
  return temPermissao(chave) && temModulo(chave) ? <>{children}</> : null;
}

/**
 * Gate central por rota (usado no shell do painel). Lê a permissão exigida pela
 * URL atual e bloqueia se o papel não tiver. Rota sem permissão mapeada só passa
 * se estiver em ROTAS_ABERTAS — o resto é barrado (fail-closed): tela nova
 * esquecida fica fechada, não aberta pra todo mundo.
 * Salvaguarda: usuário sem papel (permissoes vazias) mas perfil ADMIN é liberado
 * pra não trancar um admin mal-configurado.
 */
export function TelaGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { temPermissao, temModulo, isLoading } = usePermissoes();

  const perm = permDaRota(pathname);
  if (!perm) return rotaAberta(pathname) ? <>{children}</> : <AcessoRestrito />;
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  // Módulo primeiro: quem não contratou não deve nem saber que falta permissão.
  if (!temModulo(perm)) return <ModuloNaoContratado chave={perm} />;
  if (!temPermissao(perm)) return <AcessoRestrito />;
  return <>{children}</>;
}

/**
 * Gate de tela por permissão. Mostra "Acesso restrito" se o papel do usuário
 * não tiver a chave. Substitui os checks manuais de `perfil !== "ADMIN"`.
 * (O backend é a fonte de verdade — isto só evita renderizar a tela.)
 */
export function RequerTela({ chave, children }: { chave: string; children: ReactNode }) {
  const { temPermissao, temModulo, isLoading } = usePermissoes();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (!temModulo(chave)) return <ModuloNaoContratado chave={chave} />;
  if (!temPermissao(chave)) {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">
          Você não tem acesso a esta tela. Fale com um administrador.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
