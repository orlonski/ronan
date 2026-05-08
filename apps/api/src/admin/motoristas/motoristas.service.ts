import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CriarMotoristaInput, AtualizarMotoristaInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";

const SAFE_SELECT = {
  id: true,
  nome: true,
  cpf: true,
  telefone: true,
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
    return this.prisma.motorista.update({
      where: { id },
      data: { ativo: false },
      select: SAFE_SELECT,
    });
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
