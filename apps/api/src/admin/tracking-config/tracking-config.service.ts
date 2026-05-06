import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

const SINGLETON_ID = "default";

export type AtualizarConfigInput = {
  distanciaMinMetros?: number;
  intervaloMaxSegundos?: number;
  precisaoAlta?: boolean;
  accuracyMaxMetros?: number;
  velocidadeMaxKmh?: number;
  autoFinalizarHoras?: number;
  detectorAtivado?: boolean;
  detectorVelocidadeKmh?: number;
  detectorLeituras?: number;
};

@Injectable()
export class TrackingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garante que existe singleton e retorna. */
  async get() {
    return this.prisma.configuracaoTracking.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  }

  async update(input: AtualizarConfigInput, userId: string) {
    return this.prisma.configuracaoTracking.upsert({
      where: { id: SINGLETON_ID },
      update: { ...input, alteradoPorId: userId },
      create: { id: SINGLETON_ID, ...input, alteradoPorId: userId },
    });
  }
}
