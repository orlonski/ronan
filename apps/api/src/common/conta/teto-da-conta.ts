import { PERMISSOES_ADMIN_EMPRESA, TODAS_AS_CHAVES } from "@ronan/shared-types";

/** Cliente mínimo, tipado por forma pelo mesmo motivo de `eh-plataforma.ts`. */
type ClienteConta = {
  conta: {
    findUnique: (args: {
      where: { id: string };
      select: { ehPlataforma: true; permissoesPermitidas: true };
    }) => Promise<{ ehPlataforma: boolean; permissoesPermitidas: string[] } | null>;
  };
  configuracaoPermissoes: {
    findUnique: (args: {
      where: { id: string };
      select: { tetoPadrao: true; semeado: true };
    }) => Promise<{ tetoPadrao: string[]; semeado: boolean } | null>;
  };
};

/**
 * O teto padrão: o que vale pra empresa que não tem teto próprio.
 *
 * Vem do banco, editável pelo painel. `PERMISSOES_ADMIN_EMPRESA` só entra
 * enquanto o boot ainda não semeou a linha — depois disso a constante não manda
 * mais em nada, que é o ponto: abrir ou fechar uma tela pra todos os clientes é
 * decisão de tela, não de deploy.
 */
export async function tetoPadrao(prisma: ClienteConta): Promise<string[]> {
  const config = await prisma.configuracaoPermissoes.findUnique({
    where: { id: "singleton" },
    select: { tetoPadrao: true, semeado: true },
  });
  return config?.semeado ? config.tetoPadrao : [...PERMISSOES_ADMIN_EMPRESA];
}

/**
 * O TETO de uma empresa: tudo que o administrador dela pode conceder aos papéis
 * que criar.
 *
 * Três casos, nesta ordem:
 *
 * 1. A casa (`ehPlataforma`) tem o catálogo inteiro — é quem opera o produto.
 * 2. Empresa com `permissoesPermitidas` preenchido usa exatamente essa lista: é
 *    a plataforma abrindo ou fechando caso a caso (liberar uma tela que custa
 *    dinheiro pra um cliente, fechar uma que ele não contratou).
 * 3. Vazio cai no TETO PADRÃO, que também é dado editável (ver `tetoPadrao`) —
 *    e não uma constante de código.
 *
 * O caso 3 é o que mantém o comportamento de antes do teto existir, e é por isso
 * que "vazio" significa o padrão em vez de "nada": um teto vazio interpretado ao
 * pé da letra deixaria toda empresa sem conceder nada.
 */
export async function tetoDaConta(prisma: ClienteConta, contaId: string): Promise<Set<string>> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: { ehPlataforma: true, permissoesPermitidas: true },
  });

  if (conta?.ehPlataforma) return new Set(TODAS_AS_CHAVES);

  const chaves =
    conta && conta.permissoesPermitidas.length > 0
      ? conta.permissoesPermitidas
      : await tetoPadrao(prisma);

  // Interseção com o catálogo: chave que saiu do código não volta à vida por
  // estar guardada no banco.
  const validas = new Set(TODAS_AS_CHAVES);
  return new Set(chaves.filter((c) => validas.has(c)));
}

/** O que, de `chaves`, está acima do teto. Vazio = tudo permitido. */
export function acimaDoTeto(chaves: string[], teto: Set<string>): string[] {
  return chaves.filter((c) => !teto.has(c));
}
