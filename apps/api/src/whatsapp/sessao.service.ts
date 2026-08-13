import { Injectable } from "@nestjs/common";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";

export type SessaoResolvida =
  | { tipo: "MOTORISTA"; sessaoId: string; motoristaId: string; nome: string; contaId: string }
  | { tipo: "ADMIN"; sessaoId: string; userId: string; nome: string; contaId: string }
  | { tipo: "DESCONHECIDO"; sessaoId: null; contaId: null };

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

  /**
   * Quem é este telefone — e de qual empresa.
   *
   * Roda `comoSistema` porque é a mesma situação do login: a consulta que
   * DESCOBRE a conta não pode depender dela. O telefone é único por conta, então
   * o motorista que roda pra duas empresas pode ter duas sessões com o mesmo
   * número; nesse caso vale a empresa que está com o aparelho (a que ele
   * escolheu no app), pra mensagem não chegar em nome de quem ele não está
   * rodando agora. Empate resolve pelo vínculo mais recente.
   *
   * Quem chamar precisa abrir `comConta(resolvida.contaId)` antes de tocar em
   * qualquer dado — daqui pra frente tudo é dado de empresa.
   */
  async resolverPorTelefone(telefoneRaw: string): Promise<SessaoResolvida> {
    const telefone = SessaoService.normalizar(telefoneRaw);
    const sessoes = await comoSistema(() =>
      this.prisma.whatsappSessao.findMany({
        where: { telefone },
        include: {
          motorista: {
            select: { id: true, nome: true, ativo: true, expoPushToken: true, ultimoLoginEm: true },
          },
          user: { select: { id: true, nome: true, ativo: true } },
        },
        orderBy: { vinculadoEm: "desc" },
      }),
    );
    const validas = sessoes.filter(
      (s) => (s.motorista && s.motorista.ativo) || (s.user && s.user.ativo),
    );
    if (validas.length === 0) return { tipo: "DESCONHECIDO", sessaoId: null, contaId: null };

    // Com o aparelho = com o push token. É o mesmo sinal que o app grava ao
    // trocar de empresa, então as duas pontas concordam sem campo novo.
    const comAparelho = validas.filter((s) => s.motorista?.expoPushToken);
    const sessao = (comAparelho.length > 0 ? comAparelho : validas).sort(
      (a, b) =>
        (b.motorista?.ultimoLoginEm?.getTime() ?? 0) - (a.motorista?.ultimoLoginEm?.getTime() ?? 0),
    )[0]!;

    if (sessao.motorista && sessao.motorista.ativo) {
      return {
        tipo: "MOTORISTA",
        sessaoId: sessao.id,
        motoristaId: sessao.motorista.id,
        nome: sessao.motorista.nome,
        contaId: sessao.contaId,
      };
    }
    return {
      tipo: "ADMIN",
      sessaoId: sessao.id,
      userId: sessao.user!.id,
      nome: sessao.user!.nome,
      contaId: sessao.contaId,
    };
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
