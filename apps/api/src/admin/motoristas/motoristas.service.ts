import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  CriarMotoristaInput,
  AtualizarMotoristaInput,
  PlacaInput,
  EnviarPushInput,
  EnviarPushResultado,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { UploadsService } from "../../uploads/uploads.service";
import { PushService } from "../../push/push.service";
import { paginate, type Paginated, type PaginationQuery } from "../../common/pagination";

type ListMotoristasParams = PaginationQuery & { ativo?: "true" | "false" };

const SAFE_SELECT = {
  id: true,
  nome: true,
  cpf: true,
  telefone: true,
  email: true,
  veiculoDefaultId: true,
  veiculoDefault: { select: { id: true, placa: true, modelo: true } },
  veiculos: {
    select: { veiculo: { select: { id: true, placa: true, modelo: true, ativo: true } } },
    orderBy: { veiculo: { placa: "asc" } },
  },
  documentos: {
    select: {
      id: true,
      tipo: true,
      nomeArquivo: true,
      mimetype: true,
      tamanho: true,
      validade: true,
      criadoEm: true,
      alteradoEm: true,
    },
    orderBy: { tipo: "asc" },
  },
  ativo: true,
  ultimoLoginEm: true,
  expoPushToken: true,
  podeLancarViagem: true,
  podeIniciarViagem: true,
  podeLancarPedagio: true,
  podeLancarAbastecimento: true,
  criadoEm: true,
  criadoPor: { select: { id: true, nome: true } },
} as const;

type PrismaTx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

