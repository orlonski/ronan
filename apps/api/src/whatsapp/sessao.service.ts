import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type SessaoResolvida =
  | { tipo: "MOTORISTA"; sessaoId: string; motoristaId: string; nome: string }
  | { tipo: "ADMIN"; sessaoId: string; userId: string; nome: string }
  | { tipo: "DESCONHECIDO"; sessaoId: null };

/**
 * Resolve "quem é esse telefone" em uma identidade do sistema. Toda vez que
 * o webhook recebe mensagem, chama isso pra saber se rotear pro toolset de
 * motorista, admin, ou pro fluxo inicial de vinculação.
 */
@Injectable()
export class SessaoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normaliza telefone pra formato `5541999999999` (só dígitos, com DDI 55).
   * Aceita entradas variadas do Evolution: "5541...@s.whatsapp.net", "+55 41 ...".
   */
  static normalizar(telefone: string): string {
    let d = telefone.replace(/\D/g, "");
    if (d.length === 11 || d.length === 10) {
      // sem DDI; assume Brasil
      d = `55${d}`;
    }
    return d;
  }

  async resolverPorTelefone(telefoneRaw: string): Promise<SessaoResolvida> {
    const telefone = SessaoService.normalizar(telefoneRaw);
    const sessao = await this.prisma.whatsappSessao.findUnique({
      where: { telefone },
      include: {
        motorista: { select: { id: true, nome: true, ativo: true } },
        user: { select: { id: true, nome: true, ativo: true } },
      },
    });
    if (!sessao) return { tipo: "DESCONHECIDO", sessaoId: null };

    if (sessao.motorista && sessao.motorista.ativo) {
      return {
        tipo: "MOTORISTA",
        sessaoId: sessao.id,
        motoristaId: sessao.motorista.id,
        nome: sessao.motorista.nome,
      };
    }
    if (sessao.user && sessao.user.ativo) {
      return {
        tipo: "ADMIN",
        sessaoId: sessao.id,
        userId: sessao.user.id,
        nome: sessao.user.nome,
      };
    }
    // Sessão existe mas relação foi inativada — trata como desconhecido.
    return { tipo: "DESCONHECIDO", sessaoId: null };
  }

  async marcarMensagemRecebida(sessaoId: string): Promise<void> {
    await this.prisma.whatsappSessao.update({
      where: { id: sessaoId },
      data: { ultimaMensagem: new Date() },
    });
  }

  async desvincular(sessaoId: string): Promise<void> {
    await this.prisma.whatsappSessao.delete({ where: { id: sessaoId } });
  }

  async listar() {
    return this.prisma.whatsappSessao.findMany({
      include: {
        motorista: { select: { id: true, nome: true, cpf: true } },
        user: { select: { id: true, nome: true, email: true } },
      },
      orderBy: { vinculadoEm: "desc" },
    });
  }
}
