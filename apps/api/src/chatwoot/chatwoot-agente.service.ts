import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { AgenteService } from "../whatsapp/agente/agente.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { ConviteService } from "../whatsapp/convite.service";
import { ChatwootClientService } from "./chatwoot-client.service";

/**
 * O agente que atende dentro do Chatwoot.
 *
 * **Quem escreve decide o que o agente pode fazer.** Telefone que bate com um
 * motorista aprovado ganha o agente com ferramentas do sistema; qualquer outro
 * número cai direto na fila humana, sem ferramenta nenhuma. A fronteira é de
 * segurança, não de organização: um agente único com todas as ferramentas
 * responderia "sua viagem de ontem foi pra Ponta Grossa" pra quem digitasse um
 * número por sorte.
 *
 * Nada aqui manda mensagem pelo `EnvioWhatsappService`: quem fala com o
 * WhatsApp é o Chatwoot, dono do canal. Responder pelos dois caminhos entregaria
 * a mesma frase duas vezes ao motorista, e uma delas fora da conversa.
 */

/** Resposta pra número que o sistema não conhece. Curta e sem promessa. */
const TEXTO_DESCONHECIDO =
  "Oi! Aqui é a Movatruck. Recebi sua mensagem e já chamei alguém da equipe pra te responder.";

type EventoChatwoot = {
  event?: string;
  message_type?: string;
  content?: string;
  conversation?: { id?: number; status?: string };
  account?: { id?: number };
  sender?: { phone_number?: string; identifier?: string; name?: string };
  inbox?: { id?: number; name?: string };
};