@Injectable()
export class MotoristasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly push: PushService,
  ) {}

  async list(params: ListMotoristasParams): Promise<Paginated<ReturnType<typeof this.flatten>>> {
    const where: Prisma.MotoristaWhereInput = {};
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;

    const result = await paginate<Record<string, unknown>, ListMotoristasParams>(
      this.prisma.motorista,
      {
        params,
        where: where as Record<string, unknown>,
        searchFields: ["nome", "cpf", "telefone", "email"],
        sortable: {
          nome: "nome",
          cpf: "cpf",
          criadoEm: "criadoEm",
          ultimoLoginEm: "ultimoLoginEm",
          ativo: "ativo",
        },
        defaultSort: { field: "nome", order: "asc" },
        select: SAFE_SELECT as unknown as Record<string, unknown>,
      },
    );
    return {
      data: result.data.map((m) =>
        this.flatten(m as Parameters<typeof this.flatten>[0]),
      ),
      pagination: result.pagination,
    };
  }

  async findOne(id: string) {
    const m = await this.prisma.motorista.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    return this.flatten(m);
  }

  async create(data: CriarMotoristaInput, usuarioId: string) {
    const exists = await this.prisma.motorista.findUnique({ where: { cpf: data.cpf } });
    if (exists) throw new ConflictException("CPF já cadastrado");
    const senhaHash = await AuthService.hashPassword(data.senha);

    const created = await this.prisma.$transaction(async (tx) => {
      const motorista = await tx.motorista.create({
        data: {
          nome: data.nome,
          cpf: data.cpf,
          senhaHash,
          telefone: data.telefone,
          email: data.email,
          criadoPorId: usuarioId,
        },
      });
      const resolvidos = await this.upsertPlacas(tx, data.placas);
      if (resolvidos.length > 0) {
        await tx.motoristaVeiculo.createMany({
          data: resolvidos.map((v) => ({ motoristaId: motorista.id, veiculoId: v.id })),
          skipDuplicates: true,
        });
      }
      const veiculoDefaultId = this.resolverDefault(data.placaDefault, resolvidos);
      if (veiculoDefaultId) {
        await tx.motorista.update({
          where: { id: motorista.id },
          data: { veiculoDefaultId },
        });
      }
      return tx.motorista.findUniqueOrThrow({ where: { id: motorista.id }, select: SAFE_SELECT });
    });
    return this.flatten(created);
  }

  async update(id: string, data: AtualizarMotoristaInput) {
    const atual = await this.prisma.motorista.findUnique({
      where: { id },
      include: { veiculos: { select: { veiculoId: true } } },
    });
    if (!atual) throw new NotFoundException("Motorista não encontrado");

    const { novaSenha, placas: placasInput, placaDefault, ...rest } = data;
    const updateData: Record<string, unknown> = { ...rest };
    if (novaSenha) updateData.senhaHash = await AuthService.hashPassword(novaSenha);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (placasInput) {
        const resolvidos = await this.upsertPlacas(tx, placasInput);
        const novosIds = new Set(resolvidos.map((v) => v.id));
        const atuaisIds = atual.veiculos.map((v) => v.veiculoId);
        const removidos = atuaisIds.filter((vid) => !novosIds.has(vid));
        const adicionados = resolvidos
          .filter((v) => !atuaisIds.includes(v.id))
          .map((v) => v.id);

        if (removidos.length > 0) {
          if (atual.veiculoDefaultId && removidos.includes(atual.veiculoDefaultId)) {
            updateData.veiculoDefaultId = null;
          }
          await tx.motoristaVeiculo.deleteMany({
            where: { motoristaId: id, veiculoId: { in: removidos } },
          });
          await this.limparOrfaosSemHistorico(tx, removidos);
        }
        if (adicionados.length > 0) {
          await tx.motoristaVeiculo.createMany({
            data: adicionados.map((veiculoId) => ({ motoristaId: id, veiculoId })),
            skipDuplicates: true,
          });
        }
        if (placaDefault !== undefined) {
          updateData.veiculoDefaultId = this.resolverDefault(placaDefault, resolvidos);
        } else if (resolvidos.length === 1 && !atual.veiculoDefaultId) {
          updateData.veiculoDefaultId = resolvidos[0]!.id;
        }
      } else if (placaDefault !== undefined) {
        // Placas não mudaram mas default sim — resolve contra os vínculos atuais
        const atuais = await tx.motoristaVeiculo.findMany({
          where: { motoristaId: id },
          select: { veiculo: { select: { id: true, placa: true } } },
        });
        updateData.veiculoDefaultId = this.resolverDefault(
          placaDefault,
          atuais.map((a) => a.veiculo),
        );
      }

      return tx.motorista.update({ where: { id }, data: updateData, select: SAFE_SELECT });
    });
    return this.flatten(updated);
  }

  async atualizarAcessos(
    id: string,
    input: {
      podeLancarViagem?: boolean;
      podeIniciarViagem?: boolean;
      podeLancarPedagio?: boolean;
      podeLancarAbastecimento?: boolean;
    },
  ) {
    const exists = await this.prisma.motorista.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Motorista não encontrado");
    return this.prisma.motorista.update({
      where: { id },
      data: input,
      select: {
        id: true,
        podeLancarViagem: true,
        podeIniciarViagem: true,
        podeLancarPedagio: true,
        podeLancarAbastecimento: true,
      },
    });
  }

  async remove(id: string) {
    const atual = await this.prisma.motorista.findUnique({
      where: { id },
      include: {
        veiculos: { select: { veiculoId: true } },
        documentos: { select: { storageKey: true } },
      },
    });
    if (!atual) throw new NotFoundException("Motorista não encontrado");

    const [viagens, pedagios, abastecimentos] = await Promise.all([
      this.prisma.viagem.count({ where: { motoristaId: id } }),
      this.prisma.pedagio.count({ where: { motoristaId: id } }),
      this.prisma.abastecimento.count({ where: { motoristaId: id } }),
    ]);
    const partes: string[] = [];
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "s"}`);
    if (pedagios > 0) partes.push(`${pedagios} pedágio${pedagios === 1 ? "" : "s"}`);
    if (abastecimentos > 0)
      partes.push(`${abastecimentos} abastecimento${abastecimentos === 1 ? "" : "s"}`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }

    const veiculoIds = atual.veiculos.map((v) => v.veiculoId);
    const docKeys = atual.documentos.map((d) => d.storageKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.motorista.delete({ where: { id } });
      await this.limparOrfaosSemHistorico(tx, veiculoIds);
    });
    // Cascade já apagou os rows de motorista_documento — só sobrou limpar
    // os objetos no MinIO. Off-transaction: se falhar fica lixo, não bloqueia.
    for (const key of docKeys) {
      await this.uploads.removeObject(key);
    }
    return { ok: true };
  }

  /**
   * Pra cada placa do input, faz upsert: se placa existe, retorna o veículo
   * (atualiza modelo se vier diferente). Se não existe, cria veículo novo.
   */
  private async upsertPlacas(
    tx: PrismaTx,
    placas: PlacaInput[],
  ): Promise<{ id: string; placa: string }[]> {
    if (placas.length === 0) return [];
    const resolvidos: { id: string; placa: string }[] = [];
    for (const p of placas) {
      const existente = await tx.veiculo.findUnique({ where: { placa: p.placa } });
      if (existente) {
        if (p.modelo && existente.modelo !== p.modelo) {
          await tx.veiculo.update({
            where: { id: existente.id },
            data: { modelo: p.modelo },
          });
        }
        resolvidos.push({ id: existente.id, placa: existente.placa });
      } else {
        const novo = await tx.veiculo.create({
          data: { placa: p.placa, modelo: p.modelo },
        });
        resolvidos.push({ id: novo.id, placa: novo.placa });
      }
    }
    return resolvidos;
  }

  /**
   * Pra cada veiculoId, se não tem mais nenhum motorista vinculado E não tem
   * histórico (viagens, pedágios, abastecimentos), deleta. Veículos com
   * histórico ficam órfãos preservados.
   */
  private async limparOrfaosSemHistorico(tx: PrismaTx, veiculoIds: string[]) {
    for (const vid of veiculoIds) {
      const vinculos = await tx.motoristaVeiculo.count({ where: { veiculoId: vid } });
      if (vinculos > 0) continue;
      const [v, p, a] = await Promise.all([
        tx.viagem.count({ where: { veiculoId: vid } }),
        tx.pedagio.count({ where: { veiculoId: vid } }),
        tx.abastecimento.count({ where: { veiculoId: vid } }),
      ]);
      if (v === 0 && p === 0 && a === 0) {
        await tx.veiculo.delete({ where: { id: vid } });
      }
    }
  }

  private resolverDefault(
    placaDefault: string | null | undefined,
    veiculos: { id: string; placa: string }[],
  ): string | null {
    if (placaDefault == null) {
      return veiculos.length === 1 ? veiculos[0]!.id : null;
    }
    const match = veiculos.find((v) => v.placa === placaDefault);
    return match?.id ?? null;
  }

  private flatten<V>(
    m: { veiculos: { veiculo: V }[]; expoPushToken?: string | null } & Record<string, unknown>,
  ) {
    // Token raw nunca é exposto pro frontend — só o booleano deriva dele.
    const { veiculos, expoPushToken, ...rest } = m;
    return {
      ...rest,
      veiculos: veiculos.map((v) => v.veiculo),
      temPushToken: !!expoPushToken,
    };
  }

  async enviarPush(
    motoristaId: string,
    body: EnviarPushInput,
    usuarioId: string,
  ): Promise<EnviarPushResultado> {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, ativo: true, expoPushToken: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    if (!m.ativo) return { enviado: false, motivo: "Motorista inativo" };
    if (!m.expoPushToken) {
      return { enviado: false, motivo: "Motorista ainda não abriu o app (sem token)" };
    }
    return this.push.enviar({
      motoristaId: m.id,
      token: m.expoPushToken,
      titulo: body.titulo,
      corpo: body.corpo,
      dados: body.dados,
      tipo: "mensagem-admin",
      criadoPorId: usuarioId,
    });
  }
}
