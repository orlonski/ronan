import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { rotaWhatsapp, type ProvedorWhatsapp, type RotaWhatsapp } from "@ronan/shared-types";
import { EvolutionProvedor } from "./evolution.provedor";
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
    private readonly roteamento: RoteamentoWhatsappService,
  ) {}

  /**
   * Os provedores que existem de verdade neste processo.
   *
   * A Meta ainda não tem implementação. Uma rota configurada pra ela cai no
   * Evolution com um aviso — o que é o comportamento certo: config apontando
   * pra um provedor que ainda não existe não pode deixar de mandar a mensagem.
   */
  private clienteDe(provedor: ProvedorWhatsapp): ProvedorWhatsappClient {
    if (provedor === "evolution") return this.evolution;
    this.log.warn(`provedor "${provedor}" ainda não implementado — indo pelo Evolution`);
    return this.evolution;
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

    if (!provedor.configurado()) {
      return {
        enviado: false,
        provedor: provedor.nome,
        idExterno: null,
        erro: {
          codigo: "PROVEDOR_NAO_CONFIGURADO",
          detalhe: `${ROTULO_PROVEDOR[provedor.nome]} não está configurado no servidor.`,
        },
      };
    }

    const r = await provedor.enviar(envio);
    if (!r.enviado) {
      this.log.error(`envio ${envio.rota} por ${provedor.nome} falhou: ${r.erro?.detalhe}`);
    }
    return r;
  }
}
