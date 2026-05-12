import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CriarMotoristaInput, AtualizarMotoristaInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";

const SAFE_SELECT = {
  id: true,
  nome: true,
  cpf: true,
  telefone: true,
  email: true,
  veiculoDefaultId: true,
  veiculoDefault: { select: { id: true, placa: true, modelo: true } },
  veiculos: {
    select: { veiculo: { select: { id: true, placa: true, modelo: true, ativo: true } } },
    orderBy: { veiculo: { placa: "asc" } },
  },
  ativo: true,
  ultimoLoginEm: true,
  criadoEm: true,
} as const;

@Injectable()
export class MotoristasService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.motorista.findMany({
      select: SAFE_SELECT,
      orderBy: { nome: "asc" },
    });
    return rows.map((m) => this.flatten(m));
  }

  async create(data: CriarMotoristaInput) {
    const exists = await this.prisma.motorista.findUnique({ where: { cpf: data.cpf } });
    if (exists) throw new ConflictException("CPF já cadastrado");
    const veiculoIds = data.veiculoIds ?? [];
    await this.ensureVeiculosExistem(veiculoIds);
    if (data.veiculoDefaultId && !veiculoIds.includes(data.veiculoDefaultId)) {
      throw new BadRequestException("Veículo padrão precisa estar na lista de placas vinculadas");
    }
    const senhaHash = await AuthService.hashPassword(data.senha);
    const created = await this.prisma.motorista.create({
      data: {
        nome: data.nome,
        cpf: data.cpf,
        senhaHash,
        telefone: data.telefone,
        email: data.email,
        veiculoDefaultId: data.veiculoDefaultId ?? null,
        veiculos: {
          create: veiculoIds.map((veiculoId) => ({ veiculoId })),
        },
      },
      select: SAFE_SELECT,
    });
    return this.flatten(created);
  }

  async update(id: string, data: AtualizarMotoristaInput) {
    const atual = await this.prisma.motorista.findUnique({
      where: { id },
      include: { veiculos: { select: { veiculoId: true } } },
    });
    if (!atual) throw new NotFoundException("Motorista não encontrado");

    const veiculoIdsAtuais = atual.veiculos.map((v) => v.veiculoId);
    const veiculoIdsNovos = data.veiculoIds ?? veiculoIdsAtuais;
    const removidos = veiculoIdsAtuais.filter((vid) => !veiculoIdsNovos.includes(vid));
    const adicionados = veiculoIdsNovos.filter((vid) => !veiculoIdsAtuais.includes(vid));

    if (adicionados.length > 0) await this.ensureVeiculosExistem(adicionados);

    // Determina o veiculoDefaultId final (depois das mudanças)
    let veiculoDefaultIdFinal: string | null | undefined = data.veiculoDefaultId;
    if (veiculoDefaultIdFinal === undefined) {
      veiculoDefaultIdFinal = atual.veiculoDefaultId; // sem mudança
    }
    if (veiculoDefaultIdFinal && !veiculoIdsNovos.includes(veiculoDefaultIdFinal)) {
      throw new BadRequestException("Veículo padrão precisa estar na lista de placas vinculadas");
    }

    // Invariante: cada veículo precisa ter ≥ 1 motorista. Antes de remover vínculos,
    // checar se algum desses veículos ficaria órfão.
    if (removidos.length > 0) {
      const orfaos = await this.verificaUltimoMotorista(id, removidos);
      if (orfaos.length > 0) {
        throw new ConflictException(
          `Não dá pra remover ${orfaos.join(", ")}: você é o único motorista vinculado. Atribua outro motorista antes ou exclua a placa.`,
        );
      }
    }

    const { novaSenha, veiculoIds: _vIds, veiculoDefaultId: _vd, ...rest } = data;
    const updateData: Record<string, unknown> = { ...rest };
    if (novaSenha) updateData.senhaHash = await AuthService.hashPassword(novaSenha);
    if (data.veiculoDefaultId !== undefined) updateData.veiculoDefaultId = data.veiculoDefaultId;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (removidos.length > 0) {
        await tx.motoristaVeiculo.deleteMany({
          where: { motoristaId: id, veiculoId: { in: removidos } },
        });
      }
      if (adicionados.length > 0) {
        await tx.motoristaVeiculo.createMany({
          data: adicionados.map((veiculoId) => ({ motoristaId: id, veiculoId })),
          skipDuplicates: true,
        });
      }
      return tx.motorista.update({ where: { id }, data: updateData, select: SAFE_SELECT });
    });
    return this.flatten(updated);
  }

  async remove(id: string) {
    const atual = await this.prisma.motorista.findUnique({
      where: { id },
      include: { veiculos: { select: { veiculoId: true } } },
    });
    if (!atual) throw new NotFoundException("Motorista não encontrado");

    const [viagens, pedagios, abastecimentos] = await Promise.all([
      this.prisma.viagem.count({ where: { motoristaId: id } }),
      this.prisma.pedagio.count({ where: { motoristaId: id } }),
      this.prisma.abastecimento.count({ where: { motoristaId: id } }),
    ]);
    const partes: string[] = [];
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "s"}`);
    if (pedagios > 0) partes.push(`${pedagios} pedágio${pedagios === 1 ? "" : "s"}`);
    if (abastecimentos > 0)
      partes.push(`${abastecimentos} abastecimento${abastecimentos === 1 ? "" : "s"}`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }

    const veiculoIds = atual.veiculos.map((v) => v.veiculoId);
    if (veiculoIds.length > 0) {
      const orfaos = await this.verificaUltimoMotorista(id, veiculoIds);
      if (orfaos.length > 0) {
        throw new ConflictException(
          `Não dá pra excluir: você é o único motorista das placas ${orfaos.join(", ")}. Atribua outro motorista antes.`,
        );
      }
    }

    await this.prisma.motorista.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Pra cada veiculoId, verifica se o motorista `motoristaId` é o único vinculado.
   * Retorna as PLACAS dos veículos que ficariam órfãos.
   */
  private async verificaUltimoMotorista(
    motoristaId: string,
    veiculoIds: string[],
  ): Promise<string[]> {
    if (veiculoIds.length === 0) return [];
    const vinculos = await this.prisma.motoristaVeiculo.groupBy({
      by: ["veiculoId"],
      where: { veiculoId: { in: veiculoIds } },
      _count: { motoristaId: true },
    });
    const veiculosOrfaosIds = vinculos
      .filter((v) => v._count.motoristaId === 1)
      .map((v) => v.veiculoId);
    if (veiculosOrfaosIds.length === 0) return [];
    // Pega só os que tem só esse motorista como vínculo
    const veiculos = await this.prisma.veiculo.findMany({
      where: {
        id: { in: veiculosOrfaosIds },
        motoristas: { every: { motoristaId } },
      },
      select: { placa: true },
    });
    return veiculos.map((v) => v.placa);
  }

  private async ensureVeiculosExistem(ids: string[]) {
    if (ids.length === 0) return;
    const count = await this.prisma.veiculo.count({ where: { id: { in: ids } } });
    if (count !== ids.length) {
      throw new NotFoundException("Um ou mais veículos não foram encontrados");
    }
  }

  private flatten<V>(m: { veiculos: { veiculo: V }[] } & Record<string, unknown>) {
    const { veiculos, ...rest } = m;
    return { ...rest, veiculos: veiculos.map((v) => v.veiculo) };
  }
}
