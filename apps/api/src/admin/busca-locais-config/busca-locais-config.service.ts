import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

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
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  }

  async update(input: AtualizarBuscaLocaisInput, userId: string) {
    return this.prisma.configuracaoBuscaLocais.upsert({
      where: { id: SINGLETON_ID },
      update: { ...input, alteradoPorId: userId },
      create: { id: SINGLETON_ID, ...input, alteradoPorId: userId },
    });
  }
}
