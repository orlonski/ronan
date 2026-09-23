import {
  MODULOS,
  MODULOS_POR_CHAVE,
  moduloDaChave,
  PERMISSOES_ADMIN_EMPRESA,
  TODAS_AS_CHAVES,
  type ModuloChave,
} from "@ronan/shared-types";

/** Cliente mínimo, tipado por forma pelo mesmo motivo de `eh-plataforma.ts`. */
type ClienteConta = {
  conta: {
    findUnique: (args: {
      where: { id: string };
      select: { ehPlataforma: true; permissoesPermitidas: true; permissoesExtras: true };
    }) => Promise<{
      ehPlataforma: boolean;
      permissoesPermitidas: string[];
      permissoesExtras?: string[];
    } | null>;
  };
  configuracaoPermissoes: {
    findUnique: (args: {
      where: { id: string };
      select: { tetoPadrao: true; semeado: true };
    }) => Promise<{ tetoPadrao: string[]; semeado: boolean } | null>;
  };
  moduloContratado: {
    findMany: (args: {
      where: { contaId: string; ativo: true };
      select: { chave: true; vigenteDe: true; vigenteAte: true };
    }) => Promise<{ chave: string; vigenteDe: Date | null; vigenteAte: Date | null }[]>;
  };
};

/** Só a data importa na vigência de um contrato, nunca a hora. */
function vigenteHoje(m: { vigenteDe: Date | null; vigenteAte: Date | null }, hoje: Date): boolean {
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const h = dia(hoje);
  if (m.vigenteDe && dia(m.vigenteDe) > h) return false;
  // `vigenteAte` é inclusivo: o último dia do contrato ainda vale.
  if (m.vigenteAte && dia(m.vigenteAte) < h) return false;
  return true;
}

/**
 * Os módulos que valem HOJE nesta conta.
 *
 * O núcleo entra sempre, contratado ou não: desligar Operação seria vender um
 * sistema de viagens que não registra viagem, e uma conta sem nenhuma linha na
 * tabela (criada antes do módulo existir, ou por um bug de seed) precisa
 * continuar funcionando em vez de virar uma tela em branco.
 */
export async function modulosDaConta(
  prisma: ClienteConta,
  contaId: string,
  hoje: Date = new Date(),
): Promise<Set<ModuloChave>> {
  const linhas = await prisma.moduloContratado.findMany({
    where: { contaId, ativo: true },
    select: { chave: true, vigenteDe: true, vigenteAte: true },
  });

  const ativos = new Set<ModuloChave>(
    MODULOS.filter((m) => m.nucleo).map((m) => m.chave),
  );
  for (const l of linhas) {
    if (!vigenteHoje(l, hoje)) continue;
    if (MODULOS_POR_CHAVE[l.chave as ModuloChave]) ativos.add(l.chave as ModuloChave);
  }
  return ativos;
}

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
 *    e não uma constante de código — somado às `permissoesExtras` da conta.
 *
 * As extras existem pra empresa que precisa de ALGO além do padrão (a Schaba
 * usa Conferência de ticket e Praças de pedágio) sem congelar o resto: com a
 * lista fechada do caso 2, toda tela nova do padrão passava longe dela. Foi
 * assim que a Schaba chegou a 23/09/2026 sem 73 chaves que qualquer conta nova
 * tem.
 *
 * O caso 3 é o que mantém o comportamento de antes do teto existir, e é por isso
 * que "vazio" significa o padrão em vez de "nada": um teto vazio interpretado ao
 * pé da letra deixaria toda empresa sem conceder nada.
 */
export async function tetoDaConta(prisma: ClienteConta, contaId: string): Promise<Set<string>> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: { ehPlataforma: true, permissoesPermitidas: true, permissoesExtras: true },
  });

  if (conta?.ehPlataforma) return new Set(TODAS_AS_CHAVES);

  const chaves =
    conta && conta.permissoesPermitidas.length > 0
      ? conta.permissoesPermitidas
      : [...(await tetoPadrao(prisma)), ...(conta?.permissoesExtras ?? [])];

  // Interseção com o catálogo: chave que saiu do código não volta à vida por
  // estar guardada no banco.
  const validas = new Set(TODAS_AS_CHAVES);

  // E interseção com o que a empresa CONTRATOU. Este é o ponto onde módulo e
  // RBAC se encontram, e é o único lugar que precisou mudar: a poda de chaves
  // acima do teto já existia e já era testada, então módulo cancelado passa a
  // podar papel sozinho, sem código novo.
  const modulos = await modulosDaConta(prisma, contaId);

  return new Set(
    chaves.filter((c) => {
      if (!validas.has(c)) return false;
      const modulo = moduloDaChave(c);
      // Chave sem módulo não existe (há teste de invariante garantindo), mas se
      // aparecer, ela passa: derrubar acesso por causa de um catálogo
      // incompleto seria pior que o vazamento que isso evitaria.
      return modulo == null || modulos.has(modulo);
    }),
  );
}

/** O que, de `chaves`, está acima do teto. Vazio = tudo permitido. */
export function acimaDoTeto(chaves: string[], teto: Set<string>): string[] {
  return chaves.filter((c) => !teto.has(c));
}
