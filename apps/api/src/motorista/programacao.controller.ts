import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ResponderProgramacaoInput, type ViagemProgramada } from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthMotorista } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { RequerCapacidade } from "../common/acesso-app/capacidade.decorator";
import {
  inicioJanelaProgramacao,
  paraMotorista,
  STATUS_COM_ACESSO,
} from "../admin/pedidos/anexos-pedido.service";

const STATUS_COM_ANEXOS = new Set<string>(STATUS_COM_ACESSO);

const ListQuery = z.object({
  /** "YYYY-MM-DD". Sem data, devolve de hoje em diante. */
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type ListQuery = z.infer<typeof ListQuery>;

/**
 * A programação do motorista: o que combinaram que ele vai levar.
 *
 * É a primeira vez que o app tem uma CAIXA DE ENTRADA DE TRABALHO — até aqui
 * ele só reportava o que já tinha acontecido. Por isso só chega o que foi
 * PUBLICADO: o quadro em rascunho é do escritório, e ver uma viagem que some
 * depois seria pior que não ver nada.
 *
 * Sem `@AcessoMotorista(...)`: não é feature em rollout, é a ordem de serviço
 * dele. Cadastro aprovado é checado na mão (o guard não roda sem decorator).
 */
@ApiTags("motorista/programacao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/programacao")
@RequerCapacidade("app.programacao.ver")
export class ProgramacaoMotoristaController {
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
  async minhas(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListQuery)) query: ListQuery,
  ): Promise<ViagemProgramada[]> {
    await this.exigirAprovado(user.id);

    // Padrão: de ontem em diante. Ontem entra porque quem abre o app às 5h da
    // manhã ainda está terminando o dia anterior. "Ontem" no calendário de SP:
    // `Date.now() - 1 dia` em UTC, depois das 21h, já era HOJE em Brasília e o
    // dia anterior sumia da lista.
    const janela = inicioJanelaProgramacao();
    const base = query.de ? new Date(`${query.de}T00:00:00Z`) : janela;

    const linhas = await this.prisma.viagemPlanejada.findMany({
      where: {
        motoristaId: user.id,
        dataPrevista: { gte: base },
        // Rascunho do escritório não vaza pro app.
        status: { in: ["PUBLICADA", "ACEITA", "EM_EXECUCAO", "CUMPRIDA", "CANCELADA"] },
      },
      orderBy: [{ dataPrevista: "asc" }, { sequencia: "asc" }],
      take: 60,
      include: {
        veiculo: { select: { id: true, placa: true } },
        pedido: {
          select: {
            id: true,
            // Só o que o escritório deixou visível. Quem decide se ele PODE
            // abrir é o endpoint do arquivo — aqui é só a lista.
            anexos: {
              where: { visivelMotorista: true },
              orderBy: { criadoEm: "asc" },
              select: { id: true, pedidoId: true, nome: true, mime: true, tamanho: true, criadoEm: true },
            },
            material: { select: { id: true, nome: true } },
            cliente: { select: { id: true, nome: true } },
            localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
            localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
          },
        },
      },
    });

    return linhas.map((p) => ({
      id: p.id,
      dataPrevista: p.dataPrevista.toISOString().slice(0, 10),
      janelaInicio: p.janelaInicio,
      janelaFim: p.janelaFim,
      sequencia: p.sequencia,
      status: p.status,
      observacao: p.observacao,
      // O que levar vem do pedido — a planejada só diz quem, quando e a ordem.
      material: p.pedido?.material ?? null,
      cliente: p.pedido?.cliente ?? null,
      localCarga: p.pedido?.localCarga ?? null,
      localDescarga: p.pedido?.localDescarga ?? null,
      veiculo: p.veiculo,
      pedidoId: p.pedido?.id ?? null,
      // Mesma regra do endpoint do arquivo: documento listado que dá 404 ao
      // tocar é pior que documento nenhum. Cancelada e fora da janela não levam.
      anexos:
        p.pedido && STATUS_COM_ANEXOS.has(p.status) && p.dataPrevista >= janela
          ? p.pedido.anexos.map(paraMotorista)
          : [],
    }));
  }

  /**
   * Aceitar ou recusar.
   *
   * Recusar exige motivo: o supervisor fica com um caminhão parado e precisa
   * saber se é quebra, se é atestado ou se o motorista só não vai. Aceitar não
   * exige nada.
   *
   * Não é um outbox: é uma resposta curta, na hora, e o app trata a falha
   * mostrando que não foi enviada — diferente de um lançamento, que não pode
   * se perder.
   */
  @Post(":id/responder")
  async responder(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ResponderProgramacaoInput)) body: ResponderProgramacaoInput,
  ) {
    await this.exigirAprovado(user.id);

    const p = await this.prisma.viagemPlanejada.findFirst({
      where: { id, motoristaId: user.id },
      select: { id: true, status: true },
    });
    if (!p) throw new NotFoundException("Programação não encontrada");
    // Já respondida ou já rodando: a resposta não muda mais nada, e deixar
    // recusar o que já virou viagem criaria um estado que ninguém lê.
    if (!["PUBLICADA", "ACEITA", "RECUSADA"].includes(p.status)) {
      return { ok: true, jaResolvida: true };
    }

    await this.prisma.viagemPlanejada.update({
      where: { id },
      data: {
        status: body.aceita ? "ACEITA" : "RECUSADA",
        respondidoEm: new Date(),
        recusaMotivo: body.aceita ? null : (body.motivo ?? null),
      },
    });
    return { ok: true };
  }
}
