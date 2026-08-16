import { MotivoDivergencia, Prisma, StatusViagem, type PrismaClient } from "@prisma/client";

/**
 * O lançamento do motorista NUNCA é recusado.
 *
 * Este arquivo é o "sim, entrou — mas anota isto aqui" do sistema. Antes dele,
 * um punhado de situações respondia 4xx pro app: material desativado no painel
 * depois que o motorista já tinha escolhido, local de descarga excluído,
 * romaneio que não veio, viagem anterior que não conseguiu fechar. Em todas,
 * o resultado era o mesmo — o lançamento morria dentro do celular, o motorista
 * via "erro" numa tela onde não havia nada que ele pudesse fazer, e o
 * escritório nunca ficava sabendo que aquela viagem existiu.
 *
 * Nenhum desses casos é ação do motorista. Todos são resolvíveis por quem tem
 * o painel aberto. Então a viagem entra sempre, e o que faltou vira carimbo
 * pra conferência.
 *
 * O princípio já valia em dois pontos do código antes daqui (ticket repetido e
 * foto do comprovante, os dois "só sinaliza, nunca recusa") — isto generaliza.
 */

export type CarimboDivergencia = {
  motivo: MotivoDivergencia;
  detalhe: string;
  dados?: Prisma.InputJsonValue;
};

/**
 * Motivos que SEGURAM a viagem em INCOMPLETA (fora de match/fechamento/KPI).
 *
 * O corte é: falta dado sem o qual a viagem não pode ser faturada nem medida.
 * Deixar uma viagem sem peso ou sem km entrar no fechamento é pior que não
 * ter a viagem — vira zero somado em silêncio, que é exatamente a pegadinha
 * que o `STATUS_FORA_FECHAMENTO` existe pra evitar.
 *
 * Os motivos de FORA desta lista são informativos: a viagem segue o fluxo
 * normal (ENVIADA) e só aparece sinalizada pra quem confere.
 */
const MOTIVOS_BLOQUEANTES: ReadonlySet<MotivoDivergencia> = new Set([
  MotivoDivergencia.FALTA_MATERIAL,
  MotivoDivergencia.FALTA_LOCAL_DESCARGA,
  MotivoDivergencia.FALTA_KM,
  MotivoDivergencia.FALTA_TONELADAS,
  MotivoDivergencia.FALTA_TICKET,
  MotivoDivergencia.FALTA_CLIENTE,
  MotivoDivergencia.CADASTRO_VEICULO_SUMIU,
  MotivoDivergencia.CADASTRO_CLIENTE_SUMIU,
  MotivoDivergencia.CADASTRO_MATERIAL_SUMIU,
  MotivoDivergencia.CADASTRO_LOCAL_SUMIU,
]);

/**
 * Motivos de "falta dado" — os únicos que o painel resolve simplesmente
 * PREENCHENDO o campo. Quando o campo aparece, o carimbo se fecha sozinho
 * (ver `resolverDivergenciasSupridas`), sem o conferente ter que lembrar de
 * marcar nada como resolvido.
 */
const MOTIVOS_DE_FALTA: ReadonlySet<MotivoDivergencia> = new Set([
  MotivoDivergencia.FALTA_MATERIAL,
  MotivoDivergencia.FALTA_LOCAL_DESCARGA,
  MotivoDivergencia.FALTA_KM,
  MotivoDivergencia.FALTA_TONELADAS,
  MotivoDivergencia.FALTA_TICKET,
  MotivoDivergencia.FALTA_CLIENTE,
]);

/** Campo da Viagem que supre cada motivo de falta. */
const CAMPO_QUE_SUPRE: Partial<Record<MotivoDivergencia, keyof SupridoPor>> = {
  [MotivoDivergencia.FALTA_MATERIAL]: "materialId",
  [MotivoDivergencia.FALTA_LOCAL_DESCARGA]: "localDescargaId",
  [MotivoDivergencia.FALTA_KM]: "km",
  [MotivoDivergencia.FALTA_TONELADAS]: "toneladas",
  [MotivoDivergencia.FALTA_TICKET]: "ticket",
  [MotivoDivergencia.FALTA_CLIENTE]: "clienteId",
  [MotivoDivergencia.CADASTRO_MATERIAL_SUMIU]: "materialId",
  [MotivoDivergencia.CADASTRO_LOCAL_SUMIU]: "localDescargaId",
  [MotivoDivergencia.CADASTRO_CLIENTE_SUMIU]: "clienteId",
};

