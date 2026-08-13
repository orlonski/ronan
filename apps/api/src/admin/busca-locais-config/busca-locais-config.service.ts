import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { contaIdAtual } from "../../common/conta/conta-context";

const SINGLETON_ID = "default";

export type AtualizarBuscaLocaisInput = {
  raioInicialM?: number;
  raioAmpliadoM?: number;
  gpsAlvoMetros?: number;
  gpsMaxSegundos?: number;
  gpsLimiteSinalFracoM?: number;
};

@Injectable()
export class BuscaLocaisConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garante que existe o singleton e retorna. */
  async get() {
    return this.prisma.configuracaoBuscaLocais.upsert({
      where: { contaId: contaIdAtual() },
      update: {},
      create: {},
    });
  }

  async update(input: AtualizarBuscaLocaisInput, userId: string) {
    return this.prisma.configuracaoBuscaLocais.upsert({
      where: { contaId: contaIdAtual() },
      update: { ...input, alteradoPorId: userId },
      create: { ...input, alteradoPorId: userId },
    });
  }
}
