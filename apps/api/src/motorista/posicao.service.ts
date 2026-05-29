import { Injectable, Logger } from "@nestjs/common";
import type { EnviarPosicoesInput, PosicaoMotoristaConfig } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PosicaoMotoristaService {
  private readonly log = new Logger(PosicaoMotoristaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(motoristaId: string): Promise<PosicaoMotoristaConfig> {
    const config = await this.prisma.motoristaPosicaoConfig.findUnique({
      where: { motoristaId },
    });
    if (!config) {
      return { ativada: false, horarioInicio: null, horarioFim: null };
    }
    return {
      ativada: config.ativada,
      horarioInicio: config.horarioInicio,
      horarioFim: config.horarioFim,
    };
  }

  async salvarConfig(
    motoristaId: string,
    input: PosicaoMotoristaConfig,
  ): Promise<PosicaoMotoristaConfig> {
    const config = await this.prisma.motoristaPosicaoConfig.upsert({
      where: { motoristaId },
      create: {
        motoristaId,
        ativada: input.ativada,
        horarioInicio: input.horarioInicio ?? null,
        horarioFim: input.horarioFim ?? null,
      },
      update: {
        ativada: input.ativada,
        horarioInicio: input.horarioInicio ?? null,
        horarioFim: input.horarioFim ?? null,
      },
    });
    return {
      ativada: config.ativada,
      horarioInicio: config.horarioInicio,
      horarioFim: config.horarioFim,
    };
  }

  /**
   * Recebe batch de posições do app. Idempotente: `(motoristaId, capturadoEm)`
   * é único — reenvio de posição já gravada é ignorado silenciosamente.
   * `createMany` com `skipDuplicates` lida com isso sem precisar de loop.
   */
  async receberPosicoes(
    motoristaId: string,
    input: EnviarPosicoesInput,
  ): Promise<{ recebidas: number }> {
    if (input.posicoes.length === 0) return { recebidas: 0 };

    // Guarda só se motorista tem config ativada — defesa em profundidade.
    // App já verifica client-side antes de chamar, mas dupla checagem evita
    // gravação se motorista desativou enquanto fila tinha pendentes.
    const config = await this.prisma.motoristaPosicaoConfig.findUnique({
      where: { motoristaId },
      select: { ativada: true },
    });
    if (!config?.ativada) {
      this.log.warn(
        `Motorista ${motoristaId} enviou ${input.posicoes.length} posições mas config está desativada — ignorando.`,
      );
      return { recebidas: 0 };
    }

    const result = await this.prisma.motoristaPosicao.createMany({
      data: input.posicoes.map((p) => ({
        motoristaId,
        lat: p.lat,
        lng: p.lng,
        precisao: p.precisao ?? null,
        velocidade: p.velocidade ?? null,
        capturadoEm: new Date(p.capturadoEm),
      })),
      skipDuplicates: true,
    });
    return { recebidas: result.count };
  }
}