type SupridoPor = {
  materialId: unknown;
  ticket: unknown;
  localDescargaId: unknown;
  km: unknown;
  toneladas: unknown;
  clienteId: unknown;
};

/**
 * Frases prontas, escritas pra quem confere — não pro motorista, que não vê
 * nada disto. Ficam aqui (e não em cada chamador) pra que o mesmo caso leia
 * igual venha ele do lançamento avulso, do fluxo guiado ou da varredura do app.
 */
export const FRASE_PADRAO: Record<MotivoDivergencia, string> = {
  FALTA_MATERIAL: "Entrou sem material. Escolha qual foi pra fechar a viagem.",
  FALTA_LOCAL_DESCARGA: "Entrou sem local de descarga. Informe onde descarregou.",
  FALTA_KM: "Entrou sem km rodado. Confira a rota e preencha o km.",
  FALTA_TONELADAS: "Entrou sem peso. Lance as toneladas do romaneio.",
  FALTA_TICKET: "Entrou sem número de ticket. Confira o romaneio e preencha.",
  FALTA_CLIENTE: "Entrou sem cliente. Informe pra quem foi a viagem.",
  CADASTRO_VEICULO_SUMIU:
    "A placa usada no lançamento não existe mais no cadastro. Confira qual caminhão fez a viagem.",
  CADASTRO_CLIENTE_SUMIU:
    "O cliente usado no lançamento não existe mais no cadastro. Escolha o cliente certo.",
  CADASTRO_MATERIAL_SUMIU:
    "O material usado no lançamento não existe mais no cadastro. Escolha o material certo.",
  CADASTRO_LOCAL_SUMIU:
    "O local usado no lançamento não existe mais no cadastro. Escolha o local certo.",
  CADASTRO_TIPO_SERVICO_SUMIU:
    "O tipo de serviço usado no lançamento não existe mais. Confira como esta viagem deve ser medida.",
  VIAGEM_ANTERIOR_ABERTA:
    "Esta viagem ficou aberta e o motorista já iniciou outra. Provavelmente o encerramento dela não chegou a subir — confira o que ela tem e feche na mão.",
  RESGATADA_DO_APP:
    "Este lançamento ficou preso no celular do motorista e só subiu depois. Confira os dados antes de aprovar.",
  PAYLOAD_PARCIAL:
    "O app enviou dados que o servidor não entendeu por inteiro (versão antiga). Confira os campos da viagem.",
};

/**
 * Coletor de carimbos de um lançamento.
 *
 * Deduplica por motivo: o mesmo motivo apontado duas vezes no mesmo lançamento
 * é um só carimbo — é o que mantém o `@@unique([viagemId, motivo])` verdadeiro
 * e o reenvio do outbox idempotente.
 */
export class Divergencias {
  private readonly itens = new Map<MotivoDivergencia, CarimboDivergencia>();

  /** Carimba. `detalhe` omitido usa a frase padrão do motivo. */
  add(motivo: MotivoDivergencia, dados?: Prisma.InputJsonValue, detalhe?: string): this {
    if (!this.itens.has(motivo)) {
      this.itens.set(motivo, { motivo, detalhe: detalhe ?? FRASE_PADRAO[motivo], dados });
    }
    return this;
  }

  get vazio(): boolean {
    return this.itens.size === 0;
  }

  get lista(): CarimboDivergencia[] {
    return [...this.itens.values()];
  }

  /** Algum carimbo tira a viagem do fechamento? */
  get bloqueia(): boolean {
    return this.lista.some((d) => MOTIVOS_BLOQUEANTES.has(d.motivo));
  }

  /**
   * Status final da viagem. Um carimbo bloqueante vence o status desejado —
   * MENOS quando o desejado já é um "fora do fechamento" próprio
   * (EM_ANDAMENTO, AGUARDANDO_PESO, AGUARDANDO_SAIDA), que carrega semântica
   * de fluxo que INCOMPLETA apagaria: uma diária aberta precisa continuar
   * sabendo que está esperando a saída.
   */
  statusFinal(desejado: StatusViagem): StatusViagem {
    if (!this.bloqueia) return desejado;
    if (
      desejado === StatusViagem.EM_ANDAMENTO ||
      desejado === StatusViagem.AGUARDANDO_PESO ||
      desejado === StatusViagem.AGUARDANDO_SAIDA
    ) {
      return desejado;
    }
    return StatusViagem.INCOMPLETA;
  }

