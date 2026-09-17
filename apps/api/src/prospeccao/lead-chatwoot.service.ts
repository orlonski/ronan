import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { comoSistema } from "../common/conta/conta-context";
import { ChatwootClientService } from "../chatwoot/chatwoot-client.service";
import { empresaConhecida } from "../sdr/lead-inbound";

/**
 * A ponte entre a ficha do lead e a conversa no Chatwoot.
 *
 * O caminho de ida já existia — quem escreve no WhatsApp vira lead e o toque
 * fica no histórico. O que faltava era o de volta: quem atende via um número
 * sem nome, e quem vende via um CNPJ sem conversa. São a mesma pessoa em duas
 * telas, e ninguém tinha como saber disso.
 *
 * **Nada aqui pode derrubar quem chamou.** O webhook do Chatwoot precisa
 * responder 200 e a tela do painel precisa salvar; falhar em enfeitar o
 * contato é irrelevante perto disso. Todo método engole o erro e loga.
 */

/** O que uma ficha completa manda pro Chatwoot. Mantido curto de propósito. */
const SITUACAO: Record<string, string> = {
  NOVO: "Novo",
  EM_CONTATO: "Em contato",
  QUALIFICADO: "Qualificado",
  PROPOSTA: "Proposta enviada",
  GANHOU: "Fechou",
  PERDEU: "Perdeu",
};

@Injectable()
export class LeadChatwootService {
  private readonly log = new Logger("LeadChatwoot");

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatwoot: ChatwootClientService,
  ) {}

  /**
   * Guarda onde esse lead conversa e manda a ficha pro atendimento.
   *
   * Chamado pelo webhook a cada mensagem que entra: a conversa muda (o
   * Chatwoot abre uma nova quando a anterior é resolvida) e a ficha engorda
   * conforme o SDR descobre empresa, frota e dor. Reescrever sempre é mais
   * barato que decidir quando vale a pena.
   */
  async vincular(
    leadId: string,
    ids: { contaId: number; contatoId: number | null; conversaId: number },
  ): Promise<void> {
    try {
      await comoSistema(async () => {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: {
            chatwootContaId: ids.contaId,
            chatwootConversaId: ids.conversaId,
            // Só sobrescreve se veio: o payload do Chatwoot nem sempre traz o
            // contato, e apagar o id que já estava lá quebraria o envio da
            // ficha pra sempre nessa conversa.
            ...(ids.contatoId ? { chatwootContatoId: ids.contatoId } : {}),
          },
        });
      });
      await this.enviarFicha(leadId);
    } catch (e) {
      this.log.warn(`não consegui vincular o lead ${leadId} ao Chatwoot: ${(e as Error).message}`);
    }
  }

  /**
   * Reempurra a ficha depois de uma mudança no painel.
   *
   * Vale a pena porque a situação no funil é o que o atendente mais precisa
   * saber antes de responder: "proposta enviada" muda o tom da conversa
   * inteira, e até aqui essa informação só existia no nosso lado.
   *
   * Lead que nunca escreveu no WhatsApp não tem contato no Chatwoot — sai sem
   * fazer nada, que é o caso da esmagadora maioria da base.
   */
  async sincronizar(leadId: string): Promise<void> {
    try {
      await this.enviarFicha(leadId);
    } catch (e) {
      this.log.warn(`não consegui sincronizar o lead ${leadId}: ${(e as Error).message}`);
    }
  }

  /** O link que abre a conversa, pra ficha do painel. `null` quando não há. */
  linkDaConversa(lead: {
    chatwootContaId: number | null;
    chatwootConversaId: number | null;
  }): string | null {
    return this.chatwoot.linkDaConversa(lead.chatwootContaId, lead.chatwootConversaId);
  }

  private async enviarFicha(leadId: string): Promise<void> {
    if (!this.chatwoot.configurado()) return;

    const lead = await comoSistema(async () =>
      this.prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          empresa: true,
          nomeFantasia: true,
          cnpj: true,
          rntrc: true,
          municipio: true,
          uf: true,
          socio: true,
          porte: true,
          frotaQtd: true,
          score: true,
          status: true,
          optOut: true,
          origem: true,
          chatwootContaId: true,
          chatwootContatoId: true,
        },
      }),
    );
    if (!lead?.chatwootContaId || !lead.chatwootContatoId) return;

    const cidade = lead.municipio ? `${lead.municipio}${lead.uf ? `/${lead.uf}` : ""}` : undefined;

    await this.chatwoot.atualizarContato(lead.chatwootContaId, lead.chatwootContatoId, {
      // Campos que o Chatwoot já sabe desenhar sozinho, sem configuração.
      additional_attributes: {
        ...(empresaConhecida(lead.empresa) ? { company_name: lead.empresa } : {}),
        ...(cidade ? { city: cidade } : {}),
        description: this.resumoDaFicha(lead),
      },
      // Nossos. Só aparecem na tela depois de criados em Configurações →
      // Atributos personalizados, com estas chaves.
      custom_attributes: {
        cnpj: lead.cnpj ?? "",
        rntrc: lead.rntrc ?? "",
        situacao_funil: SITUACAO[lead.status] ?? lead.status,
        nota_lead: lead.score ?? "",
        // O opt-out é o mais importante da lista: quem pediu pra não ser
        // contatado não pode receber campanha nenhuma, e o atendimento é
        // justamente quem tem o dedo no gatilho de mandar mensagem.
        nao_contatar: lead.optOut ? "SIM" : "",
      },
    });
  }

  // O nome da empresa passa por `empresaConhecida`: "Contato pelo WhatsApp" é
  // carimbo de empresa que ninguém descobriu ainda, e mandar isso como
  // `company_name` faria o atendente ler um rótulo interno achando que é o
  // cliente.

  /** Uma linha pro atendente ler antes de responder. */
  private resumoDaFicha(lead: {
    socio: string | null;
    porte: string | null;
    frotaQtd: number | null;
    origem: string;
  }): string {
    const partes = [
      lead.socio ? `Sócio: ${lead.socio}` : null,
      lead.porte ? lead.porte.toLowerCase() : null,
      lead.frotaQtd ? `${lead.frotaQtd} veículo(s) no RNTRC` : null,
      `origem: ${lead.origem}`,
    ].filter(Boolean);
    return partes.join(" · ");
  }
}
