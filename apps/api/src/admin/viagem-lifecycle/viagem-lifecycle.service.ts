import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AtualizarTipoEventoViagemInput,
  CriarTipoEventoViagemInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { AuditoriaService } from "../../auditoria/auditoria.service";

@Injectable()
export class ViagemLifecycleAdminService {
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
