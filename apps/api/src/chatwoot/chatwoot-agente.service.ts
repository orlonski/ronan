import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { AgenteService } from "../whatsapp/agente/agente.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { ConviteService } from "../whatsapp/convite.service";
import { ChatwootClientService, LABEL_PRECISA_HUMANO } from "./chatwoot-client.service";
import { SdrService } from "../sdr/sdr.service";
import { LeadChatwootService } from "../prospeccao/lead-chatwoot.service";
import {
  EMPRESA_A_DESCOBRIR,
  ORIGEM_INBOUND,
  aceitouOfertaDeHumano,
  ehPedidoDeHumano,
  ehPedidoDeParar,
  ehRespostaAutomatica,
  ehSoEncerramento,
  nomeDePessoa,
  RESUMO_MENSAGEM_RECEBIDA,
  telefoneDaCasa,
} from "../sdr/lead-inbound";
import { ProspeccaoService } from "../prospeccao/prospeccao.service";
import { AtendimentoHumanoService } from "../sdr/atendimento-humano.service";

/**
 * O agente que atende dentro do Chatwoot.
 *
 * **O canal decide quem atende.** No número COMERCIAL, o SDR (sem ferramenta
 * nenhuma de dado de empresa). No número de OPERAÇÃO, motorista aprovado fala
 * com o agente do sistema e todo o resto vai pra uma pessoa — o SDR não entra
 * ali: em setembro/2026 um motorista perguntando de ticket com divergência
 * recebeu doze perguntas de venda, até dizer "Eu sou só motorista".
 *
 * **Gente na conversa, robô fora.** Qualquer gesto de uma pessoa no Chatwoot —
 * escrever, deixar nota, atribuir, etiquetar, resolver — tira o robô daquela
 * conversa até alguém devolver na ficha do lead. E pedido de gente ("quero
 * falar com o Fernando", "quem vai me atender?") é regra fixa antes do modelo.
 *
 * Nada aqui manda mensagem pelo `EnvioWhatsappService`: quem fala com o
 * WhatsApp é o Chatwoot, dono do canal. Responder pelos dois caminhos entregaria
 * a mesma frase duas vezes ao motorista, e uma delas fora da conversa.
 */

/**
 * Quanto esperar por mais mensagens da mesma pessoa antes de responder.
 *
 * Quem digita "oi", "tudo bem?" e "quero saber o preço" em três balões recebia
 * três respostas — cada balão é um webhook, e os três corriam em paralelo.
 * Esperando um pouco, só a ÚLTIMA responde, lendo as três no histórico.
 */
const ESPERA_RAJADA_MS = 5_000;

type AtributoMudado = Record<string, { previous_value?: unknown; current_value?: unknown }>;

type EventoChatwoot = {
  event?: string;
  /** Em `message_created`, o id da MENSAGEM; em `conversation_*`, o da CONVERSA. */
  id?: number;
  message_type?: string;
  content?: string;
  private?: boolean;
  content_attributes?: unknown;
  conversation?: { id?: number; status?: string };
  account?: { id?: number };
  // Em mensagem de entrada, `id` é o CONTATO no Chatwoot (não o remetente da
  // mensagem): é por ele que a ficha do lead volta pra barra lateral do
  // atendimento. Em mensagem de saída, é o agente que escreveu.
  sender?: { id?: number; phone_number?: string; identifier?: string; name?: string; type?: string };
  inbox?: { id?: number; name?: string };
  /** Só nos eventos de conversa: o que mudou, chave → antes/depois. */
  changed_attributes?: AtributoMudado[] | null;
  status?: string;
};

/**
 * Os atributos de conversa que só uma PESSOA muda.
 *
 * Fica de fora o que o próprio Chatwoot mexe sozinho a cada mensagem
 * (`waiting_since`, `first_reply_created_at`, `last_activity_at`): sem esse
 * filtro, a primeira resposta do robô já contaria como "gente assumiu" e ele
 * se calaria depois de uma frase.
 */
