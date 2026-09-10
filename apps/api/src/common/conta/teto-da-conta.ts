import { PERMISSOES_ADMIN_EMPRESA, TODAS_AS_CHAVES } from "@ronan/shared-types";

/** Cliente mínimo, tipado por forma pelo mesmo motivo de `eh-plataforma.ts`. */
type ClienteConta = {
  conta: {
    findUnique: (args: {
      where: { id: string };
      select: { ehPlataforma: true; permissoesPermitidas: true };
    }) => Promise<{ ehPlataforma: boolean; permissoesPermitidas: string[] } | null>;
  };
};

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
 * 3. Vazio — como toda empresa nasce — cai no padrão do código,
 *    `PERMISSOES_ADMIN_EMPRESA`: tudo menos o que é da plataforma.
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
  if (conta && conta.permissoesPermitidas.length > 0) {
    // Interseção com o catálogo: chave que saiu do código não volta à vida por
    // estar guardada no banco.
    const validas = new Set(TODAS_AS_CHAVES);
    return new Set(conta.permissoesPermitidas.filter((c) => validas.has(c)));
  }
  return new Set(PERMISSOES_ADMIN_EMPRESA);
}

/** O que, de `chaves`, está acima do teto. Vazio = tudo permitido. */
export function acimaDoTeto(chaves: string[], teto: Set<string>): string[] {
  return chaves.filter((c) => !teto.has(c));
}
