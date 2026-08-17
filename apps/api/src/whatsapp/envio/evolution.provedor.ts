import { Injectable } from "@nestjs/common";
import type { ProvedorWhatsapp } from "@ronan/shared-types";
import { EvolutionClientService } from "../evolution-client.service";
import type { EnvioWhatsapp, ProvedorWhatsappClient, ResultadoEnvio } from "./envio.types";

/**
 * O Evolution como provedor.
 *
 * Envolve o `EvolutionClientService` e **inverte o contrato de erro**: o client
 * lança, o provedor devolve `enviado: false`. Quem decide se isso vira 503 é a
 * fachada, não aqui — ver `envio.types.ts`.
 *
 * Não tem template: manda o `texto` que já vinha sendo montado. Os `params` do
 * envio são ignorados de propósito (são a segunda representação, pra Meta).
 */
@Injectable()
export class EvolutionProvedor implements ProvedorWhatsappClient {
  readonly nome: ProvedorWhatsapp = "evolution";

  constructor(private readonly client: EvolutionClientService) {}

  configurado(): boolean {
    return this.client.configurado;
  }

  async enviar(envio: EnvioWhatsapp): Promise<ResultadoEnvio> {
    // O `sendText` do Evolution aceita telefone e JID de grupo no mesmo campo.
    const alvo = envio.destino.tipo === "GRUPO" ? envio.destino.jid : envio.destino.numero;
    try {
      const idExterno = await this.client.enviarTextoRetornandoId(alvo, envio.texto);
      return { enviado: true, provedor: this.nome, idExterno };
    } catch (e) {
      return {
        enviado: false,
        provedor: this.nome,
        idExterno: null,
        erro: { codigo: "ENVIO_WHATSAPP_FALHOU", detalhe: (e as Error).message },
      };
    }
  }
}