  /**
   * Bloco `create` aninhado pro `prisma.viagem.create`. Undefined quando não há
   * carimbo — pra não emitir chave vazia no data.
   */
  paraCreateAninhado():
    | { create: Array<{ motivo: MotivoDivergencia; detalhe: string; dados?: Prisma.InputJsonValue }> }
    | undefined {
    if (this.vazio) return undefined;
    return {
      create: this.lista.map((d) => ({
        motivo: d.motivo,
        detalhe: d.detalhe,
        ...(d.dados !== undefined ? { dados: d.dados } : {}),
      })),
    };
  }
}

/** Client do Prisma ou uma transação — os dois servem. */
type ClientePrisma = Pick<PrismaClient, "viagemDivergencia">;

/**
 * Aplica os carimbos numa viagem que JÁ existe (finalizar, reenvio, resgate).
 *
 * Só ADICIONA o que ainda não está lá: um carimbo já resolvido pelo conferente
 * não é reaberto por um reenvio do outbox — reabrir faria o mesmo trabalho
 * aparecer de novo na fila de quem já resolveu (mesma regra da vala de
 * segurança em `lancamentos-resgatados`).
 *
 * Best-effort de propósito: esta função é chamada de dentro de fluxos que já
 * deram certo (a viagem entrou). Uma exceção aqui perderia a viagem pra salvar
 * o carimbo — troca ruim.
 */
export async function aplicarDivergencias(
  db: ClientePrisma,
  viagemId: string,
  divs: Divergencias,
): Promise<void> {
  if (divs.vazio) return;
  try {
    const jaExistem = await db.viagemDivergencia.findMany({
      where: { viagemId },
      select: { id: true, motivo: true },
    });
    const conhecidos = new Set(jaExistem.map((d) => d.motivo));

    for (const d of divs.lista) {
      if (conhecidos.has(d.motivo)) continue;
      await db.viagemDivergencia.create({
        data: {
          viagemId,
          motivo: d.motivo,
          detalhe: d.detalhe,
          ...(d.dados !== undefined ? { dados: d.dados } : {}),
        },
      });
    }
  } catch {
    /* carimbo é secundário; a viagem já entrou e é ela que importa */
  }
}

/**
 * Fecha sozinho os carimbos de "falta dado" cujo campo já foi preenchido, e
 * devolve o status que a viagem deve passar a ter.
 *
 * Chamada depois de toda edição no painel: o conferente resolve preenchendo o
 * campo que faltava, não marcando uma caixinha. Se ele preencheu tudo, a
 * viagem sai de INCOMPLETA e entra no fluxo normal (ENVIADA) na mesma ação.
 *
 * Devolve `null` quando o status não deve mudar.
 */
export async function resolverDivergenciasSupridas(
  db: ClientePrisma,
  viagem: { id: string; status: StatusViagem } & SupridoPor,
  resolvidoPorId?: string | null,
): Promise<StatusViagem | null> {
  const abertas = await db.viagemDivergencia.findMany({
    where: { viagemId: viagem.id, resolvidoEm: null },
    select: { id: true, motivo: true },
  });
  if (abertas.length === 0) {
    // Nada aberto: se sobrou INCOMPLETA de um estado anterior, libera.
    return viagem.status === StatusViagem.INCOMPLETA ? StatusViagem.ENVIADA : null;
  }

  const supridas = abertas.filter((d) => {
    const campo = CAMPO_QUE_SUPRE[d.motivo];
    if (!campo) return false;
    const valor = viagem[campo];
    return valor !== null && valor !== undefined;
  });

  if (supridas.length > 0) {
    await db.viagemDivergencia.updateMany({
      where: { id: { in: supridas.map((d) => d.id) } },
      data: { resolvidoEm: new Date(), resolvidoPorId: resolvidoPorId ?? null },
    });
  }

  if (viagem.status !== StatusViagem.INCOMPLETA) return null;

  // Ainda sobra algum carimbo que segura a viagem fora do fechamento?
  const supridasIds = new Set(supridas.map((d) => d.id));
  const aindaSegura = abertas.some(
    (d) => !supridasIds.has(d.id) && MOTIVOS_BLOQUEANTES.has(d.motivo),
  );
  return aindaSegura ? null : StatusViagem.ENVIADA;
}

/** Um motivo de falta (o painel resolve preenchendo o campo)? */
export function ehMotivoDeFalta(motivo: MotivoDivergencia): boolean {
  return MOTIVOS_DE_FALTA.has(motivo);
}
