import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { AgenteService } from "../whatsapp/agente/agente.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { ConviteService } from "../whatsapp/convite.service";
import { ChatwootClientService } from "./chatwoot-client.service";
import { SdrService } from "../sdr/sdr.service";
import { LeadChatwootService } from "../prospeccao/lead-chatwoot.service";
import {
  EMPRESA_A_DESCOBRIR,
  ORIGEM_INBOUND,
  ehPedidoDeParar,
  nomeDePessoa,
  telefoneDaCasa,
} from "../sdr/lead-inbound";
import { ProspeccaoService } from "../prospeccao/prospeccao.service";

/**
 * O agente que atende dentro do Chatwoot.
 *
 * **Quem escreve decide o que o agente pode fazer.** Telefone que bate com um
 * motorista aprovado ganha o agente com ferramentas do sistema; qualquer outro
 * número é tratado como prospect e vai pro SDR, que não tem ferramenta nenhuma
 * de dado de empresa. A fronteira é de segurança, não de organização: um agente
 * único com todas as ferramentas responderia "sua viagem de ontem foi pra Ponta
 * Grossa" pra quem digitasse um número por sorte.
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
  // `id` é o CONTATO no Chatwoot (não o remetente da mensagem): é por ele
  // que a ficha do lead volta pra barra lateral do atendimento.
  sender?: { id?: number; phone_number?: string; identifier?: string; name?: string };
  inbox?: { id?: number; name?: string };
};

/**
 * Onde a conversa mora no Chatwoot. Anda junto pelo fluxo porque é o que liga
 * o lead do CRM à conversa do atendimento — os dois lados da mesma pessoa.
 */
type OndeConversa = {
  contaId: number;
  /** O contato. `null` quando o payload não trouxe — dá pra viver sem. */
  contatoId: number | null;
  conversaId: number;
};

@Injectable()
export class ChatwootAgenteService {
  private readonly log = new Logger("ChatwootAgente");

