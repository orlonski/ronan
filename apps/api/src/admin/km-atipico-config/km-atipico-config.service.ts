import { Injectable } from "@nestjs/common";
import type { AtualizarConfigKmAtipicoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

const SINGLETON_ID = "default";

/** Config singleton das réguas de km atípico. Mesmo padrão do
 *  BuscaLocaisConfigService: upsert garante que o registro "default" exista. */
@Injectable()
export class KmAtipicoConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garante o singleton e retorna. */
  async get() {
    return this.prisma.configuracaoKmAtipico.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  }

  async update(input: AtualizarConfigKmAtipicoInput, userId: string) {
    return this.prisma.configuracaoKmAtipico.upsert({
      where: { id: SINGLETON_ID },
      update: { ...input, alteradoPorId: userId },
      create: { id: SINGLETON_ID, ...input, alteradoPorId: userId },
    });
  }
}
