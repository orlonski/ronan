import { Injectable, Logger } from "@nestjs/common";
import { achatarParam } from "@ronan/shared-types";
import {
  formatarData,
  formatarReais,
  hojeData,
  mensagemAutorizacao,
  mensagemCobrancaAberta,
  rotuloCompetencia,
} from "../common/assinatura-cobranca";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";

/**
 * O aviso avulso: manda pro cliente, agora, o que ele precisa pra pagar.
 *
 * Vive separado da régua de propósito, e não por organização: a régua depende
 * do `AssinaturasService` (pra reavaliar inadimplência) e o `AssinaturasService`
 * precisa avisar o cliente ao criar a assinatura. Os dois juntos fechariam um
 * ciclo que derruba o boot do Nest. Este serviço não depende de nenhum dos
 * dois — só de banco e do canal de WhatsApp.
 */
@Injectable()
export class AvisoCobrancaService {
  private readonly log = new Logger(AvisoCobrancaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
  ) {}

  /**
   * Manda pro financeiro o que ele precisa pra pagar AGORA.
   *
   * Serve a dois momentos que antes não tinham voz:
   *
   * - **assinatura recém-criada** — o cliente recebe o código de autorização
   *   sem esperar a régua acordar 3 dias antes do vencimento. Era o silêncio
   *   entre "fechei o contrato" e "como eu pago?", e é nele que uma assinatura
   *   fica parada para sempre.
   * - **botão "mandar no WhatsApp"** — pro dia em que o cliente disse que não
   *   recebeu, ou apagou, ou mandou pro financeiro errado.
   *
   * Não grava data de aviso: isto não é a régua, é um envio avulso a pedido.
   * Misturar os dois faria um reenvio manual "consumir" o aviso automático do
   * dia e o cliente ficaria sem o lembrete que ia receber.
   */
  async avisarAgora(assinaturaId: string): Promise<{ enviado: boolean; motivo?: string }> {
    const assinatura = await comoSistema(() =>
      this.prisma.assinatura.findFirst({
        where: { id: assinaturaId },
        include: {
          conta: { select: { nome: true } },
          cobrancas: {
            where: { status: { in: ["PENDENTE", "VENCIDA"] } },
            orderBy: { vencimento: "asc" },
            take: 1,
          },
        },
      }),
    );
    if (!assinatura) return { enviado: false, motivo: "Assinatura não encontrada." };
    if (assinatura.status === "CANCELADA") {
      return { enviado: false, motivo: "Esta assinatura está cancelada." };
    }

    const emAberto = assinatura.cobrancas[0];
    const esperandoAutorizacao = assinatura.status === "AGUARDANDO";

    // O que mandar depende do momento: quem ainda não autorizou recebe o
    // convite; quem já autorizou recebe a fatura em aberto.
    const codigo = esperandoAutorizacao
      ? (assinatura.qrCodePayload ?? emAberto?.linkPagamento ?? null)
      : (emAberto?.linkPagamento ?? null);

    if (!codigo) {
      return {
        enviado: false,
        motivo: esperandoAutorizacao
          ? "A assinatura ainda não tem código de pagamento — o gateway não devolveu."
          : "Não há cobrança em aberto pra mandar.",
      };
    }

    const valor = formatarReais(assinatura.valorCentavos);
    const vencimento = formatarData(emAberto?.vencimento ?? assinatura.proximoVencimento ?? hojeData());

    const { texto, params } = esperandoAutorizacao
      ? mensagemAutorizacao({
          nomeResponsavel: achatarParam(assinatura.nomeResponsavel),
          valor,
          vencimento,
          codigo,
          ehPix: assinatura.forma === "PIX_AUTOMATICO",
        })
      : mensagemCobrancaAberta({
          nomeResponsavel: achatarParam(assinatura.nomeResponsavel),
          competenciaRotulo: rotuloCompetencia(emAberto!.competencia),
          valor: formatarReais(emAberto!.valorCentavos),
          vencimento,
          link: codigo,
        });

    const r = await this.envio.tentarEnviar({
      destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(assinatura.telefoneCobranca) },
      rota: esperandoAutorizacao ? "COBRANCA_AUTORIZACAO" : "COBRANCA_ABERTA",
      texto,
      params: params.map(achatarParam),
    });

    if (!r.enviado) {
      this.log.warn(`Aviso avulso de ${assinatura.conta.nome} não saiu: ${r.erro?.detalhe}`);
      return { enviado: false, motivo: r.erro?.detalhe ?? "O WhatsApp recusou o envio." };
    }

    this.log.log(`Aviso avulso enviado pra ${assinatura.conta.nome}.`);
    return { enviado: true };
  }
}
