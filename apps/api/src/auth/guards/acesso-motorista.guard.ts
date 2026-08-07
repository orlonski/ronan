import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";

export const ACESSO_KEY = "acessoMotorista";

export type AcessoFlag =
  | "podeLancarViagem"
  | "podeIniciarViagem"
  | "podeViagemLifecycle"
  | "podeLancarPedagio"
  | "podeLancarAbastecimento"
  | "podeUsarOcrTicket"
  | "podeVerStories"
  | "podeChat";

/**
 * Bloqueia endpoint do motorista quando a feature flag dele tá desligada.
 * Aplicado via @AcessoMotorista("podeXyz") + @UseGuards(AcessoMotoristaGuard).
 * Não-motorista (admin) passa sem checagem.
 */
@Injectable()
export class AcessoMotoristaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AcessoFlag | undefined>(
      ACESSO_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string; kind: string } | undefined;
    if (!user) throw new ForbiddenException("Não autenticado");
    if (user.kind !== "MOTORISTA") return true;

    const motorista = await this.prisma.motorista.findUnique({
      where: { id: user.id },
      select: { status: true, [required]: true } as Record<AcessoFlag | "status", true>,
    });
    // Cadastro ainda não aprovado não lança nada (modo "em análise" no app).
    if (motorista?.status !== "APROVADO") {
      throw new ForbiddenException(
        "Seu cadastro ainda está em análise. Aguarde a aprovação pra usar o app.",
      );
    }
    if (!motorista?.[required as keyof typeof motorista]) {
      throw new ForbiddenException("Funcionalidade desabilitada pra esse motorista.");
    }
    return true;
  }
}