const GESTOS_HUMANOS = new Set(["assignee_id", "team_id", "label_list", "priority", "status"]);


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

  /** Espera da rajada. Campo, e não constante, pra teste rodar sem relógio. */
  esperaRajadaMs = ESPERA_RAJADA_MS;
  /** A última mensagem de cada lead — quem chegou por último responde. */
  private readonly ultimaDoLead = new Map<string, symbol>();

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
    private readonly atendimento: AtendimentoHumanoService,
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
    if (evento.event === "conversation_updated" || evento.event === "conversation_status_changed") {
      await this.gestoNaConversa(evento);
      return;
    }
    if (evento.event !== "message_created") return;
    // Saída: ou é o robô (ignora — tratar seria ele conversando consigo mesmo),
    // ou é uma PESSOA escrevendo pela tela, e aí o robô sai da conversa.
    if (evento.message_type === "outgoing") {
      await this.falaDaEquipe(evento);
      return;
    }
    if (evento.message_type !== "incoming") return;

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
    // que entregar pra uma pessoa que entende — mas avisando: o áudio que
    // chegou em 14/09 ficou sem uma palavra de volta.
    if (!texto) {
      await this.avisarFilaHumana(ondeConversa, "operação: mídia sem texto", { canal: "operacao" });
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

      // "SAIR" tem que funcionar de verdade, em qualquer canal.
      if (await this.pararDeContatar(texto, telefone, contaChatwoot, conversaId)) return;

      // A secretária eletrônica de outra empresa não é conversa. Responder faz
      // dois robôs conversarem — e foi respondendo uma dessas que o nosso
      // mandou o próprio raciocínio pra uma pedreira.
      if (ehRespostaAutomatica(texto)) {
        await this.resolverLead(telefone, nomeContato, texto, ondeConversa, { criar: false });
        this.log.log(`aviso automático de ausência na conversa ${conversaId} — sem resposta`);
        return;
      }

      // Número de OPERAÇÃO: quem escreve aqui é motorista, cliente, balança —
      // gente que o sistema deveria conhecer e não reconheceu. Nunca o SDR.
      //
      // Lead que JÁ existe (prospect que a gente procurou por este número)
      // ganha o registro e vai pro comercial; número sem lead nenhum não vira
      // lead — foi assim que motoristas da Schaba entraram na lista de
      // captação como "Contato pelo WhatsApp".
      const leadId = await this.resolverLead(telefone, nomeContato, texto, ondeConversa, {
        criar: false,
      });
      const motorista = leadId ? null : await this.sessao.motoristaPorCadastro(telefone);
      if (motorista) {
        await this.chatwoot.anotar(
          contaChatwoot,
          conversaId,
          `Motorista cadastrado: ${motorista.nome}${motorista.conta ? ` (${motorista.conta})` : ""}. ` +
            "O WhatsApp dele ainda não está vinculado, então o robô não respondeu.",
        );
      }
      await this.avisarFilaHumana(
        ondeConversa,
        `operação: ${motorista ? "motorista sem vínculo" : "número não reconhecido"} — conversa ${conversaId}`,
        {
          canal: leadId ? "comercial" : "operacao",
          leadId,
          ultimaFala: texto,
          etiqueta: motorista ? "motorista" : undefined,
        },
      );
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
        await this.chatwoot.passarParaHumano(
          contaChatwoot,
          conversaId,
          await this.atendimento.timeDoCanal("operacao"),
        );
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
   * Instagram e no site.
   *
   * A ordem importa, e cada degrau é uma lição de setembro/2026:
   * 1. parar é parar (opt-out);
   * 2. aviso automático de outra empresa não se responde;
   * 3. conversa com gente → robô calado;
   * 4. "ok"/emoji depois de uma fala nossa não se responde;
   * 5. pedido de gente → frase com nome e prazo, alerta, e o robô sai;
   * 6. só então o SDR.
   * Quem o SDR não atende (desligado, sem chave, resposta recusada) vai pra
   * uma pessoa com uma palavra — nunca em silêncio.
   */
  private async atenderNoComercial(
    texto: string,
    telefone: string,
    nomeContato: string | null,
    onde: OndeConversa,
  ): Promise<void> {
    const { contaId: contaChatwoot, conversaId } = onde;

    // Áudio, foto e figurinha chegam com `content` vazio. O modelo não ouve
    // áudio: vai pra uma pessoa, com aviso — ou em silêncio, se já tem gente.
    if (!texto) {
      const leadId = telefone ? await this.leadDoTelefone(telefone) : null;
      if (leadId && (await this.comGente(leadId))) return;
      await this.avisarFilaHumana(onde, "comercial: mídia sem texto", {
        canal: "comercial",
        leadId,
        ultimaFala: "(mandou áudio ou foto)",
      });
      return;
    }

    const leadId = await this.resolverLead(telefone, nomeContato, texto, onde);

    if (await this.pararDeContatar(texto, telefone, contaChatwoot, conversaId)) return;

    if (ehRespostaAutomatica(texto)) {
      this.log.log(`aviso automático de ausência na conversa ${conversaId} — sem resposta`);
      return;
    }

    if (leadId && (await this.comGente(leadId))) {
      // Gente cuidando: o robô só guarda o que ele disse, pra ficha contar a
      // conversa inteira.
      await this.sdr.registrarEntrada(leadId, texto);
      this.log.log(`conversa ${conversaId} está com gente — robô calado`);
      return;
    }

    const ultimaFalaNossa = leadId ? await this.ultimaFalaNossa(leadId) : null;

    if (leadId && ultimaFalaNossa && ehSoEncerramento(texto)) {
      await this.sdr.registrarEntrada(leadId, texto);
      this.log.log(`"${texto}" encerra a conversa ${conversaId} — sem resposta`);
      return;
    }

    const nomes = await this.atendimento.nomesDaEquipe();
    if (ehPedidoDeHumano(texto, nomes) || aceitouOfertaDeHumano(texto, ultimaFalaNossa)) {
      if (leadId) await this.sdr.registrarEntrada(leadId, texto);
      await this.avisarFilaHumana(onde, `comercial: pediu gente — conversa ${conversaId}`, {
        canal: "comercial",
        leadId,
        ultimaFala: texto,
        situacao: "Pediu pra falar com uma pessoa.",
      });
      return;
    }

    if (leadId) {
      // Mensagem em rajada: só a última responde, lendo as outras no histórico.
      if (!(await this.souAUltima(leadId))) {
        await this.sdr.registrarEntrada(leadId, texto);
        return;
      }
      // Durante a espera alguém pode ter assumido.
      if (await this.comGente(leadId)) {
        await this.sdr.registrarEntrada(leadId, texto);
        return;
      }
      if (await this.atenderComoSdr(leadId, texto, onde)) return;
    }

    await this.avisarFilaHumana(onde, `comercial: conversa ${conversaId}`, {
      canal: "comercial",
      leadId,
      ultimaFala: texto,
      situacao: "O robô não respondeu — precisa de uma pessoa.",
    });
  }

  /**
   * Uma PESSOA escreveu na conversa pela tela do Chatwoot.
   *
   * O token da API é de um agente de verdade, então "saiu mensagem do Diego"
   * pode ser o robô ou o Diego. `foiORobo` separa — e se foi gente, o robô sai
   * da conversa na hora. Mensagem pública conta como a primeira resposta
   * humana (é o que tira o lead de "esperando atendente"); nota privada só
   * cala o robô.
   */
  private async falaDaEquipe(evento: EventoChatwoot): Promise<void> {
    if (this.chatwoot.foiORobo(evento)) return;
    const conversaId = evento.conversation?.id;
    if (!conversaId) return;
    const lead = await this.leadDaConversa(conversaId);
    if (!lead) return;

    const agora = new Date();
    await comoSistema(() =>
      this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          ...(lead.sdrPausadoEm ? {} : { sdrPausadoEm: agora }),
          ...(!evento.private && !lead.primeiraRespostaHumanaEm
            ? { primeiraRespostaHumanaEm: agora }
            : {}),
        },
      }),
    );
    if (!evento.private && evento.content?.trim()) {
      const quem = evento.sender?.name?.trim() || "Equipe";
      await this.sdr.registrarSaida(lead.id, `[${quem}] ${evento.content.trim()}`);
    }
    this.log.log(
      `${evento.private ? "nota" : "mensagem"} de gente na conversa ${conversaId} — robô fora`,
    );
  }

  /**
   * Atribuir, etiquetar, mudar prioridade, resolver: gesto de gente na
   * conversa, e o robô sai dela.
   *
   * O Chatwoot não diz QUEM fez a mudança. Os únicos gestos que o nosso próprio
   * código faz (abrir, etiquetar `precisa-humano`, atribuir ao time) acontecem
   * no repasse — quando o robô já está saindo de qualquer jeito.
   */
  private async gestoNaConversa(evento: EventoChatwoot): Promise<void> {
    const conversaId = evento.id;
    if (!conversaId) return;

    const mudancas = (evento.changed_attributes ?? []).flatMap((m) => Object.entries(m ?? {}));
    const gesto = mudancas.find(([chave, valor]) => {
      if (!GESTOS_HUMANOS.has(chave)) return false;
      const atual = valor?.current_value;
      // Desatribuir ou tirar etiqueta não é assumir; reabrir também não.
      if (chave === "status") return atual === "resolved" || atual === "snoozed";
      if (chave === "label_list") return Array.isArray(atual) ? atual.length > 0 : Boolean(atual);
      return atual !== null && atual !== undefined && atual !== "";
    });
    if (!gesto) return;

    const lead = await this.leadDaConversa(conversaId);
    if (!lead || lead.sdrPausadoEm) return;
    await this.marcarHumanoAssumiu(lead.id);
    this.log.log(`conversa ${conversaId}: ${gesto[0]} mudou — robô fora`);
  }

  private leadDaConversa(conversaId: number) {
    return comoSistema(() =>
      this.prisma.lead.findFirst({
        where: { chatwootConversaId: conversaId },
        select: { id: true, sdrPausadoEm: true, primeiraRespostaHumanaEm: true },
        orderBy: { atualizadoEm: "desc" },
      }),
    );
  }

  /** O lead deste telefone, sem registrar nada. */
  private async leadDoTelefone(telefone: string): Promise<string | null> {
    const numero = telefoneDaCasa(telefone);
    const lead = await comoSistema(() =>
      this.prisma.lead.findFirst({
        where: { telefone: { endsWith: numero.slice(-8) } },
        select: { id: true },
        orderBy: { criadoEm: "asc" },
      }),
    );
    return lead?.id ?? null;
  }

  /** Tem gente cuidando desta conversa? Então o robô não fala. */
  private async comGente(leadId: string): Promise<boolean> {
    const lead = await comoSistema(() =>
      this.prisma.lead.findUnique({ where: { id: leadId }, select: { sdrPausadoEm: true } }),
    );
    return Boolean(lead?.sdrPausadoEm);
  }

  /** A última coisa que NÓS dissemos a ele nas últimas 24h, ou `null`. */
  private async ultimaFalaNossa(leadId: string): Promise<string | null> {
    const m = await comoSistema(() =>
      this.prisma.mensagemLead.findFirst({
        where: {
          leadId,
          direcao: "SAIDA",
          criadoEm: { gte: new Date(Date.now() - 24 * 3_600_000) },
          NOT: { conteudo: { startsWith: "[descartada" } },
        },
        orderBy: { criadoEm: "desc" },
        select: { conteudo: true },
      }),
    );
    return m?.conteudo ?? null;
  }

  /**
   * Espera a rajada acabar. `true` = esta é a última mensagem, e é ela que
   * responde; `false` = chegou outra depois, e a outra responde pelas duas.
   */
  private async souAUltima(leadId: string): Promise<boolean> {
    if (this.esperaRajadaMs <= 0) return true;
    const minha = Symbol(leadId);
    this.ultimaDoLead.set(leadId, minha);
    await new Promise((r) => setTimeout(r, this.esperaRajadaMs));
    const venceu = this.ultimaDoLead.get(leadId) === minha;
    if (venceu) this.ultimaDoLead.delete(leadId);
    return venceu;
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
    opcoes: { criar: boolean } = { criar: true },
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
          if (!opcoes.criar) return { id: null, sdr: false };
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
            // Ele voltou a falar: a conversa revive e o contador de toques
            // zera. É o que faz o varredor desistir no meio de uma corrida com
            // este webhook — a comparação do contador não bate mais.
            //
            // `sdrPausadoEm` NÃO é limpo aqui de propósito: se um humano
            // assumiu, ele continua dono da conversa mesmo depois de o prospect
            // responder. Quem devolve pro robô é uma pessoa, na tela.
            followupsEnviados: 0,
            ultimoFollowupEm: null,
            conversaEncerradaEm: null,
          },
        });
        this.log.log(`Interação registrada no lead ${lead.empresa} (${lead.id}).`);
        return { id: lead.id, sdr: true };
      });

      // Fora do `comoSistema` de propósito: quem escreve aqui já faz a própria
      // troca de contexto, e a chamada HTTP pro Chatwoot não pertence a
      // transação nenhuma.
      if (achado.id) await this.leadChatwoot.vincular(achado.id, onde);

      // No canal de operação o SDR não entra, mas o lead que já existia tem
      // que ser devolvido mesmo assim: é ele que recebe o alerta do comercial.
      if (!opcoes.criar) return achado.id && achado.sdr ? achado.id : null;
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

  /**
   * Um humano assumiu esta conversa — o robô não escreve mais nela.
   *
   * Best-effort de propósito: falhar em carimbar não pode impedir o repasse,
   * que é o que a pessoa do outro lado está esperando. O pior caso é um
   * follow-up a mais, não uma conversa sem atendente.
   */
  private async marcarHumanoAssumiu(leadId: string): Promise<void> {
    try {
      await comoSistema(() =>
        this.prisma.lead.update({
          where: { id: leadId },
          data: { sdrPausadoEm: new Date() },
        }),
      );
    } catch (e) {
      this.log.warn(`não consegui marcar o lead ${leadId} como assumido: ${String(e)}`);
    }
  }

  /** O toque no funil. Mesma linha pro lead que já existia e pro que nasceu agora. */
  private registrarInteracao(leadId: string, texto: string) {
    return this.prisma.interacaoLead.create({
      data: {
        leadId,
        canal: "WHATSAPP",
        desfecho: "RESPONDEU",
        resumo: `${RESUMO_MENSAGEM_RECEBIDA}: "${texto.slice(0, 160)}"`,
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
  private async atenderComoSdr(leadId: string, texto: string, onde: OndeConversa): Promise<boolean> {
    const { contaId: contaChatwoot, conversaId } = onde;
    try {
      const resposta = await this.sdr.atender(leadId, texto);
      // Silêncio decidido não é falha: não envia e não vai pra fila.
      if (resposta?.silencio) return true;
      if (!resposta?.texto.trim()) return false;

      const enviado = await this.chatwoot.responder(contaChatwoot, conversaId, resposta.texto);
      if (!enviado) return false;

      if (resposta.passarParaHumano) {
        this.log.log(`SDR pediu humano na conversa ${conversaId}: ${resposta.motivoHumano}`);
        // A frase do SDR já saiu — o repasse não repete aviso nenhum.
        await this.avisarFilaHumana(onde, `SDR: ${resposta.motivoHumano}`, {
          canal: "comercial",
          leadId,
          ultimaFala: texto,
          situacao: resposta.motivoHumano ?? "O robô passou pra uma pessoa.",
          semAviso: true,
        });
      }
      return true;
    } catch (e) {
      this.log.warn(`SDR falhou na conversa ${conversaId}: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Entrega a conversa pra uma pessoa, avisando quem escreveu — **uma vez só**.
   *
   * A frase repetida era um bug de verdade: quem mandava "oi", "bom dia" e
   * "tem alguém aí?" recebia a mesma resposta três vezes em dois minutos,
   * porque cada mensagem é um webhook novo e nada lembrava do anterior. Três
   * respostas idênticas não parecem atendimento, parecem robô quebrado — e
   * essa é a primeira impressão que a Movatruck dá pra um prospect.
   *
   * A memória é a própria etiqueta `precisa-humano`, que já era aplicada: ela
   * vive no Chatwoot, sobrevive entre um webhook e outro e some junto com a
   * conversa quando um atendente resolve (o inbox abre uma nova a cada ciclo,
   * e a nova conversa merece o aviso de novo).
   *
   * O repasse continua acontecendo sempre — é barato, é idempotente, e garante
   * que a conversa volte pra fila mesmo que alguém a tenha fechado no meio.
   */
  private async avisarFilaHumana(
    onde: OndeConversa,
    motivo: string,
    opcoes: {
      canal: "comercial" | "operacao";
      leadId?: string | null;
      /** O que a pessoa disse por último — vai no alerta. */
      ultimaFala?: string;
      /** Uma linha pro alerta dizer por que está chegando. */
      situacao?: string;
      /** A frase pro prospect já saiu (o SDR falou) — não repetir. */
      semAviso?: boolean;
      /** Etiqueta a mais, pra quem atende saber de cara do que se trata. */
      etiqueta?: string;
    },
  ): Promise<void> {
    const { contaId: contaChatwoot, conversaId } = onde;
    const { leadId } = opcoes;
    // "Já avisei esta pessoa?" — com lead, a resposta é o próprio lead: já
    // estava com gente ANTES desta mensagem. A etiqueta do Chatwoot sobrevive
    // a lead excluído e a "Devolver ao robô", e usar ela deixou o dono sem
    // resposta nenhuma no teste de 28/09: o repasse saiu calado. Sem lead
    // (motorista, número desconhecido na operação), a etiqueta é o que há.
    const jaAvisado = leadId
      ? await this.comGente(leadId)
      : await this.chatwoot.temEtiqueta(contaChatwoot, conversaId, LABEL_PRECISA_HUMANO);
    // Daqui pra frente quem cuida é gente. O robô sai de cena: sem isto, o
    // varredor de follow-up escreveria por cima de um vendedor no meio da
    // conversa, que é o jeito mais rápido de estragar uma venda com um robô.
    if (leadId) await this.marcarHumanoAssumiu(leadId);
    if (jaAvisado || opcoes.semAviso) {
      this.log.log(`${motivo} — já estava na fila humana, sem repetir o aviso`);
    } else {
      this.log.log(`${motivo} — vai pra fila humana`);
      const texto = await this.atendimento.mensagemDeRepasse(opcoes.canal);
      const enviado = await this.chatwoot.responder(contaChatwoot, conversaId, texto);
      if (enviado && leadId) await this.sdr.registrarSaida(leadId, texto);
    }
    await this.chatwoot.passarParaHumano(
      contaChatwoot,
      conversaId,
      await this.atendimento.timeDoCanal(opcoes.canal),
      opcoes.etiqueta ? [opcoes.etiqueta] : [],
    );
    if (leadId && opcoes.canal === "comercial") {
      await this.atendimento.avisar(
        leadId,
        opcoes.situacao ?? "Esperando uma pessoa.",
        opcoes.ultimaFala ?? "",
        conversaId,
      );
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
