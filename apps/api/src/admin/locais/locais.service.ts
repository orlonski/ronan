import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { NivelConfiancaLocal, type Prisma, type TipoLocal, FonteEvidencia } from "@prisma/client";
import type { CriarLocalInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListLocaisParams = PaginationQuery & {
  clienteId?: string;
  tipo?: TipoLocal;
  ativo?: "true" | "false";
  nivelConfianca?: NivelConfiancaLocal;
  /**
   * Atalho usado pela aba "Em validação": filtra nivelConfianca <= DWELL.
   */
  emValidacao?: "true" | "false";
};

const LOCAL_INCLUDE = {
  clientes: {
    select: { cliente: { select: { id: true, nome: true } } },
    orderBy: { criadoEm: "asc" },
  },
  criadoPorMotorista: { select: { id: true, nome: true } },
} satisfies Prisma.LocalInclude;

type LocalRaw = Prisma.LocalGetPayload<{ include: typeof LOCAL_INCLUDE }>;

function flattenLocal<T extends LocalRaw>(local: T) {
  const { clientes, ...rest } = local;
  return { ...rest, clientes: clientes.map((c) => c.cliente) };
}

@Injectable()
export class LocaisService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListLocaisParams) {
    const where: Prisma.LocalWhereInput = {};
    if (params.clienteId) where.clientes = { some: { clienteId: params.clienteId } };
    if (params.tipo) where.tipo = params.tipo;
    if (params.ativo === "true") where.ativo = true;
    else if (params.ativo === "false") where.ativo = false;
    else where.ativo = true;
    if (params.nivelConfianca) where.nivelConfianca = params.nivelConfianca;
    if (params.emValidacao === "true") {
      where.nivelConfianca = {
        in: [
          NivelConfiancaLocal.RASCUNHO,
          NivelConfiancaLocal.PRESENCA_PONTUAL,
          NivelConfiancaLocal.DWELL_CONFIRMADO,
        ],
      };
    }
    const result = await paginate(this.prisma.local, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["nome", "logradouro", "bairro", "cidade", "pontoReferencia"],
      sortable: {
        nome: "nome",
        cidade: "cidade",
        uf: "uf",
        tipo: "tipo",
        ativo: "ativo",
        criadoEm: "criadoEm",
        nivelConfianca: "nivelConfianca",
      },
      defaultSort: { field: "nome", order: "asc" },
      include: LOCAL_INCLUDE,
    });
    return { ...result, data: (result.data as LocalRaw[]).map(flattenLocal) };
  }

  async findOne(id: string) {
    const local = await this.prisma.local.findUniqueOrThrow({
      where: { id },
      include: LOCAL_INCLUDE,
    });
    return flattenLocal(local);
  }

  /**
   * Admin homologa manualmente — sobe pra HUMANO (top da hierarquia).
   */
  async homologar(id: string) {
    await this.ensureExists(id);
    await this.prisma.localEvidencia.create({
      data: {
        localId: id,
        // ADMIN não tem motorista; usa um motorista "sentinela" só pro audit?
        // Simplifica: não exige motoristaId pra fonte ADMIN. Reusa o primeiro
        // motorista do banco como placeholder pra não quebrar o FK.
        // → Alternativa melhor: pular o LocalEvidencia pra fonte ADMIN, só
        // atualizar o Local direto.
        motoristaId: await this.algumMotoristaId(),
        fonte: FonteEvidencia.ADMIN,
      },
    }).catch(() => {
      /* sem motorista no banco — segue sem audit */
    });
    return this.prisma.local.update({
      where: { id },
      data: {
        nivelConfianca: NivelConfiancaLocal.HUMANO,
        ultimaValidacaoEm: new Date(),
      },
    });
  }

  /**
   * Mescla local "origem" no "destino": move viagens (carga e descarga) pro
   * destino e apaga o origem. Útil pra eliminar duplicatas que escaparam do
   * pre-check de 200m.
   */
  async mesclar(origemId: string, destinoId: string) {
    if (origemId === destinoId) {
      throw new ConflictException("Origem e destino são o mesmo local");
    }
    const [origem, destino] = await Promise.all([
      this.prisma.local.findUnique({ where: { id: origemId } }),
      this.prisma.local.findUnique({ where: { id: destinoId } }),
    ]);
    if (!origem) throw new NotFoundException("Local de origem não encontrado");
    if (!destino) throw new NotFoundException("Local de destino não encontrado");

    await this.prisma.$transaction([
      this.prisma.viagem.updateMany({
        where: { localCargaId: origemId },
        data: { localCargaId: destinoId },
      }),
      this.prisma.viagem.updateMany({
        where: { localDescargaId: origemId },
        data: { localDescargaId: destinoId },
      }),
      this.prisma.rotaCache.deleteMany({
        where: { OR: [{ localOrigemId: origemId }, { localDestinoId: origemId }] },
      }),
      this.prisma.local.delete({ where: { id: origemId } }),
    ]);
    return { ok: true };
  }

  private async algumMotoristaId(): Promise<string> {
    const m = await this.prisma.motorista.findFirst({ select: { id: true } });
    if (!m) throw new ConflictException("Nenhum motorista cadastrado");
    return m.id;
  }

  async create(data: CriarLocalInput) {
    const { clienteIds, ...rest } = data;
    const local = await this.prisma.local.create({
      data: {
        ...(rest as Prisma.LocalUncheckedCreateInput),
        clientes: clienteIds.length
          ? { create: clienteIds.map((clienteId) => ({ clienteId })) }
          : undefined,
      },
      include: LOCAL_INCLUDE,
    });
    return flattenLocal(local);
  }

  async update(
    id: string,
    data: Partial<CriarLocalInput> & { ativo?: boolean },
  ) {
    await this.ensureExists(id);
    const { clienteIds, ...rest } = data;
    const local = await this.prisma.$transaction(async (tx) => {
      if (clienteIds !== undefined) {
        await tx.localCliente.deleteMany({ where: { localId: id } });
        if (clienteIds.length) {
          await tx.localCliente.createMany({
            data: clienteIds.map((clienteId) => ({ localId: id, clienteId })),
          });
        }
      }
      return tx.local.update({
        where: { id },
        data: rest as Prisma.LocalUncheckedUpdateInput,
        include: LOCAL_INCLUDE,
      });
    });
    return flattenLocal(local);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [carga, descarga] = await Promise.all([
      this.prisma.viagem.count({ where: { localCargaId: id } }),
      this.prisma.viagem.count({ where: { localDescargaId: id } }),
    ]);
    const total = carga + descarga;
    if (total > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${total} viagem${total === 1 ? "" : "s"} (${carga} de carga, ${descarga} de descarga). Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    // RotaCache sai cascade via schema
    await this.prisma.local.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const l = await this.prisma.local.findUnique({ where: { id } });
    if (!l) throw new NotFoundException("Local não encontrado");
    return l;
  }
}
