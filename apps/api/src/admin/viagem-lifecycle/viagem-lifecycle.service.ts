import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AtualizarTipoEventoViagemInput,
  CriarTipoEventoViagemInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class ViagemLifecycleAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Catálogo de tipos de evento ----

  listarTipos() {
    return this.prisma.tipoEventoViagem.findMany({
      orderBy: [{ ativo: "desc" }, { ordem: "asc" }, { nome: "asc" }],
    });
  }

  async criarTipo(data: CriarTipoEventoViagemInput, usuarioId: string) {
    const jaExiste = await this.prisma.tipoEventoViagem.findUnique({
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

  viagensEmAndamento() {
    return this.prisma.viagem.findMany({
      where: { status: "EM_ANDAMENTO" },
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
        eventosViagem: {
          orderBy: { ocorridoEm: "asc" },
          select: {
            id: true,
            tipoSlug: true,
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
}