@Injectable()
export class ChatwootAgenteService {
  private readonly log = new Logger("ChatwootAgente");

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessao: SessaoService,
    private readonly agente: AgenteService,
    private readonly convite: ConviteService,
    private readonly chatwoot: ChatwootClientService,
  ) {}

  /**
   * Nunca lança: quem chama já respondeu 200 pro Chatwoot. Erro aqui vira log,
   * não vira reenvio — o Chatwoot repete o webhook que falha, e repetir
   * significa o motorista recebendo a mesma resposta de novo.
   */
  async processar(evento: EventoChatwoot): Promise<void> {
    try {
      await this.tratar(evento);
    } catch (e) {
      this.log.error(`falha ao processar evento: ${(e as Error).message}`);
    }
  }

  private async tratar(evento: EventoChatwoot): Promise<void> {
    // Só mensagem que ENTROU. `outgoing` é o que nós mesmos acabamos de
    // mandar — tratar isso seria o robô conversando consigo mesmo em loop.
    if (evento.event !== "message_created" || evento.message_type !== "incoming") return;

    const texto = (evento.content ?? "").trim();
    const conversaId = evento.conversation?.id;
    const contaChatwoot = evento.account?.id;
    const telefone = evento.sender?.phone_number ?? evento.sender?.identifier ?? "";

    if (!conversaId || !contaChatwoot) {
      this.log.warn("evento sem conversa ou conta — ignorado");
      return;
    }

    // Áudio e foto ainda não passam por aqui. Fingir que entendeu seria pior
    // que entregar pra uma pessoa que entende.
    if (!texto) {
      await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
      return;
    }

    const identidade = telefone
      ? await this.sessao.resolverPorTelefone(telefone)
      : ({ tipo: "DESCONHECIDO", sessaoId: null, contaId: null } as const);

    if (identidade.tipo === "DESCONHECIDO") {
      // Antes de entregar pra uma pessoa: pode ser alguém se vinculando. É por
      // aqui que um motorista entra no canal pela primeira vez — sem isto o
      // código de convite morreria na fila humana e ninguém novo se vincularia.
      if (await this.tentarVincular(texto, telefone, contaChatwoot, conversaId)) return;

      // Pode ser um PROSPECT: alguém que a prospecção já conhece, ou que viu o
      // site. Registrar no funil antes de mandar pra fila humana é o que evita
      // a conversa sumir — até aqui ela virava ticket no atendimento e o lado
      // comercial nunca ficava sabendo que a empresa tinha procurado a gente.
      await this.registrarNoFunil(telefone, texto);

      this.log.log(`número não reconhecido — conversa ${conversaId} vai pra fila humana`);
      await this.chatwoot.responder(contaChatwoot, conversaId, TEXTO_DESCONHECIDO);
      await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
      return;
    }

    // O `resolverPorTelefone` confere `ativo`, não `status`. Aqui é endpoint
    // sem guard nenhum, então a aprovação se confere na mão — cadastro em
    // análise não conversa com o agente.
    if (identidade.tipo === "MOTORISTA" && !(await this.aprovado(identidade.motoristaId))) {
      this.log.log(`motorista ${identidade.motoristaId} não aprovado — fila humana`);
      await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
      return;
    }

    // Daqui pra baixo tudo roda dentro da conta do motorista. O `await` mora
    // DENTRO do `comConta` de propósito: promise do Prisma é preguiçosa, e
    // resolver fora do contexto faria a query sair sem a trava de conta.
    await comConta(identidade.contaId, async () => {
      await this.gravar(identidade.sessaoId, telefone, "ENTRADA", texto);

      // A mesma chave que liga e desliga o agente no painel vale aqui. Sem
      // isto, desligar o agente na tela não desligaria nada: o Chatwoot
      // seguiria respondendo por um caminho que a tela não conhece.
      const cfg = await this.prisma.configuracaoAgente.findUnique({
        where: { contaId: identidade.contaId },
        select: { ativo: true, mensagemInativo: true },
      });
      if (cfg && !cfg.ativo) {
        this.log.log(`agente desligado na conta ${identidade.contaId} — fila humana`);
        if (cfg.mensagemInativo?.trim()) {
          await this.chatwoot.responder(contaChatwoot, conversaId, cfg.mensagemInativo);
        }
        await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
        return;
      }

      const resposta = await this.agente.processar(identidade, texto, {
        telefoneRemetente: telefone,
      });

      if (!resposta.trim()) {
        // Agente sem resposta é agente que não soube. Silêncio no WhatsApp é
        // pior que demora: a pessoa fica olhando pro nada.
        this.log.log(`agente não respondeu — conversa ${conversaId} vai pra fila humana`);
        await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
        return;
      }

      const enviado = await this.chatwoot.responder(contaChatwoot, conversaId, resposta);
      if (enviado) {
        await this.gravar(identidade.sessaoId, telefone, "SAIDA", resposta);
      } else {
        await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
      }

      // Dentro do `comConta`: `WhatsappSessao` é dado de negócio e a trava
      // recusa a escrita fora do contexto. Estava aqui fora, e explodia depois
      // de responder — o motorista recebia a mensagem e o log guardava um erro
      // que parecia falha de envio.
      await this.sessao.marcarMensagemRecebida(identidade.sessaoId);
    });
  }

  /**
   * Código de convite: 4 a 8 letras/números, e nada mais na mensagem.
   *
   * Devolve `true` quando a mensagem ERA uma tentativa de vínculo — deu certo
   * ou não. Um código errado é erro de quem digitou, não assunto pra atendente:
   * responde o motivo e deixa tentar de novo, em vez de abrir ticket a cada
   * typo.
   *
   * O consumo roda dentro da conta DO CÓDIGO, não da conversa: quem manda o
   * código ainda não tem conta nenhuma resolvida.
   */
  /**
   * Um número desconhecido escreveu — se ele estiver na base de leads, isso é
   * uma interação comercial e precisa ficar registrada.
   *
   * Só grava o que já é conhecido: não cria lead a partir de quem escreveu,
   * porque número solto sem empresa não é lead, é ruído — e a base de captação
   * tem regra de procedência que um telefone avulso não satisfaz.
   *
   * Best-effort: o atendimento nunca pode falhar porque o CRM falhou.
   */
  private async registrarNoFunil(telefone: string | null, texto: string): Promise<void> {
    if (!telefone) return;
    try {
      await comoSistema(async () => {
        // O lead guarda o telefone como veio da Receita, sem DDI; o WhatsApp
        // manda com 55 na frente. Compara pelos últimos dígitos, que é o que
        // sobrevive às duas formas.
        const semDdi = telefone.replace(/\D/g, "").replace(/^55/, "");
        const lead = await this.prisma.lead.findFirst({
          where: { telefone: { endsWith: semDdi.slice(-8) }, optOut: false },
          select: { id: true, empresa: true, status: true },
        });
        if (!lead) return;

        await this.prisma.interacaoLead.create({
          data: {
            leadId: lead.id,
            canal: "WHATSAPP",
            desfecho: "RESPONDEU",
            resumo: `Mandou mensagem no WhatsApp: "${texto.slice(0, 160)}"`,
            // `autor` nulo é a convenção da tabela pra "veio da automação".
            autor: null,
          },
        });
        // Quem escreve por conta própria está em contato, não é mais só um nome
        // na lista. Só promove quem ainda está no começo do funil — não rebaixa
        // quem já estava em proposta.
        if (lead.status === "NOVO") {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { status: "EM_CONTATO", ultimoContato: new Date() },
          });
        } else {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { ultimoContato: new Date() },
          });
        }
        this.log.log(`Interação registrada no lead ${lead.empresa} (${lead.id}).`);
      });
    } catch (e) {
      this.log.warn(`Não consegui registrar a interação no funil: ${String(e)}`);
    }
  }

  private async tentarVincular(
    texto: string,
    telefone: string,
    contaChatwoot: number,
    conversaId: number,
  ): Promise<boolean> {
    if (!/^[A-Za-z0-9]{4,8}$/.test(texto)) return false;

    const contaDoCodigo = await this.convite.contaDoCodigo(texto);
    if (!contaDoCodigo) return false; // parecia código, mas não era

    try {
      const sessao = await comConta(contaDoCodigo, () =>
        this.convite.consumir(texto, telefone),
      );
      const nome = sessao.motorista?.nome ?? sessao.user?.nome ?? "";
      this.log.log(`telefone vinculado pelo Chatwoot — conversa ${conversaId}`);
      await this.chatwoot.responder(
        contaChatwoot,
        conversaId,
        `Pronto${nome ? `, ${nome.split(" ")[0]}` : ""}! Seu WhatsApp está vinculado. ` +
          "Pode me perguntar sobre suas viagens.",
      );
    } catch (e) {
      // As exceções do ConviteService já vêm com texto pra pessoa ler
      // ("Código expirou", "Código já foi usado").
      const msg = (e as { message?: string }).message ?? "Não consegui usar esse código.";
      await this.chatwoot.responder(contaChatwoot, conversaId, msg);
    }
    return true;
  }

  /**
   * Grava no mesmo histórico que o agente lê depois. Sem isto o agente
   * responderia cada mensagem como se fosse a primeira da conversa — o
   * `AgenteService` monta o contexto a partir de `whatsapp_mensagens`, não do
   * que o Chatwoot guarda.
   */
  private async gravar(
    sessaoId: string,
    telefone: string,
    direcao: "ENTRADA" | "SAIDA",
    conteudo: string,
  ): Promise<void> {
    await this.prisma.whatsappMensagem.create({
      data: { sessaoId, telefone, direcao, conteudo, tipo: "TEXTO", provedor: "meta" },
    });
  }

  private async aprovado(motoristaId: string): Promise<boolean> {
    const m = await comoSistema(() =>
      this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { status: true },
      }),
    );
    return m?.status === "APROVADO";
  }
}
