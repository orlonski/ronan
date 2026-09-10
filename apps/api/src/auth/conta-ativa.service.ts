import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { AcaoAuditoria } from "@prisma/client";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthAdminUser } from "./types";

/**
 * Entrar e sair de uma empresa, pra quem opera a plataforma.
 *
 * A escolha vira estado no banco (`User.contaAtivaId`) em vez de um claim no
 * token. É o que faz ela valer pra TODO canal de uma vez — o SSE do sininho, as
 * fotos que o `<img>` busca, os downloads de ZIP —, e não só pro que passa pelo
 * fetch do painel. O `JwtStrategy` relê a cada requisição, então sair, ser
 * despromovido ou a empresa ser desativada valem na hora, sem esperar token
 * expirar.
 */
@Injectable()
export class ContaAtivaService {
  private readonly log = new Logger(ContaAtivaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Entra numa empresa (`contaId`) ou volta pra casa (`null`).
   *
   * Pedir a própria empresa de origem é o mesmo que voltar pra casa — assim o
   * painel pode mandar o id que está na tela sem tratar o caso especial.
   */
  async definir(user: AuthAdminUser, contaId: string | null) {
    const voltandoPraCasa = contaId === null || contaId === user.contaOrigemId;

    if (voltandoPraCasa) {
      // Só audita se havia mesmo uma visita aberta — senão um F5 na tela
      // encheria o histórico da empresa de "saiu" sem "entrou".
      if (user.assumida) {
        await this.registrar(user, user.contaId, AcaoAuditoria.PLATAFORMA_SAIU_DA_CONTA);
      }
      await this.gravar(user.id, null);
      return { contaId: user.contaOrigemId, contaNome: user.contaOrigemNome, assumida: false };
    }

    // `Conta` é global (MODELS_GLOBAIS), então esta leitura não depende do
    // contexto — o que importa aqui, porque ele pode estar dentro de OUTRA
    // empresa no momento em que pede pra trocar.
    const alvo = await this.prisma.conta.findUnique({
      where: { id: contaId },
      select: { id: true, nome: true, ativa: true },
    });
    if (!alvo) throw new BadRequestException("Empresa não encontrada.");
    if (!alvo.ativa) throw new BadRequestException(`A empresa ${alvo.nome} está desativada.`);

    await this.gravar(user.id, alvo.id);
    await this.registrar(user, alvo.id, AcaoAuditoria.PLATAFORMA_ASSUMIU_CONTA);
    this.log.log(`${user.email} entrou na empresa "${alvo.nome}".`);

    return { contaId: alvo.id, contaNome: alvo.nome, assumida: true };
  }

  /**
   * A escrita roda em `comoSistema` porque o alvo é o PRÓPRIO usuário, que
   * pertence à conta de origem — e o contexto da requisição é a conta que ele
   * está visitando. Sem isso, a trava procuraria o usuário dentro da empresa
   * visitada e não acharia, travando quem já está dentro de uma.
   */
  private gravar(usuarioId: string, contaAtivaId: string | null) {
    return comoSistema(() =>
      this.prisma.user.update({ where: { id: usuarioId }, data: { contaAtivaId } }),
    );
  }

  /**
   * O registro é da EMPRESA VISITADA, não da casa: é o histórico dela que
   * precisa explicar por que aparecem ações assinadas por alguém de fora. Roda
   * dentro de `comConta` pra trava carimbar a conta certa.
   */
  private registrar(user: AuthAdminUser, contaId: string, acao: AcaoAuditoria) {
    return comConta(contaId, () =>
      this.auditoria.log({
        usuarioId: user.id,
        entidade: "Conta",
        entidadeId: contaId,
        acao,
        motivo: "Suporte da plataforma",
        metadata: { operador: user.email, contaDeOrigem: user.contaOrigemNome },
      }),
    );
  }
}
