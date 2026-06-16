import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";

const SINGLETON_ID = "default";

export type AtualizarAgenteConfigInput = {
  provider?: "anthropic" | "gemini";
  modeloAnthropic?: string;
  modeloGemini?: string;
  ativo?: boolean;
  mensagemInativo?: string | null;
};

@Injectable()
export class AgenteConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Garante singleton e retorna. */
  async get() {
    const row = await this.prisma.configuracaoAgente.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
    return {
      ...row,
      keys: {
        anthropic: !!this.config.get<string>("ANTHROPIC_API_KEY"),
        gemini: !!this.config.get<string>("GEMINI_API_KEY"),
      },
    };
  }

  async update(input: AtualizarAgenteConfigInput, userId: string) {
    const row = await this.prisma.configuracaoAgente.upsert({
      where: { id: SINGLETON_ID },
      update: { ...input, alteradoPorId: userId },
      create: { id: SINGLETON_ID, ...input, alteradoPorId: userId },
    });
    return {
      ...row,
      keys: {
        anthropic: !!this.config.get<string>("ANTHROPIC_API_KEY"),
        gemini: !!this.config.get<string>("GEMINI_API_KEY"),
      },
    };
  }
}
