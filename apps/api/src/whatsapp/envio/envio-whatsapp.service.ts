import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { custoEstimado, rotaWhatsapp, type ProvedorWhatsapp, type RotaWhatsapp } from "@ronan/shared-types";
import { contaAtual } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import { EvolutionProvedor } from "./evolution.provedor";
import { MetaProvedor } from "./meta.provedor";
import { RoteamentoWhatsappService } from "./roteamento.service";
import {
  ROTULO_PROVEDOR,
  type DestinoWhatsapp,
  type EnvioWhatsapp,
  type ProvedorWhatsappClient,
  type ResultadoEnvio,
} from "./envio.types";

const FALHA_CODIGO =
  "Não conseguimos enviar o código pelo WhatsApp agora. Tente de novo em alguns instantes.";
const FALHA_GENERICA =
  "Não conseguimos enviar a mensagem pelo WhatsApp agora. Tente de novo em alguns instantes.";

/**
 * A porta única de saída do WhatsApp.
 *
 * Todo envio do sistema passa por aqui, declarando QUE mensagem é (a `rota`).
 * É essa declaração que torna possível escolher o provedor por mensagem — antes
 * dela, os pontos de envio só se distinguiam pelo arquivo em que moravam.
 *
 * Dois métodos, e a escolha entre eles preserva os dois contratos de erro que o
 * sistema já tinha espalhados como try/catch presente-ou-ausente:
 *
 * - `enviarOuFalhar` lança 503 `ENVIO_WHATSAPP_FALHOU`. É pra quem NÃO pode
 *   dizer que enviou sem ter enviado: os códigos de cadastro e senha, o link do
 *   comprovante (que só marca `enviadoEm` depois) e o `oferecer_opcoes`.
 * - `tentarEnviar` devolve o resultado e nunca lança. É pra quem dispara em
 *   segundo plano e não pode derrubar o fluxo que chamou: resumos, aviso de
 *   peso, aviso de grupo, respostas do agente.
 */
@Injectable()
export class EnvioWhatsappService {
  private readonly log = new Logger("EnvioWhatsapp");

  constructor(
    private readonly evolution: EvolutionProvedor,
    private readonly meta: MetaProvedor,
    private readonly roteamento: RoteamentoWhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  /** Os provedores que existem de verdade neste processo. */
  private clienteDe(provedor: ProvedorWhatsapp): ProvedorWhatsappClient {
    return provedor === "meta" ? this.meta : this.evolution;
  }

  /**
   * Qual provedor entrega este envio. É o único ponto do sistema que lê a
   * configuração de roteamento — quem chama nunca escolhe provedor.
   */
  private async provedorDe(
    rota: RotaWhatsapp,
    destino?: DestinoWhatsapp,
  ): Promise<ProvedorWhatsappClient> {
    const { provedor } = await this.roteamento.resolver({
      rota,
      destinoEhGrupo: destino?.tipo === "GRUPO",
      telefone: destino?.tipo === "TELEFONE" ? destino.numero : undefined,
    });
    return this.clienteDe(provedor);
  }

  /** Se dá pra mandar esta rota agora, e o motivo quando não dá. */
  async disponivel(rota: RotaWhatsapp): Promise<{ ok: boolean; motivo?: string }> {
    const provedor = await this.provedorDe(rota);
    if (!provedor.configurado()) {
      return {
        ok: false,
        motivo: `WhatsApp (${ROTULO_PROVEDOR[provedor.nome]}) não está configurado no servidor.`,
      };
    }
    return { ok: true };
  }

  /**
   * Manda e lança 503 se não conseguir. A mensagem do erro combina com a
   * mensagem que falhou — rota crítica fala em "o código", o resto fala em "a
   * mensagem". (Antes toda falha dizia "o código", inclusive ao mandar link de
   * comprovante pro cliente, que não tem código nenhum.)
   */
  async enviarOuFalhar(envio: EnvioWhatsapp): Promise<ResultadoEnvio> {
    const r = await this.tentarEnviar(envio);
    if (!r.enviado) {
      throw new ServiceUnavailableException({
        code: "ENVIO_WHATSAPP_FALHOU",
        message: rotaWhatsapp(envio.rota)?.critica ? FALHA_CODIGO : FALHA_GENERICA,
      });
    }
    return r;
  }

  /** Manda e devolve o que aconteceu. Nunca lança. */
  async tentarEnviar(envio: EnvioWhatsapp): Promise<ResultadoEnvio> {
    const provedor = await this.provedorDe(envio.rota, envio.destino);
    let r: ResultadoEnvio;

    if (!provedor.configurado()) {
      r = {
        enviado: false,
        provedor: provedor.nome,
        idExterno: null,
        erro: {
          codigo: "PROVEDOR_NAO_CONFIGURADO",
          detalhe: `${ROTULO_PROVEDOR[provedor.nome]} não está configurado no servidor.`,
        },
      };
      this.log.warn(`envio ${envio.rota} não saiu: ${r.erro!.detalhe}`);
    } else {
      r = await provedor.enviar(envio);
      if (!r.enviado) {
        this.log.error(`envio ${envio.rota} por ${provedor.nome} falhou: ${r.erro?.detalhe}`);
      }
    }

    // Grava mesmo quando não saiu: o histórico do agente é montado a partir
    // destas linhas, e uma resposta que falhou precisa aparecer no contexto.
    await this.registrar(envio, r);
    return r;
  }

  /**
   * Deixa o rastro da mensagem: por onde saiu, qual era, quanto custou.
   *
   * Antes disto, os envios do sistema não gravavam nada — só o inbound e as
   * respostas do agente apareciam no histórico. Não dava pra responder "o resumo
   * saiu ontem?" nem "quanto o código de cadastro custou este mês".
   *
   * **Nunca pode fazer o envio falhar.** A mensagem já foi entregue quando isto
   * roda; um erro de INSERT aqui não pode virar 503 pro motorista que está
   * esperando o código. Daí o try/catch engolindo tudo, com o log como rede.
   */
  private async registrar(envio: EnvioWhatsapp, r: ResultadoEnvio): Promise<void> {
    // Sem conta no contexto não há onde gravar: a tabela é escopada e a linha
    // morreria na chave estrangeira. É o caso do código de redefinição de senha,
    // que roda em `comoSistema`. Perder o registro é melhor que perder o envio.
    if (!contaAtual()?.contaId) return;

    const def = rotaWhatsapp(envio.rota);
    const categoria = r.provedor === "meta" ? (def?.categoria ?? null) : null;
    try {
      await this.prisma.whatsappMensagem.create({
        data: {
          sessaoId: envio.sessaoId ?? null,
          telefone:
            envio.destino.tipo === "GRUPO" ? envio.destino.jid : envio.destino.numero,
          direcao: "SAIDA",
          conteudo: envio.texto,
          tipo: "TEXTO",
          provedor: r.provedor,
          idExterno: r.idExterno,
          rota: envio.rota,
          categoria,
          custoEstimado: custoEstimado(r.provedor, def?.categoria),
          metadata: r.enviado ? undefined : { erro: r.erro?.detalhe ?? null },
        },
      });
    } catch (e) {
      this.log.warn(`não deu pra registrar o envio ${envio.rota}: ${(e as Error).message}`);
    }
  }
}
