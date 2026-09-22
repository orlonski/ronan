import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { comConta, comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminInboxService } from "../inbox/inbox.service";

/**
 * Número comercial da Movatruck. Env primeiro para não exigir deploy quando o
 * número mudar; o literal é só o valor conhecido hoje, o mesmo que o site usa.
 */
const WHATSAPP_PADRAO = "5542991563750";

@Injectable()
export class OnboardingService {
  private readonly log = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: AdminInboxService,
    private readonly config: ConfigService,
  ) {}

  /**
   * "Quero continuar" — o caminho de volta de quem chegou ao fim do teste.
   *
   * Não abre checkout de propósito: com o ticket que a Movatruck cobra, quem
   * fecha é conversa, e tirar o vendedor do meio é perder dinheiro, não ganhar
   * tempo. O que este método faz é juntar as duas pontas — avisa a casa com o
   * que ela precisa pra ligar sabendo de tudo, e devolve ao cliente o WhatsApp
   * já com o recado escrito.
   *
   * O aviso vai pro sininho da CASA, nunca pro da empresa: `disparar()` faz
   * fan-out no contexto de conta corrente, então sem o `comConta` da plataforma
   * quem receberia "esta empresa quer assinar" seria a própria empresa.
   */
  async quereroContinuar(usuarioNome: string): Promise<{ whatsappUrl: string }> {
    const contaId = contaIdAtual();

    const [conta, viagens] = await Promise.all([
      comoSistema(() =>
        this.prisma.conta.findUnique({
          where: { id: contaId },
          select: { nome: true, trialExpiraEm: true, somenteLeitura: true },
        }),
      ),
      this.prisma.viagem.count(),
    ]);

    const nomeEmpresa = conta?.nome ?? "Empresa";

    // Best-effort: o cliente não pode ficar sem o link porque o sininho falhou.
    void this.avisarCasa(nomeEmpresa, usuarioNome, viagens).catch((e: unknown) =>
      this.log.warn(`Aviso de "quero continuar" falhou: ${String(e)}`),
    );

    const numero = (this.config.get<string>("PLATAFORMA_WHATSAPP") ?? WHATSAPP_PADRAO).replace(
      /\D/g,
      "",
    );
    const recado = encodeURIComponent(
      `Oi! Sou da ${nomeEmpresa} e quero continuar usando o Movatruck depois do teste.`,
    );
    return { whatsappUrl: `https://wa.me/${numero}?text=${recado}` };
  }

  private async avisarCasa(empresa: string, quem: string, viagens: number): Promise<void> {
    const casa = await comoSistema(() =>
      this.prisma.conta.findFirst({ where: { ehPlataforma: true }, select: { id: true } }),
    );
    if (!casa) return;

    await comConta(casa.id, () =>
      this.inbox.disparar({
        tipo: "onboarding-quer-continuar",
        titulo: `${empresa} quer continuar depois do teste`,
        // O número de viagens é o que diz se a conversa é "fechar" ou "resgatar":
        // quem já lançou centenas está comprando; quem tem zero precisa de ajuda
        // antes de precisar de boleto.
        corpo: `${quem} pediu contato · ${viagens} viagem(ns) lançada(s)`,
        permissao: "diagnosticos.ver",
      }),
    );
  }
}
