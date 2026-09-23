import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MotivoDivergencia } from "@prisma/client";
import type {
  AtualizarTipoEventoViagemInput,
  CriarTipoEventoViagemInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { aplicarDivergencias, Divergencias } from "../../common/divergencias";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { inicioDoDiaData } from "../../common/timezone";

@Injectable()
export class ViagemLifecycleAdminService {
  private readonly log = new Logger(ViagemLifecycleAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ---- Catálogo de tipos de evento ----

  listarTipos() {
    return this.prisma.tipoEventoViagem.findMany({
      orderBy: [{ ativo: "desc" }, { ordem: "asc" }, { nome: "asc" }],
    });
  }

  async criarTipo(data: CriarTipoEventoViagemInput, usuarioId: string) {
    const jaExiste = await this.prisma.tipoEventoViagem.findFirst({
      where: { slug: data.slug },
      select: { id: true },
    });
    if (jaExiste) throw new ConflictException(`Já existe um tipo com o slug "${data.slug}".`);
    return this.prisma.tipoEventoViagem.create({
      data: { ...data, criadoPorId: usuarioId },
    });
  }

  async atualizarTipo(id: string, data: AtualizarTipoEventoViagemInput) {
    await this.ensureTipo(id);
    return this.prisma.tipoEventoViagem.update({ where: { id }, data });
  }

  /**
   * Remove um tipo. Se já tem eventos históricos, faz soft-delete (ativo=false)
   * pra não quebrar o histórico — os eventos guardam tipoSlug como snapshot.
   */
  async removerTipo(id: string) {
    await this.ensureTipo(id);
    const usado = await this.prisma.eventoViagem.count({ where: { tipoEventoId: id } });
    if (usado > 0) {
      await this.prisma.tipoEventoViagem.update({ where: { id }, data: { ativo: false } });
      return { ok: true, soft: true };
    }
    await this.prisma.tipoEventoViagem.delete({ where: { id } });
    return { ok: true, soft: false };
  }

  private async ensureTipo(id: string) {
    const t = await this.prisma.tipoEventoViagem.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException("Tipo de evento não encontrado");
  }

  // ---- Viagens em andamento (ao vivo) ----

  viagensEmAndamento(escopo: EscopoAdmin) {
    return this.prisma.viagem.findMany({
      where: { status: "EM_ANDAMENTO", ...filtroEscopo(escopo) },
      orderBy: { iniciadoEm: "asc" },
      select: {
        id: true,
        clientId: true,
        iniciadoEm: true,
        criadoOfflineEm: true,
        lat: true,
        lng: true,
        motorista: { select: { id: true, nome: true, telefone: true } },
        veiculo: { select: { id: true, placa: true } },
        localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        // O destino faltava no payload, então a tela mostrava de onde a viagem
        // saiu e não pra onde ia — justamente o que o supervisor precisa saber
        // pra estimar chegada. Nulos até o motorista escolher no finalizar.
        localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        cliente: { select: { id: true, nome: true } },
        material: { select: { id: true, nome: true } },
        eventosViagem: {
          orderBy: { ocorridoEm: "asc" },
          select: {
            id: true,
            tipoSlug: true,
            // O nome legível pro card. O `tipoSlug` continua sendo o snapshot
            // que manda no histórico; ele só não serve de rótulo — a tela
            // mostrava "cheguei-carga" pro supervisor.
            tipoEvento: { select: { nome: true } },
            ocorridoEm: true,
            lat: true,
            lng: true,
            localId: true,
            toneladas: true,
            observacao: true,
          },
        },
      },
    });
  }

  /**
   * Fecha uma viagem que ficou aberta, SEM destruir o que ela já tem.
   *
   * Até aqui o painel não tinha como fechar uma casca órfã — só apagar. O
   * carimbo `VIAGEM_ANTERIOR_ABERTA` mandava o conferente "conferir o que ela
   * tem e fechar na mão", e essa ação não existia: `PATCH /admin/viagens/:id`
   * não tem transição pra EM_ANDAMENTO e `AtualizarViagemInput` nem aceita
   * `status`. As duas saídas do painel eram DELETE físico, jogando fora eventos,
   * GPS da carga, fotos e as horas que a pessoa rodou.
   *
   * A saída certa é INCOMPLETA, e a máquina toda já existe: INCOMPLETA já está
   * em STATUS_FORA_FECHAMENTO (nenhum ponto novo de exclusão a revisar — era a
   * objeção registrada aqui contra criar status novo), o painel já sabe
   * completar viagem incompleta preenchendo campo, e
   * `resolverDivergenciasSupridas` promove sozinha pra ENVIADA quando não falta
   * mais nada. O conferente termina a viagem que o motorista não terminou.
   */
  async fecharEmAndamento(
    id: string,
    usuarioId: string | null,
    origem: "painel" | "varredura" = "painel",
  ) {
    const v = await this.prisma.viagem.findUnique({
      where: { id },
      include: {
        _count: { select: { eventosViagem: true } },
      },
    });
    if (!v) throw new NotFoundException("Viagem não encontrada");
    if (v.status !== "EM_ANDAMENTO") {
      throw new ConflictException("Só dá pra fechar viagem que está em andamento.");
    }

    // O que falta vira carimbo, um por campo — é o mesmo vocabulário que o
    // conferente já vê nas viagens que entraram incompletas pelo app, então a
    // tela de "Falta preencher" resolve esta igual às outras.
    const divs = new Divergencias();
    divs.add(MotivoDivergencia.VIAGEM_ABANDONADA, {
      origem,
      iniciadoEm: v.iniciadoEm?.toISOString() ?? null,
      eventos: v._count.eventosViagem,
    });
    if (!v.clienteId) divs.add(MotivoDivergencia.FALTA_CLIENTE);
    if (!v.materialId) divs.add(MotivoDivergencia.FALTA_MATERIAL);
    if (!v.localDescargaId) divs.add(MotivoDivergencia.FALTA_LOCAL_DESCARGA);
    if (v.km == null) divs.add(MotivoDivergencia.FALTA_KM);
    if (v.toneladas == null || Number(v.toneladas) <= 0) {
      divs.add(MotivoDivergencia.FALTA_TONELADAS);
    }

    const atualizada = await this.prisma.viagem.update({
      where: { id },
      data: {
        status: divs.statusFinal("ENVIADA"),
        // Sem `data` a viagem fica invisível na tela de Viagens: o filtro
        // default é `data >= primeiro dia do mês`, e `gte` não casa com NULL.
        // Fechar sem isto seria trocar uma casca escondida por outra.
        ...(v.data ? {} : { data: inicioDoDiaData(v.iniciadoEm ?? new Date()) }),
      },
    });
    await aplicarDivergencias(this.prisma, id, divs);

    // O alerta da torre morre junto. A varredura faria isso em até 5 minutos,
    // mas quem acabou de clicar "Fechar" precisa ver o card sumir agora.
    await this.prisma.alertaOperacional.updateMany({
      where: { viagemId: id, resolvidoEm: null },
      data: { resolvidoEm: new Date(), resolvidoAuto: true },
    });

    await this.auditoria.log({
      usuarioId: usuarioId ?? undefined,
      entidade: "Viagem",
      entidadeId: id,
      acao: "UPDATE",
      motivo:
        origem === "painel"
          ? "Viagem em andamento fechada pelo painel"
          : "Viagem em andamento fechada pela varredura de abandono",
      valorAntes: { status: v.status, data: v.data },
      valorDepois: { status: atualizada.status, data: atualizada.data },
    });

    return atualizada;
  }

  /**
   * Fecha sozinha a viagem abandonada há mais de N horas.
   *
   * Nasce DESLIGADA (`fecharAbandonadaHoras = 0`): fechar viagem de gente é
   * decisão da empresa, não padrão de fábrica. Enquanto estiver desligada, a
   * torre segue mostrando a viagem esquecida na tela e alguém fecha no botão.
   */
  @Cron("0 10 5 * * *", { name: "fechar-viagens-abandonadas", timeZone: "America/Sao_Paulo" })
  async fecharAbandonadas(): Promise<void> {
    try {
      await comLockDeCron(this.prisma, "fechar-viagens-abandonadas", async () => {
        await paraCadaConta(this.prisma, () => this.fecharAbandonadasDaConta());
      });
    } catch (e) {
      this.log.error(`falha ao fechar viagens abandonadas: ${(e as Error).message}`);
    }
  }

  private async fecharAbandonadasDaConta(): Promise<void> {
    const cfg = await this.prisma.configuracaoTorre.findFirst({
      select: { fecharAbandonadaHoras: true },
    });
    const horas = cfg?.fecharAbandonadaHoras ?? 0;
    if (horas <= 0) return;

    const corte = new Date(Date.now() - horas * 3_600_000);
    const presas = await this.prisma.viagem.findMany({
      where: {
        status: "EM_ANDAMENTO",
        // `iniciadoEm` é nullable; sem ele vale quando a viagem chegou no servidor.
        OR: [{ iniciadoEm: { lt: corte } }, { iniciadoEm: null, sincronizadoEm: { lt: corte } }],
      },
      select: { id: true },
      take: 200,
    });

    for (const v of presas) {
      try {
        await this.fecharEmAndamento(v.id, null, "varredura");
      } catch (e) {
        this.log.warn(`não deu pra fechar a viagem ${v.id}: ${(e as Error).message}`);
      }
    }
    if (presas.length > 0) {
      this.log.log(`${presas.length} viagens abandonadas fechadas como incompletas`);
    }
  }

  /**
   * Cancela (apaga) uma viagem EM_ANDAMENTO presa, pelo dashboard. Só apaga se
   * de fato estiver EM_ANDAMENTO — nunca uma viagem já finalizada.
   *
   * O DELETE é físico de propósito: é o rescue da casca órfã, e o índice único
   * `uq_viagem_em_andamento_por_motorista` precisa sair da frente pro motorista
   * conseguir abrir a próxima. Trocar por um status novo obrigaria a revisar os
   * pontos que filtram STATUS_FORA_FECHAMENTO, um a um — fica pra quando o
   * modelo de viagem planejada entrar.
   *
   * O que NÃO podia continuar é apagar sem rastro: isto aqui é trabalho em
   * curso de uma pessoa (GPS da carga, fotos, eventos, o km que ela já rodou),
   * e sumia inteiro sem ninguém conseguir dizer depois o que havia ali nem quem
   * mandou apagar. Guardamos o retrato antes de apagar.
   */
  async cancelarEmAndamento(id: string, usuarioId: string) {
    const v = await this.prisma.viagem.findUnique({
      where: { id },
      include: {
        motorista: { select: { id: true, nome: true } },
        veiculo: { select: { id: true, placa: true } },
        localCarga: { select: { id: true, nome: true } },
        eventosViagem: { select: { tipoSlug: true, ocorridoEm: true, observacao: true } },
      },
    });
    if (!v) throw new NotFoundException("Viagem não encontrada");
    if (v.status !== "EM_ANDAMENTO") {
      throw new ConflictException("Só dá pra cancelar viagem que está em andamento.");
    }

    // Antes do delete: o AuditLog não tem FK pra Viagem, então a linha sobrevive
    // ao registro que descreve — é o que permite responder "o que foi cancelado
    // no dia 12?" depois que a viagem não existe mais.
    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: id,
      acao: "DELETE",
      motivo: "Viagem em andamento cancelada pelo painel",
      valorAntes: v,
    });

    await this.prisma.viagem.delete({ where: { id } });
    return { ok: true };
  }
}