  /**
   * O inbox do número COMERCIAL (`CHATWOOT_INBOX_COMERCIAL`).
   *
   * Vazio = não existe canal de vendas separado, e tudo segue pelo caminho
   * antigo. É o estado em que o sistema viveu enquanto havia um número só.
   */
  private readonly inboxComercial: number | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessao: SessaoService,
    private readonly agente: AgenteService,
    private readonly convite: ConviteService,
    private readonly chatwoot: ChatwootClientService,
    private readonly sdr: SdrService,
    private readonly leadChatwoot: LeadChatwootService,
    private readonly prospeccao: ProspeccaoService,
    config: ConfigService,
  ) {
    const bruto = Number(config.get<string>("CHATWOOT_INBOX_COMERCIAL"));
    this.inboxComercial = Number.isInteger(bruto) && bruto > 0 ? bruto : null;
    if (this.inboxComercial) {
      this.log.log(`inbox ${this.inboxComercial} é o canal comercial (sem agente do motorista)`);
    }
  }

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
    // O nome do perfil do WhatsApp. Só serve pra dar cara a um lead que
    // nasce agora — o Chatwoot devolve o próprio número quando não há nome.
    const nomeContato = evento.sender?.name ?? null;

    if (!conversaId || !contaChatwoot) {
      this.log.warn("evento sem conversa ou conta — ignorado");
      return;
    }

    // Onde essa conversa mora no Chatwoot. Vai junto do lead: é o que deixa a
    // ficha do painel abrir a conversa e o atendimento saber quem é o número.
    const ondeConversa: OndeConversa = {
      contaId: contaChatwoot,
      contatoId: evento.sender?.id ?? null,
      conversaId,
    };

    // O canal por onde a pessoa escreveu diz mais que o número dela.
    //
    // Quem escreve no comercial veio de anúncio, do site ou da prospecção: é
    // conversa de VENDA. O agente do motorista não entra aqui nem quando o
    // telefone bate com um motorista cadastrado — ele carrega ferramentas que
    // leem viagem, km e ticket de uma empresa, e nada disso se responde no
    // canal onde um prospect qualquer pode escrever.
    //
    // O contrário também vale, e é o motivo de a decisão ser por inbox e não
    // por telefone: um motorista que escreve no número de operação continua
    // caindo no agente dele, como sempre.
    if (this.inboxComercial && evento.inbox?.id === this.inboxComercial) {
      await this.atenderNoComercial(texto, telefone, nomeContato, ondeConversa);
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

      // É um PROSPECT: alguém que a prospecção já conhece, ou que viu o site,
      // o Instagram, ou que um cliente indicou. Resolver o lead antes de
      // mandar pra fila humana é o que evita a conversa sumir — até aqui ela
      // virava ticket no atendimento e o lado comercial nunca ficava sabendo
      // que a empresa tinha procurado a gente.
      const leadId = await this.resolverLead(telefone, nomeContato, texto, ondeConversa);

      // "SAIR" tem que funcionar de verdade. É o que a gente promete no fim de
      // toda mensagem de prospecção, e promessa de opt-out que depende de
      // alguém ler o ticket é promessa quebrada.
      if (await this.pararDeContatar(texto, telefone, contaChatwoot, conversaId)) return;

      // SDR ligado: quem responde é o atendimento comercial. `null` aqui não é
      // mais "não está na base" — é opt-out ou falha; nos dois casos a
      // conversa segue pro caminho de sempre, a fila humana.
      if (leadId && (await this.atenderComoSdr(leadId, texto, contaChatwoot, conversaId))) {
        return;
      }

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
   * Atendimento do canal comercial.
   *
   * Sem agente do motorista, sem código de convite: só funil e SDR. Aqui todo
   * número desconhecido é prospect por definição — é o número que sai no
   * Instagram e no site. Quem o SDR não atende (desligado, sem chave de IA,
   * opt-out) vai pra fila humana com uma palavra — nunca em silêncio, porque
   * silêncio no WhatsApp é a forma mais rápida de perder uma venda que já
   * tinha chegado.
   */
  private async atenderNoComercial(
    texto: string,
    telefone: string,
    nomeContato: string | null,
    onde: OndeConversa,
  ): Promise<void> {
    const { contaId: contaChatwoot, conversaId } = onde;
    const leadId = await this.resolverLead(telefone, nomeContato, texto, onde);

    if (await this.pararDeContatar(texto, telefone, contaChatwoot, conversaId)) return;

    if (leadId && (await this.atenderComoSdr(leadId, texto, contaChatwoot, conversaId))) return;

    this.log.log(`comercial: conversa ${conversaId} vai pra fila humana`);
    await this.chatwoot.responder(contaChatwoot, conversaId, TEXTO_DESCONHECIDO);
    await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
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
   * Quem é esse número — e a conversa pode seguir pro SDR?
   *
   * Devolve o id do lead quando pode, `null` quando não. Antes isto só
   * reconhecia quem a prospecção já tinha encontrado; quem escrevia por conta
   * própria caía na fila humana, que na prática é ninguém respondendo na hora.
   * Era a régua errada: a procedência obrigatória (`origemDado`, fonte, data)
   * existe pra prospecção ATIVA, quando somos nós que chegamos primeiro. Quem
   * manda mensagem pro WhatsApp da Movatruck deu o número no ato de escrever.
   *
   * Best-effort: o atendimento nunca pode falhar porque o CRM falhou — erro
   * aqui devolve `null`, e `null` é o comportamento de antes do SDR existir.
   */
  private async resolverLead(
    telefone: string | null,
    nomeContato: string | null,
    texto: string,
    onde: OndeConversa,
  ): Promise<string | null> {
    if (!telefone) return null;
    try {
      const achado = await comoSistema(async () => {
        // O lead guarda o telefone como veio da Receita, sem DDI; o WhatsApp
        // manda com 55 na frente. Compara pelos últimos dígitos, que é o que
        // sobrevive às duas formas.
        const numero = telefoneDaCasa(telefone);
        // A busca NÃO filtra `optOut`, e isso é o ponto: filtrando, o lead de
        // quem pediu pra não ser contatado ficava invisível — e agora que
        // número desconhecido vira cadastro, invisível significaria criar um
        // lead novo exatamente pra quem pediu pra sumir da base.
        const lead = await this.prisma.lead.findFirst({
          where: { telefone: { endsWith: numero.slice(-8) } },
          select: { id: true, empresa: true, status: true, optOut: true },
          orderBy: { criadoEm: "asc" },
        });

        if (!lead) {
          const novo = await this.criarLeadInbound(numero, nomeContato, texto);
          return { id: novo, sdr: novo !== null };
        }

        await this.registrarInteracao(lead.id, texto);

        if (lead.optOut) {
          // A interação fica registrada — ele escreveu, e isso é fato do
          // funil. Mas o SDR não responde: enquanto opt-out significar "não
          // fale comigo", responder por robô é desobedecer no detalhe.
          this.log.log(`Lead ${lead.id} está em opt-out — sem SDR, fila humana.`);
          // Devolve o id mesmo assim: o vínculo com a conversa tem que
          // acontecer JUSTAMENTE aqui, pra "não contatar" chegar na tela de
          // quem está prestes a responder.
          return { id: lead.id, sdr: false };
        }

        // Quem escreve por conta própria está em contato, não é mais só um nome
        // na lista. Só promove quem ainda está no começo do funil — não rebaixa
        // quem já estava em proposta.
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            ...(lead.status === "NOVO" ? { status: "EM_CONTATO" } : {}),
            ultimoContato: new Date(),
          },
        });
        this.log.log(`Interação registrada no lead ${lead.empresa} (${lead.id}).`);
        return { id: lead.id, sdr: true };
      });

      // Fora do `comoSistema` de propósito: quem escreve aqui já faz a própria
      // troca de contexto, e a chamada HTTP pro Chatwoot não pertence a
      // transação nenhuma.
      if (achado.id) await this.leadChatwoot.vincular(achado.id, onde);

      return achado.sdr ? achado.id : null;
    } catch (e) {
      this.log.warn(`Não consegui resolver o lead da conversa: ${String(e)}`);
      return null;
    }
  }

  /**
   * Ninguém conhece esse número: ele vira lead agora.
   *
   * É o melhor lead que existe — veio do Instagram, do site ou de indicação, e
   * escreveu primeiro. O que falta dele (empresa, frota, dor) o próprio SDR
   * descobre conversando e grava por `registrar_qualificacao`.
   *
   * Roda dentro do `comoSistema` de quem chamou.
   */
  private async criarLeadInbound(
    numero: string,
    nomeContato: string | null,
    texto: string,
  ): Promise<string | null> {
    // A supressão global vale antes de existir lead: quem pediu pra não ser
    // contatado e teve o cadastro descartado depois não volta pra base só
    // porque escreveu de novo.
    const suprimido = await this.prisma.supressaoContato.findFirst({
      where: { contato: { in: [numero, `55${numero}`] } },
      select: { contato: true },
    });
    if (suprimido) {
      this.log.log(`Número ${numero} está na supressão — sem SDR, fila humana.`);
      return null;
    }

    try {
      const lead = await this.prisma.lead.create({
        data: {
          empresa: EMPRESA_A_DESCOBRIR,
          nome: nomeDePessoa(nomeContato, numero),
          telefone: numero,
          origem: ORIGEM_INBOUND,
          // A pergunta "como vocês conseguiram meu número?" também tem
          // resposta aqui, e é a mais forte de todas: ele mesmo escreveu.
          origemDado: "escreveu no WhatsApp da Movatruck",
          coletadoEm: new Date(),
          // Nasce EM_CONTATO, nunca NOVO: `NOVO` é a fila de quem ainda não foi
          // tocado, de onde saem as campanhas. Quem já está conversando não
          // pode cair nessa fila e receber um "oi" frio por cima da conversa.
          status: "EM_CONTATO",
          ultimoContato: new Date(),
        },
        select: { id: true },
      });
      await this.registrarInteracao(lead.id, texto);
      this.log.log(`Número ${numero} virou lead ${lead.id} — chegou pelo WhatsApp.`);
      return lead.id;
    } catch (e) {
      // Duas mensagens em sequência ("oi" e "boa tarde") chegam em webhooks
      // paralelos e disputam a criação. O índice único parcial derruba a
      // segunda; achar o lead que a primeira criou é a resposta certa, não o
      // erro.
      if ((e as { code?: string }).code === "P2002") {
        const existente = await this.prisma.lead.findFirst({
          where: { telefone: numero, origem: ORIGEM_INBOUND },
          select: { id: true },
        });
        if (existente) {
          await this.registrarInteracao(existente.id, texto);
          return existente.id;
        }
      }
      throw e;
    }
  }

  /** O toque no funil. Mesma linha pro lead que já existia e pro que nasceu agora. */
  private registrarInteracao(leadId: string, texto: string) {
    return this.prisma.interacaoLead.create({
      data: {
        leadId,
        canal: "WHATSAPP",
        desfecho: "RESPONDEU",
        resumo: `Mandou mensagem no WhatsApp: "${texto.slice(0, 160)}"`,
        // `autor` nulo é a convenção da tabela pra "veio da automação".
        autor: null,
      },
    });
  }

  /**
   * "SAIR", "parar", "não quero" — e acabou.
   *
   * Devolve `true` quando era um pedido de parar, e aí a conversa não segue
   * pra lugar nenhum: nem SDR, nem fila humana. Responder com um robô depois
   * de alguém pedir pra parar é desobedecer no detalhe; mandar pra fila humana
   * é fazer uma pessoa ler pra confirmar o óbvio.
   *
   * A supressão é GLOBAL e sobrevive à próxima carga do RNTRC — quem sai, sai
   * de todas as listas, não só desta conversa.
   */
  private async pararDeContatar(
    texto: string,
    telefone: string,
    contaChatwoot: number,
    conversaId: number,
  ): Promise<boolean> {
    if (!telefone || !ehPedidoDeParar(texto)) return false;
    try {
      await this.prospeccao.registrarOptOut(
        telefoneDaCasa(telefone),
        `pediu no WhatsApp: "${texto.slice(0, 60)}"`,
        "WHATSAPP",
      );
      this.log.log(`Opt-out por mensagem na conversa ${conversaId}.`);
    } catch (e) {
      // Falhar em gravar não pode virar silêncio: a pessoa precisa da
      // confirmação, e o log é o que nos conta que ficou faltando.
      this.log.error(`não consegui registrar o opt-out: ${(e as Error).message}`);
    }
    await this.chatwoot.responder(
      contaChatwoot,
      conversaId,
      "Pronto, tirei seu número da nossa lista. Não vamos mais te procurar. Se um dia precisar, é só chamar aqui.",
    );
    return true;
  }

  /**
   * O SDR responde um prospect conhecido.
   *
   * Devolve `true` quando de fato respondeu — só aí a conversa não precisa mais
   * ir pra fila humana. `false` significa "não é comigo": SDR desligado, sem
   * chave de IA, lead em opt-out, ou o próprio SDR pedindo uma pessoa.
   *
   * Quando ele pede humano, a resposta dele sai ANTES do encaminhamento: a
   * pessoa lê "alguém vai te chamar" e a conversa aparece na fila do
   * atendimento — as duas coisas, não uma ou outra.
   *
   * Nunca lança. Falha de IA aqui cai na fila humana, que é o comportamento de
   * antes de o SDR existir; derrubar o webhook faria o Chatwoot reenviar e a
   * pessoa receber tudo duas vezes.
   */
  private async atenderComoSdr(
    leadId: string,
    texto: string,
    contaChatwoot: number,
    conversaId: number,
  ): Promise<boolean> {
    try {
      const resposta = await this.sdr.atender(leadId, texto);
      if (!resposta?.texto.trim()) return false;

      const enviado = await this.chatwoot.responder(contaChatwoot, conversaId, resposta.texto);
      if (!enviado) return false;

      if (resposta.passarParaHumano) {
        this.log.log(`SDR pediu humano na conversa ${conversaId}: ${resposta.motivoHumano}`);
        await this.chatwoot.passarParaHumano(contaChatwoot, conversaId);
      }
      return true;
    } catch (e) {
      this.log.warn(`SDR falhou na conversa ${conversaId}: ${(e as Error).message}`);
      return false;
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
