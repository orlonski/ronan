import { Controller, ForbiddenException, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AcertoDoMotorista } from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthMotorista } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { totalizarAcerto } from "../common/acerto-motorista";

/**
 * O extrato do motorista: o que a empresa apurou que deve a ele.
 *
 * SEM `@AcessoMotorista(...)` de propósito, pelo mesmo motivo dos lançamentos
 * travados: isto não é uma feature em rollout, é o direito de ver a própria
 * conta. Gatear por flag deixaria quem não tem a flag sem saber quanto vai
 * receber — o que é exatamente o problema que o acerto veio resolver.
 *
 * Como o guard de acesso não roda sem decorator, a checagem de cadastro
 * aprovado é feita aqui, na mão (ver CLAUDE.md).
 *
 * Só acerto FECHADO ou PAGO aparece. Um acerto ABERTO é rascunho do escritório:
 * mostrar um número que ainda vai mudar geraria a pior conversa possível —
 * "ontem estava R$ 4.200".
 */
@ApiTags("motorista/acertos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/acertos")
export class AcertosMotoristaController {
  constructor(private readonly prisma: PrismaService) {}

  private async exigirAprovado(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { status: true },
    });
    if (m?.status !== "APROVADO") {
      throw new ForbiddenException("Seu cadastro ainda está em análise.");
    }
  }

  @Get()
  async meusAcertos(@CurrentUser() user: AuthMotorista): Promise<AcertoDoMotorista[]> {
    await this.exigirAprovado(user.id);

    const acertos = await this.prisma.acertoMotorista.findMany({
      where: { motoristaId: user.id, status: { in: ["FECHADO", "PAGO"] } },
      orderBy: { periodoInicio: "desc" },
      take: 24, // dois anos de acertos mensais
      include: {
        itens: {
          orderBy: [{ tipo: "asc" }, { criadoEm: "asc" }],
          select: { id: true, tipo: true, descricao: true, valor: true, motivo: true },
        },
      },
    });

    return acertos.map((a) => {
      const t = totalizarAcerto(a.itens);
      return {
        id: a.id,
        periodoInicio: a.periodoInicio.toISOString().slice(0, 10),
        periodoFim: a.periodoFim.toISOString().slice(0, 10),
        status: a.status as "FECHADO" | "PAGO",
        creditos: t.creditos,
        debitos: t.debitos,
        liquido: t.liquido,
        pagoEm: a.pagoEm ? a.pagoEm.toISOString() : null,
        pagoMeio: a.pagoMeio,
        observacao: a.observacao,
        itens: a.itens.map((i) => ({
          id: i.id,
          tipo: i.tipo,
          descricao: i.descricao,
          valor: i.valor.toString(),
          motivo: i.motivo,
        })),
      };
    });
  }

  /**
   * Carimba que ele ABRIU o extrato.
   *
   * O painel mostra isso, e é a diferença entre um acerto combinado e um acerto
   * imposto: se ele nunca abriu, ninguém pode dizer que ele concordou. Motorista
   * é parceiro autônomo, não empregado.
   *
   * Idempotente e só na primeira vez — o que interessa é quando ele soube, não
   * quantas vezes conferiu.
   */
  @Post(":id/visto")
  async marcarVisto(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    await this.exigirAprovado(user.id);
    const acerto = await this.prisma.acertoMotorista.findFirst({
      where: { id, motoristaId: user.id, status: { in: ["FECHADO", "PAGO"] } },
      select: { id: true, vistoEm: true },
    });
    // 404 mudo em vez de erro: não é trabalho do app do motorista descobrir que
    // o acerto existe mas está aberto.
    if (!acerto) return { ok: true };
    if (acerto.vistoEm) return { ok: true, jaVisto: true };

    await this.prisma.acertoMotorista.update({
      where: { id },
      data: { vistoEm: new Date() },
    });
    return { ok: true };
  }
}
