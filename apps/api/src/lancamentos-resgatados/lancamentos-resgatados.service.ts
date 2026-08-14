import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma, ResolucaoResgate } from "@prisma/client";
import type {
  CampoResgatado,
  ResgatarLancamentoInput,
  ResolverResgateInput,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * A vala de segurança dos lançamentos do motorista.
 *
 * Ver o comentário do model `LancamentoResgatado` pro porquê. Aqui vale a regra
 * de operação: **nada neste serviço pode derrubar o que o chamou**. Ele é
 * chamado de dentro de fluxos que já deram errado (o app reportando um item que
 * morreu) ou que deram certo (o create que fecha o caso) — nos dois, uma
 * exceção daqui seria pior que a falta do registro.
 */
@Injectable()
export class LancamentosResgatadosService {
  private readonly log = new Logger(LancamentosResgatadosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Guarda (ou atualiza) a cópia de um lançamento que o app não conseguiu
   * enviar. Idempotente por (clientId, tipo): o app pode reenviar à vontade.
   */
  async guardar(
    motorista: { id: string; nome: string },
    input: ResgatarLancamentoInput,
    appVersao?: string | null,
  ) {
    const dados = {
      motoristaId: motorista.id,
      motoristaNome: motorista.nome,
      payload: input.payload as Prisma.InputJsonValue,
      erroMensagem: input.erroMensagem ?? null,
      erroStatus: input.erroStatus ?? null,
      appVersao: appVersao ?? null,
      criadoOfflineEm: input.criadoOfflineEm ?? null,
    };

    const salvo = await this.prisma.lancamentoResgatado.upsert({
      where: { clientId_tipo: { clientId: input.clientId, tipo: input.tipo } },
      // Reenvio de um caso já encerrado NÃO reabre o caso: o escritório pode ter
      // lançado na mão, e reabrir faria o mesmo trabalho aparecer de novo.
      update: dados,
      create: { clientId: input.clientId, tipo: input.tipo, ...dados },
      select: { id: true },
    });
    return { id: salvo.id };
  }

  /**
   * Fecha sozinho o caso quando o lançamento daquele clientId finalmente entra.
   *
   * Chamado dos `create` dos serviços do motorista. Best-effort e silencioso de
   * propósito: se falhar, o pior que acontece é um caso já resolvido continuar
   * listado — nunca o contrário, e nunca derrubar a criação que deu certo.
   */
  async marcarQueSubiu(clientId: string): Promise<void> {
    try {
      await this.prisma.lancamentoResgatado.updateMany({
        where: { clientId, resolvidoEm: null },
        data: {
          resolucao: "SUBIU_SOZINHO",
          resolvidoEm: new Date(),
        },
      });
    } catch (erro) {
      this.log.warn(
        `Não deu pra fechar o resgate do clientId ${clientId}: ` +
          `${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  async listar(filtros: { status?: "abertos" | "resolvidos" | "todos"; limit?: number }) {
    const status = filtros.status ?? "abertos";
    const where: Prisma.LancamentoResgatadoWhereInput =
      status === "abertos"
        ? { resolvidoEm: null }
        : status === "resolvidos"
          ? { resolvidoEm: { not: null } }
          : {};

    const linhas = await this.prisma.lancamentoResgatado.findMany({
      where,
      orderBy: { recebidoEm: "desc" },
      take: Math.min(filtros.limit ?? 100, 300),
      include: {
        motorista: { select: { id: true, nome: true } },
        resolvidoPor: { select: { nome: true } },
      },
    });

    // Um `campos` por linha, cada um com uma leva de consultas de existência.
    // Sequencial de propósito: a tela é de exceção (dezenas de linhas, não
    // milhares) e paralelizar aqui só disputaria conexão com o resto da API.
    const itens = [];
    for (const l of linhas) {
      itens.push({
        id: l.id,
        clientId: l.clientId,
        tipo: l.tipo,
        motorista: { id: l.motorista.id, nome: l.motorista.nome },
        motoristaNome: l.motoristaNome,
        erroMensagem: l.erroMensagem,
        erroStatus: l.erroStatus,
        appVersao: l.appVersao,
        criadoOfflineEm: l.criadoOfflineEm?.toISOString() ?? null,
        recebidoEm: l.recebidoEm.toISOString(),
        resolucao: l.resolucao,
        resolvidoEm: l.resolvidoEm?.toISOString() ?? null,
        resolvidoPorNome: l.resolvidoPor?.nome ?? null,
        observacao: l.observacao,
        campos: await this.traduzir(l.payload as Record<string, unknown>),
        payload: l.payload as Record<string, unknown>,
      });
    }
    return itens;
  }

  async resolver(id: string, usuarioId: string, input: ResolverResgateInput) {
    const existe = await this.prisma.lancamentoResgatado.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException("Lançamento não encontrado.");

    return this.prisma.lancamentoResgatado.update({
      where: { id },
      data: {
        resolucao: input.resolucao as ResolucaoResgate,
        resolvidoEm: new Date(),
        resolvidoPorId: usuarioId,
        observacao: input.observacao ?? null,
      },
      select: { id: true, resolucao: true, resolvidoEm: true },
    });
  }

  /**
   * Traduz o payload cru na leitura que resolve o caso.
   *
   * O ponto alto é o `existe: false`: em vez de mostrar um uuid e deixar quem
   * está na tela cruzar id na mão, a linha já diz "Placa — não existe mais".
   * Nove em cada dez casos aqui são exatamente isso, e é a diferença entre
   * "entendi na hora" e "vou ter que investigar".
   */
  private async traduzir(payload: Record<string, unknown>): Promise<CampoResgatado[]> {
    const campos: CampoResgatado[] = [];
    const texto = (v: unknown): string =>
      v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

    const referencia = async (
      rotulo: string,
      id: unknown,
      buscar: (id: string) => Promise<string | null>,
    ) => {
      if (typeof id !== "string" || !id) return;
      const nome = await buscar(id);
      campos.push({
        rotulo,
        valor: nome ?? `${id} (não existe mais)`,
        existe: nome != null,
      });
    };

    await referencia("Placa", payload.veiculoId, async (id) => {
      const v = await this.prisma.veiculo.findUnique({
        where: { id },
        select: { placa: true },
      });
      return v?.placa ?? null;
    });
    await referencia("Cliente", payload.clienteId, async (id) => {
      const c = await this.prisma.cliente.findUnique({
        where: { id },
        select: { nome: true },
      });
      return c?.nome ?? null;
    });
    await referencia("Material", payload.materialId, async (id) => {
      const m = await this.prisma.material.findUnique({
        where: { id },
        select: { nome: true },
      });
      return m?.nome ?? null;
    });
    await referencia("Empresa", payload.empresaId, async (id) => {
      const e = await this.prisma.empresa.findUnique({
        where: { id },
        select: { nome: true },
      });
      return e?.nome ?? null;
    });
    const local = async (rotulo: string, id: unknown) =>
      referencia(rotulo, id, async (lid) => {
        const l = await this.prisma.local.findUnique({
          where: { id: lid },
          select: { nome: true, cidade: true, uf: true },
        });
        return l ? `${l.nome}${l.cidade ? ` — ${l.cidade}/${l.uf}` : ""}` : null;
      });
    await local("Local de carga", payload.localCargaId);
    await local("Local de descarga", payload.localDescargaId);

    // Os campos que o motorista digitou. Vão depois das referências porque é a
    // referência que costuma explicar a recusa; estes são o que precisa ser
    // relançado na mão.
    const SIMPLES: [string, string][] = [
      ["data", "Data"],
      ["toneladas", "Toneladas"],
      ["km", "Km"],
      ["ticket", "Ticket"],
      ["valor", "Valor"],
      ["pracaPedagio", "Praça de pedágio"],
      ["litros", "Litros"],
      ["valorTotal", "Valor total"],
      ["odometro", "Odômetro"],
      ["postoNome", "Posto"],
      ["nome", "Nome"],
      ["observacao", "Observação"],
    ];
    for (const [chave, rotulo] of SIMPLES) {
      if (payload[chave] == null || payload[chave] === "") continue;
      campos.push({ rotulo, valor: texto(payload[chave]) });
    }
    return campos;
  }
}
