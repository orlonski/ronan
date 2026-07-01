import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarAbastecimentoInput } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { mesRange } from "./viagens.service";

const ABAST_INCLUDE = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
  empresa: { select: { id: true, nome: true } },
  fotos: { select: { id: true, storageKey: true } },
} satisfies Prisma.AbastecimentoInclude;

@Injectable()
export class AbastecimentosMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(
    motoristaId: string,
    filtros: { mes?: string; cursor?: string; limit: number },
  ) {
    const where: Prisma.AbastecimentoWhereInput = { motoristaId };
    if (filtros.mes) {
      const { inicio, fim } = mesRange(filtros.mes);
      where.data = { gte: inicio, lt: fim };
    }

    const itens = await this.prisma.abastecimento.findMany({
      where,
      include: ABAST_INCLUDE,
      orderBy: [{ data: "desc" }, { id: "desc" }],
      take: filtros.limit + 1,
      ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
    });

    const hasMore = itens.length > filtros.limit;
    const pageItens = hasMore ? itens.slice(0, filtros.limit) : itens;
    const nextCursor = hasMore ? pageItens[pageItens.length - 1].id : null;
    return { itens: pageItens, nextCursor };
  }

  async detalhe(motoristaId: string, id: string) {
    const a = await this.prisma.abastecimento.findUnique({
      where: { id },
      include: ABAST_INCLUDE,
    });
    if (!a) throw new NotFoundException("Abastecimento não encontrado.");
    if (a.motoristaId !== motoristaId) {
      throw new ForbiddenException("Este abastecimento não é seu.");
    }
    return a;
  }

  async fotoBuffer(motoristaId: string, abastecimentoId: string, fotoId: string) {
    const foto = await this.prisma.abastecimentoFoto.findFirst({
      where: {
        id: fotoId,
        abastecimentoId,
        abastecimento: { motoristaId },
      },
      select: { storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada.");
    const buffer = await this.uploads.getObjectBuffer(foto.storageKey);
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    return { buffer, contentType };
  }

  async create(
    motoristaId: string,
    input: CriarAbastecimentoInput & { fotoKey?: string },
  ) {
    const exists = await this.prisma.abastecimento.findUnique({
      where: { clientId: input.clientId },
    });
    if (exists) {
      // Idempotência: já recebido (sync duplicado), retorna o existente
      return this.prisma.abastecimento.findUnique({
        where: { clientId: input.clientId },
        include: ABAST_INCLUDE,
      });
    }

    // Valida FKs ANTES do create. Se o veículo/empresa não existir, o Prisma
    // estouraria FK violation → 500, e o sync do app trata 5xx como transitório
    // e retentaria pra sempre. O catálogo offline do app pode estar velho
    // (veículo/empresa removidos pelo escritório). Devolve 409 (permanente) pro
    // motorista corrigir na tela de Pendentes em vez de travar em loop.
    const veiculo = await this.prisma.veiculo.findUnique({
      where: { id: input.veiculoId },
      select: { id: true },
    });
    if (!veiculo) {
      throw new ConflictException(
        "O veículo desse abastecimento não existe mais. Confira a placa na tela de Pendentes.",
      );
    }
    if (input.empresaId) {
      const empresa = await this.prisma.empresa.findUnique({
        where: { id: input.empresaId },
        select: { id: true },
      });
      if (!empresa) {
        throw new ConflictException(
          "A empresa desse abastecimento não existe mais. Confira na tela de Pendentes.",
        );
      }
    }

    // Valida odômetro: deve ser >= último registrado pro mesmo veículo.
    const ultimo = await this.prisma.abastecimento.findFirst({
      where: { veiculoId: input.veiculoId },
      orderBy: { data: "desc" },
      select: { odometro: true, data: true },
    });
    if (ultimo && input.odometro < ultimo.odometro) {
      throw new UnprocessableEntityException(
        `Odômetro informado (${input.odometro} km) é menor que o último registrado pra esse veículo (${ultimo.odometro} km).`,
      );
    }

    // Abastecimento em comboio: valor pode vir vazio. Sem valor, sem preço/litro.
    const precoLitro =
      input.valorTotal != null
        ? Number((input.valorTotal / input.litros).toFixed(3))
        : null;

    const { fotoKey, clientId, ...rest } = input;
    return this.prisma.abastecimento.create({
      data: {
        clientId,
        motoristaId,
        veiculoId: rest.veiculoId,
        empresaId: rest.empresaId,
        data: rest.data,
        tipo: rest.tipo,
        litros: rest.litros,
        valorTotal: rest.valorTotal ?? null,
        precoLitro,
        emComboio: rest.emComboio,
        odometro: rest.odometro,
        postoNome: rest.postoNome,
        tanqueCheio: rest.tanqueCheio,
        observacao: rest.observacao,
        lat: rest.lat,
        lng: rest.lng,
        precisao: rest.precisao,
        criadoOfflineEm: rest.criadoOfflineEm,
        ...(fotoKey
          ? {
              fotos: {
                create: { storageKey: fotoKey, capturadaEm: new Date() },
              },
            }
          : {}),
      },
      include: ABAST_INCLUDE,
    });
  }

  async delete(motoristaId: string, id: string): Promise<void> {
    const a = await this.prisma.abastecimento.findUnique({
      where: { id },
      select: {
        id: true,
        motoristaId: true,
        fotos: { select: { storageKey: true } },
      },
    });
    if (!a) throw new NotFoundException("Abastecimento não encontrado.");
    if (a.motoristaId !== motoristaId) {
      throw new ForbiddenException("Você não pode apagar este abastecimento.");
    }
    await Promise.all(
      a.fotos.map((f) => this.uploads.removeObject(f.storageKey)),
    );
    await this.prisma.abastecimento.delete({ where: { id } });
  }

  /** Últimos N nomes de posto distintos do motorista pra autocompletar no app. */
  async ultimosPostos(motoristaId: string, n = 5): Promise<string[]> {
    const rows = await this.prisma.abastecimento.findMany({
      where: { motoristaId, postoNome: { not: null } },
      orderBy: { data: "desc" },
      take: 50,
      select: { postoNome: true },
    });
    const distintos = new Set<string>();
    for (const r of rows) {
      if (r.postoNome) distintos.add(r.postoNome);
      if (distintos.size >= n) break;
    }
    return [...distintos];
  }
}
