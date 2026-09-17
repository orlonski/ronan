import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { comoSistema } from "../common/conta/conta-context";
import { ChatwootClientService } from "../chatwoot/chatwoot-client.service";
import { telefoneDiscavel } from "@ronan/shared-types";
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

  /**
   * Sobe pro Chatwoot os leads que têm telefone.
   *
   * Até aqui o contato só nascia quando a pessoa escrevia — quem a gente ainda
   * não abordou não existia no atendimento, e não dava pra começar uma
   * conversa de lá. Depois disto a base de captação e a lista de contatos são
   * a mesma coisa.
   *
   * **Quem pediu pra não ser contatado fica de fora.** Não é detalhe de
   * implementação: contato no Chatwoot é uma pessoa a um clique de receber
   * mensagem, e a lista de quem não pode receber nada é exatamente a que não
   * pode estar lá.
   *
   * Vai um de cada vez de propósito. São dezenas, não milhares, e o Chatwoot é
   * nosso — derrubar o atendimento pra ganhar dez segundos seria mau negócio.
   */
  async sincronizarContatos(limite = 500): Promise<{
    candidatos: number;
    criados: number;
    jaTinham: number;
    falhas: number;
    fixos: number;
    invalidos: number;
  }> {
    const { contaId, inboxId } = await this.ondeFalar();

    const { leads, jaTinham } = await comoSistema(async () => ({
      leads: await this.prisma.lead.findMany({
        where: { telefone: { not: null }, optOut: false, chatwootContatoId: null },
        select: { id: true, empresa: true, nome: true, telefone: true },
        orderBy: { score: "desc" },
        take: limite,
      }),
      jaTinham: await this.prisma.lead.count({ where: { chatwootContatoId: { not: null } } }),
    }));

    let criados = 0;
    let falhas = 0;
    let fixos = 0;
    let invalidos = 0;

    for (const lead of leads) {
      const numero = telefoneDiscavel(lead.telefone ?? "");
      if (!numero) {
        invalidos++;
        continue;
      }
      if (numero.length === 10) fixos++;

      const contato = await this.chatwoot.garantirContato(contaId, inboxId, {
        nome: this.nomeDoContato(lead),
        telefoneE164: `+55${numero}`,
      });
      if (!contato) {
        falhas++;
        continue;
      }

      await comoSistema(async () => {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { chatwootContaId: contaId, chatwootContatoId: contato.contatoId },
        });
      });
      criados++;

      // A ficha vai junto: contato sem CNPJ, cidade e nota é um telefone com
      // nome, que é exatamente o que já existia antes disto.
      await this.enviarFicha(lead.id);
    }

    this.log.log(
      `Contatos no Chatwoot: ${criados} de ${leads.length} ` +
        `(${falhas} falha(s), ${invalidos} telefone(s) impossível(is), ${fixos} fixo(s)).`,
    );
    return { candidatos: leads.length, criados, jaTinham, falhas, fixos, invalidos };
  }

  /**
   * Prepara a conversa com esse lead e devolve o endereço dela.
   *
   * **Não manda mensagem.** Fora da janela de 24h a Meta só aceita template
   * aprovado, e mesmo dentro dela quem escolhe a primeira palavra pra um lead
   * frio é uma pessoa. O que isto faz é tirar do caminho os três passos chatos
   * — achar o contato, criar a conversa, achar a conversa — e abrir a tela
   * certa com o histórico do lead já do lado.
   */
  async abrirConversa(leadId: string): Promise<{ url: string; conversaId: number }> {
    const { contaId, inboxId } = await this.ondeFalar();

    const lead = await comoSistema(async () =>
      this.prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          empresa: true,
          nome: true,
          telefone: true,
          optOut: true,
          chatwootContaId: true,
          chatwootConversaId: true,
        },
      }),
    );
    if (!lead) throw new Error("Lead não encontrado.");
    if (lead.optOut) {
      throw new Error("Essa empresa pediu pra não ser contatada. A conversa não pode ser aberta.");
    }

    // Conversa que já existe é a mesma conversa. Abrir outra quebraria o
    // histórico em duas e faria o atendente responder na metade errada.
    const jaTem = this.chatwoot.linkDaConversa(lead.chatwootContaId, lead.chatwootConversaId);
    if (jaTem && lead.chatwootConversaId) {
      return { url: jaTem, conversaId: lead.chatwootConversaId };
    }

    const numero = telefoneDiscavel(lead.telefone ?? "");
    if (!numero) {
      throw new Error("O telefone desse lead não parece um número de verdade.");
    }

    const contato = await this.chatwoot.garantirContato(contaId, inboxId, {
      nome: this.nomeDoContato(lead),
      telefoneE164: `+55${numero}`,
    });
    if (!contato?.sourceId) {
      throw new Error("O Chatwoot não devolveu o contato. Veja o log da API.");
    }

    const conversaId = await this.chatwoot.criarConversa(
      contaId,
      inboxId,
      contato.contatoId,
      contato.sourceId,
    );
    if (!conversaId) throw new Error("O Chatwoot não criou a conversa. Veja o log da API.");

    await comoSistema(async () => {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          chatwootContaId: contaId,
          chatwootContatoId: contato.contatoId,
          chatwootConversaId: conversaId,
        },
      });
    });
    await this.enviarFicha(leadId);

    const url = this.chatwoot.linkDaConversa(contaId, conversaId);
    if (!url) throw new Error("Conversa criada, mas sem CHATWOOT_URL pra montar o endereço.");
    return { url, conversaId };
  }

  /**
   * A conta e o inbox por onde falar — ou o motivo de não dar.
   *
   * A mensagem de erro é pra tela: quem clicou no botão precisa saber o que
   * configurar, não descobrir num log que a chamada não saiu.
   */
  private async ondeFalar(): Promise<{ contaId: number; inboxId: number }> {
    if (!this.chatwoot.configurado()) {
      throw new Error("Chatwoot não configurado: faltam CHATWOOT_URL e CHATWOOT_API_TOKEN.");
    }
    const contaId = await this.chatwoot.contaPadrao();
    if (!contaId) {
      throw new Error("Não consegui descobrir a conta do Chatwoot. Confira o CHATWOOT_API_TOKEN.");
    }
    const inboxId = await this.chatwoot.inboxPadrao(contaId);
    if (!inboxId) {
      throw new Error(
        "Não sei por qual canal de WhatsApp falar. Defina CHATWOOT_INBOX_COMERCIAL com o id do inbox comercial.",
      );
    }
    return { contaId, inboxId };
  }

  /**
   * Como o contato aparece na lista do Chatwoot.
   *
   * A EMPRESA na frente, não a pessoa: quem atende reconhece "Transportes
   * Aurora" e não "Maria Silva", e a busca do Chatwoot é por esse campo.
   */
  private nomeDoContato(lead: { empresa: string; nome: string | null }): string {
    const empresa = empresaConhecida(lead.empresa);
    if (empresa && lead.nome) return `${empresa} — ${lead.nome}`;
    return empresa ?? lead.nome ?? "Contato";
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
