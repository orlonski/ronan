import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
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
  ativo: true,
  ultimoLoginEm: true,
  criadoEm: true,
} as const;

@Injectable()
export class MotoristasService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.motorista.findMany({ select: SAFE_SELECT, orderBy: { nome: "asc" } });
  }

  async create(data: CriarMotoristaInput) {
    const exists = await this.prisma.motorista.findUnique({ where: { cpf: data.cpf } });
    if (exists) throw new ConflictException("CPF já cadastrado");
    if (data.veiculoDefaultId) await this.ensureVeiculo(data.veiculoDefaultId);
    const senhaHash = await AuthService.hashPassword(data.senha);
    return this.prisma.motorista.create({
      data: {
        nome: data.nome,
        cpf: data.cpf,
        senhaHash,
        telefone: data.telefone,
        email: data.email,
        veiculoDefaultId: data.veiculoDefaultId,
      },
      select: SAFE_SELECT,
    });
  }

  async update(id: string, data: AtualizarMotoristaInput) {
    await this.ensureExists(id);
    if (data.veiculoDefaultId) await this.ensureVeiculo(data.veiculoDefaultId);
    const { novaSenha, ...rest } = data;
    const update: Record<string, unknown> = { ...rest };
    if (novaSenha) update.senhaHash = await AuthService.hashPassword(novaSenha);
    return this.prisma.motorista.update({ where: { id }, data: update, select: SAFE_SELECT });
  }

  async remove(id: string) {
    await this.ensureExists(id);
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
    await this.prisma.motorista.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const m = await this.prisma.motorista.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    return m;
  }

  private async ensureVeiculo(id: string) {
    const v = await this.prisma.veiculo.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("Veículo não encontrado");
    return v;
  }
}
