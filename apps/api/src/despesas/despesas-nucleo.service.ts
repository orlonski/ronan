import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { MarcaDespesa } from "@ronan/shared-types";
import { semearKitDespesas } from "../common/despesa-kit";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { ItemInexistenteException } from "../common/item-inexistente";
import { detectarRepetido, diaSP, type CandidatoRepetido } from "../common/despesa-regras";
import { inicioDoDiaBR } from "../common/timezone";

/**
 * O que o lado do motorista (/m/despesas) e o lado do painel (admin/despesas)
 * fazem igual: achar a viagem, amarrar a viagem que chegou depois, procurar
 * papel repetido, servir a foto e semear o kit de tipos.
 */
@Injectable()
export class DespesasNucleoService {
  private readonly log = new Logger(DespesasNucleoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Resolve o vínculo pedido pelo celular.
   *
   * - `viagemId` que não existe → 409 ITEM_INEXISTENTE (vai pros Pendentes);
   * - `viagemClientId` de viagem que ainda não subiu → aceita e guarda (o
   *   `amarrarPendentes` liga quando ela chegar). Nunca recusa;
   * - viagem de OUTRO motorista → 409. Nunca 500.
   */
  async resolverViagem(
    motoristaId: string,
    viagemId: string | null | undefined,
    viagemClientId: string | null | undefined,
  ): Promise<{ viagemId: string | null; viagemClientId: string | null; veiculoId: string | null; naoAchada: boolean }> {
    const viagem = viagemId
      ? await this.prisma.viagem.findUnique({
          where: { id: viagemId },
          select: { id: true, clientId: true, motoristaId: true, veiculoId: true },
        })
      : viagemClientId
        ? await this.prisma.viagem.findUnique({
            where: { clientId: viagemClientId },
            select: { id: true, clientId: true, motoristaId: true, veiculoId: true },
          })
        : null;
    if (viagemId && !viagem) throw new ItemInexistenteException("viagemId");
    if (viagem && viagem.motoristaId !== motoristaId) {
      throw new ConflictException({
        code: "VIAGEM_DE_OUTRO_MOTORISTA",
        message: "Essa viagem não é sua. Escolha uma viagem sua ou deixe o gasto sem viagem.",
      });
    }
    if (!viagem) {
      return { viagemId: null, viagemClientId: viagemClientId ?? null, veiculoId: null, naoAchada: !!viagemClientId };
    }
    return { viagemId: viagem.id, viagemClientId: viagem.clientId, veiculoId: viagem.veiculoId, naoAchada: false };
  }

  /**
   * Liga os gastos que apontam pra viagem que ainda estava no celular
   * (`viagemClientId`) assim que ela existe no servidor. Roda na leitura (do
   * app e do painel) e na escrita — sem mexer no fluxo de viagem.
   */
  async amarrarPendentes(motoristaId?: string): Promise<void> {
    try {
      const pendentes = await this.prisma.despesa.findMany({
        where: {
          vinculo: "VIAGEM",
          viagemId: null,
          viagemClientId: { not: null },
          ...(motoristaId ? { motoristaId } : {}),
        },
        select: { id: true, motoristaId: true, viagemClientId: true, veiculoId: true, marcas: true },
        take: 200,
      });
      if (!pendentes.length) return;
      const viagens = await this.prisma.viagem.findMany({
        where: { clientId: { in: pendentes.map((p) => p.viagemClientId!) } },
        select: { id: true, clientId: true, motoristaId: true, veiculoId: true },
      });
      const porClient = new Map(viagens.map((v) => [v.clientId, v]));
      for (const p of pendentes) {
        const v = porClient.get(p.viagemClientId!);
        if (!v || v.motoristaId !== p.motoristaId) continue;
        await this.prisma.despesa.update({
          where: { id: p.id },
          data: {
            viagemId: v.id,
            veiculoId: p.veiculoId ?? v.veiculoId,
            marcas: p.marcas.filter((m) => m !== "VIAGEM_NAO_ACHADA"),
          },
        });
      }
    } catch (e) {
      // Amarrar é conveniência: falhar aqui não pode derrubar a leitura.
      this.log.warn(`amarrarPendentes: ${(e as Error).message}`);
    }
  }

  /** Procura papel repetido na conta (marca, nunca recusa). */
  async procurarRepetido(novo: Omit<CandidatoRepetido, "id"> & { id?: string }) {
    const dia = diaSP(novo.data);
    const de = inicioDoDiaBR(dia);
    const ate = new Date(de.getTime() + 86_400_000);
    const ou: Prisma.DespesaWhereInput[] = [
      {
        motoristaId: novo.motoristaId,
        tipoDespesaId: novo.tipoDespesaId,
        valorInformado: new Prisma.Decimal(novo.valor.toFixed(2)),
        data: { gte: de, lt: ate },
      },
    ];
    if (novo.chaveFiscal) ou.push({ chaveFiscal: novo.chaveFiscal });
    if (novo.sha256s.length) ou.push({ fotos: { some: { sha256: { in: novo.sha256s } } } });
    const candidatos = await this.prisma.despesa.findMany({
      where: { OR: ou, ...(novo.id ? { id: { not: novo.id } } : {}) },
      select: {
        id: true,
        motoristaId: true,
        tipoDespesaId: true,
        valorInformado: true,
        data: true,
        chaveFiscal: true,
        fotos: { select: { sha256: true } },
      },
      orderBy: { data: "desc" },
      take: 20,
    });
    return detectarRepetido(
      novo,
      candidatos.map((c) => ({
        id: c.id,
        motoristaId: c.motoristaId,
        tipoDespesaId: c.tipoDespesaId,
        valor: Number(c.valorInformado),
        data: c.data,
        chaveFiscal: c.chaveFiscal,
        sha256s: c.fotos.map((f) => f.sha256).filter((h): h is string => !!h),
      })),
    );
  }

  /** Troca uma marca de lugar sem mexer nas outras. */
  static comMarca(marcas: readonly string[], marca: MarcaDespesa, ligada: boolean): string[] {
    const sem = marcas.filter((m) => m !== marca);
    return ligada ? [...sem, marca] : sem;
  }

  /** A foto, servida pela API (o bucket nunca tem domínio público). */
  async fotoBuffer(despesaId: string, fotoId: string, mini = false) {
    const foto = await this.prisma.despesaFoto.findFirst({
      where: { id: fotoId, despesaId },
      select: { storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    if (mini) {
      const thumb = await this.uploads.miniatura(foto.storageKey, contentType, null);
      if (thumb) return { buffer: thumb, contentType: "image/jpeg" };
    }
    return { buffer: await this.uploads.getObjectBuffer(foto.storageKey), contentType };
  }

  /** Kit inicial de tipos (ver `common/despesa-kit.ts`). */
  semearKit(contaId: string): Promise<number> {
    return semearKitDespesas(this.prisma, contaId);
  }
}
