import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { contaIdAtual } from "../../common/conta/conta-context";

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
      where: { contaId: contaIdAtual() },
      update: {},
      create: {},
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
      where: { contaId: contaIdAtual() },
      update: { ...input, alteradoPorId: userId },
      create: { ...input, alteradoPorId: userId },
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
