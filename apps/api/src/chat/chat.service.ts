import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  ContatoChat,
  ConversaResumo,
  DenunciarMensagemInput,
  EnviarAudioChatInput,
  EnviarMensagemChatInput,
  ListaConversasResponse,
  MensagemChatItem,
  MensagensChatResponse,
  NovidadesChatResponse,
} from "@ronan/shared-types";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import { UploadsService } from "../uploads/uploads.service";
import { TranscricaoService } from "../ia/transcricao.service";

/** Quantas mensagens uma página do histórico devolve. */
const PAGINA_MENSAGENS = 40;

/** Teto de mensagens que um poll de novidades devolve de uma vez. */
const MAX_NOVIDADES = 60;

/**
 * Chave canônica da conversa 1:1 — os dois ids ordenados. É o que faz dois
 * celulares abrindo a mesma conversa ao mesmo tempo caírem na MESMA linha:
 * a corrida morre no unique do banco, não numa checagem em código.
 */
function chaveDireta(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0]![0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Prévia curta pra lista de conversas. Áudio não tem texto — vira rótulo. */
function previaDe(m: { tipo: string; texto: string | null; audioSegundos: number | null }): string {
  if (m.tipo === "FOTO") return `📷 ${(m.texto ?? "Foto").slice(0, 118)}`;
  if (m.tipo === "AUDIO") {
    const s = m.audioSegundos ?? 0;
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `🎤 Áudio ${mm}:${ss}`;
  }
  return (m.texto ?? "").slice(0, 120);
}

const MENSAGEM_REMOVIDA = "Mensagem removida por violar as regras.";
const MENSAGEM_APAGADA = "Mensagem apagada.";
/** No canal de Avisos quem remove é a própria operação — não é moderação. */
const AVISO_REMOVIDO = "Aviso removido.";

type MensagemComAutor = Prisma.MensagemChatGetPayload<{
  select: {
    id: true;
    clientId: true;
    conversaId: true;
    autor: true;
    motoristaId: true;
    autorNome: true;
    tipo: true;
    texto: true;
    fotoKey: true;
    audioKey: true;
    audioSegundos: true;
    transcricao: true;
    criadoEm: true;
    apagadaEm: true;
    removidaPorId: true;
  };
}>;

const SELECT_MENSAGEM = {
  id: true,
  clientId: true,
  conversaId: true,
  autor: true,
  motoristaId: true,
  autorNome: true,
  tipo: true,
  texto: true,
  fotoKey: true,
  audioKey: true,
  audioSegundos: true,
  transcricao: true,
  criadoEm: true,
  apagadaEm: true,
  removidaPorId: true,
} as const;

@Injectable()
export class ChatService {
  private readonly log = new Logger("ChatService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly uploads: UploadsService,
    private readonly transcricao: TranscricaoService,
  ) {}

  // ── Contatos ──────────────────────────────────────────────────────────────

  /**
   * Quem eu posso chamar no chat: motorista aprovado, ativo e com a flag
   * ligada — não adianta listar quem não tem a aba pra receber. Bloqueio some
   * da lista nos DOIS sentidos (quem eu bloqueei e quem me bloqueou).
   *
   * Telefone NÃO sai daqui de propósito: motorista é parceiro autônomo, o
   * contato dele não é da conta dos outros.
   */
  async contatos(motoristaId: string, busca?: string): Promise<ContatoChat[]> {
    const bloqueados = await this.idsBloqueadosNosDoisSentidos(motoristaId);

    const motoristas = await this.prisma.motorista.findMany({
      where: {
        id: { notIn: [motoristaId, ...bloqueados] },
        status: "APROVADO",
        ativo: true,
        podeChat: true,
        ...(busca?.trim()
          ? { nome: { contains: busca.trim(), mode: "insensitive" as const } }
          : {}),
      },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
      take: 300,
    });

    // Conversas que já existem com cada um — o app abre direto no histórico
    // em vez de criar uma linha nova.
    const chaves = motoristas.map((m) => chaveDireta(motoristaId, m.id));
    const existentes = await this.prisma.conversa.findMany({
      where: { chaveDireta: { in: chaves } },
      select: { id: true, chaveDireta: true },
    });
    const porChave = new Map(existentes.map((c) => [c.chaveDireta!, c.id]));

    return motoristas.map((m) => ({
      motoristaId: m.id,
      nome: m.nome,
      iniciais: iniciaisDe(m.nome),
      conversaId: porChave.get(chaveDireta(motoristaId, m.id)) ?? null,
    }));
  }

  private async idsBloqueadosNosDoisSentidos(motoristaId: string): Promise<string[]> {
    const bloqueios = await this.prisma.bloqueioChat.findMany({
      where: { OR: [{ motoristaId }, { bloqueadoId: motoristaId }] },
      select: { motoristaId: true, bloqueadoId: true },
    });
    const ids = new Set<string>();
    for (const b of bloqueios) {
      ids.add(b.motoristaId === motoristaId ? b.bloqueadoId : b.motoristaId);
    }
    return [...ids];
  }

  // ── Conversas ─────────────────────────────────────────────────────────────

  /**
   * Lista de conversas do motorista, mais recente primeiro, com o canal de
   * Avisos sempre no topo. Garante a participação no canal na passada — é o
   * que faz motorista novo (ou recém-liberado) já enxergar os avisos.
   */
  async listarConversas(motoristaId: string): Promise<ListaConversasResponse> {
    await this.garantirParticipacaoAvisos(motoristaId);
    const bloqueados = await this.idsBloqueadosNosDoisSentidos(motoristaId);

    const participacoes = await this.prisma.conversaParticipante.findMany({
      where: { motoristaId },
      include: {
        conversa: {
          include: {
            participantes: {
              where: { motoristaId: { not: motoristaId } },
              include: { motorista: { select: { id: true, nome: true } } },
            },
          },
        },
      },
    });

    const conversas: ConversaResumo[] = [];
    for (const p of participacoes) {
      const resumo = this.montarResumo(p, bloqueados);
      if (resumo) conversas.push(resumo);
    }

    conversas.sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === "AVISOS" ? -1 : 1;
      return (b.ultimaMensagemEm ?? "").localeCompare(a.ultimaMensagemEm ?? "");
    });

    return {
      conversas,
      totalNaoLidas: conversas.reduce((acc, c) => acc + c.naoLidas, 0),
    };
  }

  private montarResumo(
    p: Prisma.ConversaParticipanteGetPayload<{
      include: {
        conversa: {
          include: { participantes: { include: { motorista: { select: { id: true; nome: true } } } } };
        };
      };
    }>,
    bloqueados: string[],
  ): ConversaResumo | null {
    const c = p.conversa;
    if (c.tipo === "AVISOS") {
      return {
        id: c.id,
        tipo: "AVISOS",
        titulo: "Avisos da transportadora",
        iniciais: "AV",
        outroMotoristaId: null,
        ultimaMensagemTexto: c.ultimaMensagemTexto,
        ultimaMensagemEm: c.ultimaMensagemEm?.toISOString() ?? null,
        naoLidas: p.naoLidas,
        silenciado: p.silenciado,
      };
    }
    const outro = c.participantes[0]?.motorista;
    // Conversa órfã (o outro lado foi excluído) ou com alguém bloqueado some
    // da lista — sem apagar nada no banco.
    if (!outro || bloqueados.includes(outro.id)) return null;
    return {
      id: c.id,
      tipo: "DIRETA",
      titulo: outro.nome,
      iniciais: iniciaisDe(outro.nome),
      outroMotoristaId: outro.id,
      ultimaMensagemTexto: c.ultimaMensagemTexto,
      ultimaMensagemEm: c.ultimaMensagemEm?.toISOString() ?? null,
      naoLidas: p.naoLidas,
      silenciado: p.silenciado,
    };
  }

  /** Abre (ou recupera) a conversa 1:1. Idempotente — pode chamar à vontade. */
  async abrirConversa(motoristaId: string, outroId: string): Promise<ConversaResumo> {
    if (outroId === motoristaId) {
      throw new BadRequestException("Não dá pra abrir conversa com você mesmo.");
    }
    const outro = await this.prisma.motorista.findUnique({
      where: { id: outroId },
      select: { id: true, nome: true, status: true, ativo: true, podeChat: true },
    });
    if (!outro) throw new NotFoundException("Motorista não encontrado.");
    if (outro.status !== "APROVADO" || !outro.ativo || !outro.podeChat) {
      throw new BadRequestException("Esse motorista não está no chat.");
    }
    const bloqueados = await this.idsBloqueadosNosDoisSentidos(motoristaId);
    if (bloqueados.includes(outroId)) {
      throw new ForbiddenException("Vocês não podem conversar.");
    }

    const chave = chaveDireta(motoristaId, outroId);
    const existente = await this.prisma.conversa.findUnique({
      where: { chaveDireta: chave },
      include: { participantes: { where: { motoristaId } } },
    });
    if (existente) {
      return {
        id: existente.id,
        tipo: "DIRETA",
        titulo: outro.nome,
        iniciais: iniciaisDe(outro.nome),
        outroMotoristaId: outro.id,
        ultimaMensagemTexto: existente.ultimaMensagemTexto,
        ultimaMensagemEm: existente.ultimaMensagemEm?.toISOString() ?? null,
        naoLidas: existente.participantes[0]?.naoLidas ?? 0,
        silenciado: existente.participantes[0]?.silenciado ?? false,
      };
    }

    // Corrida real: os dois motoristas tocando no nome um do outro ao mesmo
    // tempo. Quem perder o unique lê a linha do vencedor.
    try {
      const nova = await this.prisma.conversa.create({
        data: {
          tipo: "DIRETA",
          chaveDireta: chave,
          participantes: {
            create: [{ motoristaId }, { motoristaId: outroId }],
          },
        },
      });
      return {
        id: nova.id,
        tipo: "DIRETA",
        titulo: outro.nome,
        iniciais: iniciaisDe(outro.nome),
        outroMotoristaId: outro.id,
        ultimaMensagemTexto: null,
        ultimaMensagemEm: null,
        naoLidas: 0,
        silenciado: false,
      };
    } catch {
      const doOutro = await this.prisma.conversa.findUnique({
        where: { chaveDireta: chave },
      });
      if (!doOutro) throw new BadRequestException("Não consegui abrir a conversa.");
      return {
        id: doOutro.id,
        tipo: "DIRETA",
        titulo: outro.nome,
        iniciais: iniciaisDe(outro.nome),
        outroMotoristaId: outro.id,
        ultimaMensagemTexto: doOutro.ultimaMensagemTexto,
        ultimaMensagemEm: doOutro.ultimaMensagemEm?.toISOString() ?? null,
        naoLidas: 0,
        silenciado: false,
      };
    }
  }

  // ── Mensagens ─────────────────────────────────────────────────────────────

  /**
   * Página do histórico, do mais novo pro mais antigo (o app inverte pra
   * renderizar). `cursor` é o id da mensagem mais antiga que já tenho.
   */
  async mensagens(
    motoristaId: string,
    conversaId: string,
    cursor?: string,
  ): Promise<MensagensChatResponse> {
    const { participacao, conversa } = await this.exigirParticipacao(motoristaId, conversaId);
    const bloqueados = await this.idsBloqueadosNosDoisSentidos(motoristaId);
    const resumo = this.montarResumo(participacao, bloqueados);
    if (!resumo) throw new NotFoundException("Conversa indisponível.");

    const linhas = await this.prisma.mensagemChat.findMany({
      where: { conversaId },
      orderBy: { criadoEm: "desc" },
      take: PAGINA_MENSAGENS + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: SELECT_MENSAGEM,
    });

    const temMais = linhas.length > PAGINA_MENSAGENS;
    const pagina = temMais ? linhas.slice(0, PAGINA_MENSAGENS) : linhas;

    return {
      conversa: resumo,
      // Ordem cronológica: o app só renderiza.
      mensagens: pagina.reverse().map((m) => this.paraItem(m, motoristaId)),
      cursorAnterior: temMais ? (pagina[0]?.id ?? null) : null,
      somenteLeitura: conversa.tipo === "AVISOS",
    };
  }

  private paraItem(m: MensagemComAutor, euId: string): MensagemChatItem {
    const apagada = m.apagadaEm !== null;
    const removida = apagada && m.removidaPorId !== null;
    return {
      id: m.id,
      clientId: m.clientId,
      conversaId: m.conversaId,
      autor: m.autor,
      motoristaId: m.motoristaId,
      autorNome: m.autorNome,
      meu: m.autor === "MOTORISTA" && m.motoristaId === euId,
      tipo: m.tipo,
      texto: apagada
        ? m.autor === "ADMIN"
          ? AVISO_REMOVIDO
          : removida
            ? MENSAGEM_REMOVIDA
            : MENSAGEM_APAGADA
        : m.texto,
      audioSegundos: apagada ? null : m.audioSegundos,
      // Passados os 60 dias de retenção o arquivo sai do MinIO e audioKey vira
      // null — a bolha continua, mas só com a transcrição.
      audioDisponivel: !apagada && m.audioKey !== null,
      fotoDisponivel: !apagada && m.fotoKey !== null,
      transcricao: apagada ? null : m.transcricao,
      criadoEm: m.criadoEm.toISOString(),
      apagada,
      // Aviso que a operação tirou do ar não é mensagem moderada.
      removidaPelaOperacao: removida && m.autor !== "ADMIN",
    };
  }

  /**
   * Manda uma mensagem de texto. Idempotente por `clientId`: o outbox do app
   * reenvia depois de timeout, e reenvio não pode virar bolha duplicada.
   */
  async enviar(
    motoristaId: string,
    conversaId: string,
    input: EnviarMensagemChatInput,
  ): Promise<MensagemChatItem> {
    const { conversa } = await this.exigirParticipacao(motoristaId, conversaId);
    if (conversa.tipo === "AVISOS") {
      throw new ForbiddenException("O canal de avisos é só pra leitura.");
    }

    const jaExiste = await this.prisma.mensagemChat.findUnique({
      where: { clientId: input.clientId },
      select: SELECT_MENSAGEM,
    });
    if (jaExiste) return this.paraItem(jaExiste, motoristaId);

    const outros = await this.prisma.conversaParticipante.findMany({
      where: { conversaId, motoristaId: { not: motoristaId } },
      select: { motoristaId: true, silenciado: true },
    });
    const bloqueados = await this.idsBloqueadosNosDoisSentidos(motoristaId);
    if (outros.some((o) => bloqueados.includes(o.motoristaId))) {
      throw new ForbiddenException("Vocês não podem conversar.");
    }

    const eu = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { nome: true },
    });

    const previa = previaDe({ tipo: "TEXTO", texto: input.texto, audioSegundos: null });
    const [mensagem] = await this.prisma.$transaction([
      this.prisma.mensagemChat.create({
        data: {
          clientId: input.clientId,
          conversaId,
          autor: "MOTORISTA",
          motoristaId,
          autorNome: eu?.nome ?? "Motorista",
          tipo: "TEXTO",
          texto: input.texto,
        },
        select: SELECT_MENSAGEM,
      }),
      this.prisma.conversa.update({
        where: { id: conversaId },
        data: { ultimaMensagemEm: new Date(), ultimaMensagemTexto: previa },
      }),
      this.prisma.conversaParticipante.updateMany({
        where: { conversaId, motoristaId: { not: motoristaId } },
        data: { naoLidas: { increment: 1 } },
      }),
    ]);

    // Push é best-effort: a mensagem já está gravada, avisar é bônus.
    for (const o of outros) {
      if (o.silenciado) continue;
      void this.notificar(o.motoristaId, {
        titulo: primeiroNome(eu?.nome ?? "Mensagem nova"),
        corpo: input.texto.slice(0, 160),
        conversaId,
      });
    }

    return this.paraItem(mensagem, motoristaId);
  }

  /**
   * Mensagem de áudio. Espelha `enviar()` — mesma idempotência, mesmo bloqueio,
   * mesmo push — e dispara a transcrição em background.
   *
   * A transcrição NÃO segura a resposta de propósito: o Whisper leva alguns
   * segundos, e o motorista não pode ficar olhando pra um spinner por causa
   * disso. A bolha aparece na hora e o texto preenche embaixo quando ficar
   * pronto (o poll da conversa traz).
   */
  async enviarAudio(
    motoristaId: string,
    conversaId: string,
    input: EnviarAudioChatInput,
  ): Promise<MensagemChatItem> {
    const { conversa } = await this.exigirParticipacao(motoristaId, conversaId);
    if (conversa.tipo === "AVISOS") {
      throw new ForbiddenException("O canal de avisos é só pra leitura.");
    }

    const jaExiste = await this.prisma.mensagemChat.findUnique({
      where: { clientId: input.clientId },
      select: SELECT_MENSAGEM,
    });
    if (jaExiste) return this.paraItem(jaExiste, motoristaId);

    const outros = await this.prisma.conversaParticipante.findMany({
      where: { conversaId, motoristaId: { not: motoristaId } },
      select: { motoristaId: true, silenciado: true },
    });
    const bloqueados = await this.idsBloqueadosNosDoisSentidos(motoristaId);
    if (outros.some((o) => bloqueados.includes(o.motoristaId))) {
      throw new ForbiddenException("Vocês não podem conversar.");
    }

    const eu = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { nome: true },
    });

    const previa = previaDe({
      tipo: "AUDIO",
      texto: null,
      audioSegundos: input.duracaoSegundos,
    });
    const [mensagem] = await this.prisma.$transaction([
      this.prisma.mensagemChat.create({
        data: {
          clientId: input.clientId,
          conversaId,
          autor: "MOTORISTA",
          motoristaId,
          autorNome: eu?.nome ?? "Motorista",
          tipo: "AUDIO",
          audioKey: input.audioKey,
          audioSegundos: input.duracaoSegundos,
        },
        select: SELECT_MENSAGEM,
      }),
      this.prisma.conversa.update({
        where: { id: conversaId },
        data: { ultimaMensagemEm: new Date(), ultimaMensagemTexto: previa },
      }),
      this.prisma.conversaParticipante.updateMany({
        where: { conversaId, motoristaId: { not: motoristaId } },
        data: { naoLidas: { increment: 1 } },
      }),
    ]);

    void this.transcreverEmBackground(mensagem.id, input.audioKey);

    for (const o of outros) {
      if (o.silenciado) continue;
      void this.notificar(o.motoristaId, {
        titulo: primeiroNome(eu?.nome ?? "Mensagem nova"),
        corpo: previa,
        conversaId,
      });
    }

    return this.paraItem(mensagem, motoristaId);
  }

  /**
   * Baixa o áudio do MinIO e grava a transcrição na mensagem. Best-effort: se
   * o Whisper falhar ou não estiver configurado, o áudio continua tocando —
   * só fica sem o texto embaixo.
   */
  private async transcreverEmBackground(mensagemId: string, audioKey: string): Promise<void> {
    try {
      if (!this.transcricao.configurado) return;
      const buffer = await this.uploads.getObjectBuffer(audioKey);
      const ext = audioKey.split(".").pop()?.toLowerCase() ?? "m4a";
      const mimetype =
        ext === "mp3"
          ? "audio/mpeg"
          : ext === "ogg"
            ? "audio/ogg"
            : ext === "webm"
              ? "audio/webm"
              : "audio/m4a";
      const r = await this.transcricao.transcreverBuffer(buffer, mimetype, `audio.${ext}`);
      if (!r.texto) return;
      // A mensagem pode ter sido apagada enquanto o Whisper rodava — não
      // ressuscita o conteúdo de uma bolha já removida.
      const atual = await this.prisma.mensagemChat.findUnique({
        where: { id: mensagemId },
        select: { apagadaEm: true },
      });
      if (!atual || atual.apagadaEm) return;
      await this.prisma.mensagemChat.update({
        where: { id: mensagemId },
        data: { transcricao: r.texto },
      });
    } catch (e) {
      this.log.warn(`Transcrição do áudio ${mensagemId} falhou: ${e}`);
    }
  }

  /**
   * Bytes do áudio pra tocar no app. Passa pela MESMA checagem de participação
   * das mensagens: sem isso, qualquer motorista com o id da mensagem ouviria
   * conversa alheia — a URL seria a porta dos fundos do gate de privacidade.
   */
  async audioBuffer(
    motoristaId: string,
    mensagemId: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const m = await this.prisma.mensagemChat.findUnique({
      where: { id: mensagemId },
      select: { conversaId: true, audioKey: true, apagadaEm: true },
    });
    if (!m?.audioKey || m.apagadaEm) throw new NotFoundException("Áudio não disponível.");
    await this.exigirParticipacao(motoristaId, m.conversaId);
    const buffer = await this.uploads.getObjectBuffer(m.audioKey);
    const ext = m.audioKey.split(".").pop()?.toLowerCase();
    const contentType =
      ext === "mp3"
        ? "audio/mpeg"
        : ext === "ogg"
          ? "audio/ogg"
          : ext === "webm"
            ? "audio/webm"
            : "audio/mp4";
    return { buffer, contentType };
  }

  /**
   * Bytes da foto de um aviso. Mesma checagem de participação do áudio: a URL
   * não pode ser a porta dos fundos do canal.
   */
  async fotoBuffer(
    motoristaId: string,
    mensagemId: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const m = await this.prisma.mensagemChat.findUnique({
      where: { id: mensagemId },
      select: { conversaId: true, fotoKey: true, apagadaEm: true },
    });
    if (!m?.fotoKey || m.apagadaEm) throw new NotFoundException("Foto não disponível.");
    await this.exigirParticipacao(motoristaId, m.conversaId);
    const buffer = await this.uploads.getObjectBuffer(m.fotoKey);
    const ext = m.fotoKey.split(".").pop()?.toLowerCase();
    return { buffer, contentType: ext === "png" ? "image/png" : "image/jpeg" };
  }

  private async notificar(
    destinoId: string,
    args: { titulo: string; corpo: string; conversaId: string },
  ): Promise<void> {
    try {
      const destino = await this.prisma.motorista.findUnique({
        where: { id: destinoId },
        select: { expoPushToken: true },
      });
      if (!destino?.expoPushToken) return;
      await this.push.enviar({
        motoristaId: destinoId,
        token: destino.expoPushToken,
        titulo: args.titulo,
        corpo: args.corpo,
        tipo: "chat-mensagem",
        dados: { kind: "chat-mensagem", conversaId: args.conversaId },
        criadoPorId: null,
        // Mensagem de chat não vira item do sininho — tem lugar próprio.
        persistir: false,
      });
    } catch (e) {
      this.log.warn(`Push de chat falhou pra ${destinoId}: ${e}`);
    }
  }

  /** Zera o contador da conversa (o motorista abriu a tela). */
  async marcarLida(motoristaId: string, conversaId: string): Promise<void> {
    await this.exigirParticipacao(motoristaId, conversaId);
    await this.prisma.conversaParticipante.updateMany({
      where: { conversaId, motoristaId },
      data: { naoLidas: 0, ultimaLeituraEm: new Date() },
    });
  }

  async silenciar(
    motoristaId: string,
    conversaId: string,
    silenciado: boolean,
  ): Promise<void> {
    await this.exigirParticipacao(motoristaId, conversaId);
    await this.prisma.conversaParticipante.updateMany({
      where: { conversaId, motoristaId },
      data: { silenciado },
    });
  }

  /**
   * Poll leve: o que mudou desde `desde`. É o que faz a mensagem do outro
   * brotar na tela sem o motorista puxar pra atualizar — chamado só enquanto
   * a conversa está aberta. Fora dela, quem avisa é a push.
   */
  async novidades(
    motoristaId: string,
    desde?: string,
    conversaId?: string,
  ): Promise<NovidadesChatResponse> {
    const agora = new Date();
    const corte = desde ? new Date(desde) : null;
    const corteValido = corte && !Number.isNaN(corte.getTime()) ? corte : null;

    const participacoes = await this.prisma.conversaParticipante.findMany({
      where: { motoristaId },
      select: { conversaId: true, naoLidas: true },
    });
    const minhas = participacoes.map((p) => p.conversaId);
    const totalNaoLidas = participacoes.reduce((acc, p) => acc + p.naoLidas, 0);

    if (minhas.length === 0) {
      return { agora: agora.toISOString(), totalNaoLidas: 0, mensagens: [], conversasAtualizadas: [] };
    }

    // Sem `desde` o app está só perguntando o badge — não devolve histórico.
    if (!corteValido) {
      return {
        agora: agora.toISOString(),
        totalNaoLidas,
        mensagens: [],
        conversasAtualizadas: [],
      };
    }

    const novas = await this.prisma.mensagemChat.findMany({
      where: {
        conversaId: conversaId && minhas.includes(conversaId) ? conversaId : { in: minhas },
        criadoEm: { gt: corteValido },
      },
      orderBy: { criadoEm: "asc" },
      take: MAX_NOVIDADES,
      select: SELECT_MENSAGEM,
    });

    const daConversaAberta = conversaId
      ? novas.filter((m) => m.conversaId === conversaId)
      : [];

    return {
      agora: agora.toISOString(),
      totalNaoLidas,
      mensagens: daConversaAberta.map((m) => this.paraItem(m, motoristaId)),
      conversasAtualizadas: [...new Set(novas.map((m) => m.conversaId))],
    };
  }

  /** Apagar pra todos — só o autor, e só o que ainda não foi apagado. */
  async apagarMensagem(motoristaId: string, mensagemId: string): Promise<void> {
    const m = await this.prisma.mensagemChat.findUnique({
      where: { id: mensagemId },
      select: { id: true, motoristaId: true, apagadaEm: true, conversaId: true, audioKey: true },
    });
    if (!m) throw new NotFoundException("Mensagem não encontrada.");
    if (m.motoristaId !== motoristaId) {
      throw new ForbiddenException("Você só apaga as suas mensagens.");
    }
    if (m.apagadaEm) return;
    // Tira o arquivo do MinIO junto: zerar só a coluna deixaria o áudio órfão
    // no bucket pra sempre, sem nenhuma linha apontando pra ele.
    if (m.audioKey) {
      await this.uploads.removeObject(m.audioKey).catch(() => {
        /* já pode ter sumido — não trava o apagar */
      });
    }
    await this.prisma.mensagemChat.update({
      where: { id: mensagemId },
      data: { apagadaEm: new Date(), texto: null, audioKey: null, transcricao: null },
    });
    await this.recalcularPrevia(m.conversaId);
  }

  /** Reescreve a prévia da lista depois de apagar a última mensagem. */
  private async recalcularPrevia(conversaId: string): Promise<void> {
    const ultima = await this.prisma.mensagemChat.findFirst({
      where: { conversaId },
      orderBy: { criadoEm: "desc" },
      select: { tipo: true, texto: true, audioSegundos: true, apagadaEm: true, criadoEm: true },
    });
    await this.prisma.conversa.update({
      where: { id: conversaId },
      data: {
        ultimaMensagemEm: ultima?.criadoEm ?? null,
        ultimaMensagemTexto: ultima
          ? ultima.apagadaEm
            ? MENSAGEM_APAGADA
            : previaDe(ultima)
          : null,
      },
    });
  }

  // ── Bloqueio e denúncia (exigência de loja pra conteúdo entre usuários) ────

  async bloquear(motoristaId: string, alvoId: string): Promise<void> {
    if (alvoId === motoristaId) {
      throw new BadRequestException("Não dá pra bloquear você mesmo.");
    }
    await this.prisma.bloqueioChat.upsert({
      where: { motoristaId_bloqueadoId: { motoristaId, bloqueadoId: alvoId } },
      create: { motoristaId, bloqueadoId: alvoId },
      update: {},
    });
  }

  async desbloquear(motoristaId: string, alvoId: string): Promise<void> {
    await this.prisma.bloqueioChat.deleteMany({
      where: { motoristaId, bloqueadoId: alvoId },
    });
  }

  async listarBloqueios(motoristaId: string): Promise<{ motoristaId: string; nome: string }[]> {
    const linhas = await this.prisma.bloqueioChat.findMany({
      where: { motoristaId },
      include: { bloqueado: { select: { id: true, nome: true } } },
      orderBy: { criadoEm: "desc" },
    });
    return linhas.map((b) => ({ motoristaId: b.bloqueado.id, nome: b.bloqueado.nome }));
  }

  /**
   * Denúncia. Único caminho pelo qual uma conversa privada chega aos olhos da
   * operação — e só a mensagem denunciada mais o contexto ao redor dela.
   */
  async denunciar(
    motoristaId: string,
    mensagemId: string,
    input: DenunciarMensagemInput,
  ): Promise<void> {
    const m = await this.prisma.mensagemChat.findUnique({
      where: { id: mensagemId },
      select: { id: true, conversaId: true, motoristaId: true },
    });
    if (!m) throw new NotFoundException("Mensagem não encontrada.");
    await this.exigirParticipacao(motoristaId, m.conversaId);
    if (m.motoristaId === motoristaId) {
      throw new BadRequestException("Não dá pra denunciar a própria mensagem.");
    }
    await this.prisma.denunciaMensagemChat.upsert({
      where: { mensagemId_denuncianteId: { mensagemId, denuncianteId: motoristaId } },
      create: {
        mensagemId,
        denuncianteId: motoristaId,
        motivo: input.motivo,
        detalhe: input.detalhe ?? null,
      },
      update: { motivo: input.motivo, detalhe: input.detalhe ?? null, status: "ABERTA" },
    });
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  /** 403 se a conversa não é minha. Toda leitura/escrita passa por aqui. */
  private async exigirParticipacao(motoristaId: string, conversaId: string) {
    const participacao = await this.prisma.conversaParticipante.findFirst({
      where: { conversaId, motoristaId },
      include: {
        conversa: {
          include: {
            participantes: {
              where: { motoristaId: { not: motoristaId } },
              include: { motorista: { select: { id: true, nome: true } } },
            },
          },
        },
      },
    });
    if (!participacao) throw new ForbiddenException("Essa conversa não é sua.");
    return { participacao, conversa: participacao.conversa };
  }

  /**
   * Canal de Avisos: uma conversa só, criada na primeira necessidade. Não usa
   * `chaveDireta` (é null no canal), então a unicidade é garantida pelo tipo.
   */
  async garantirCanalAvisos(): Promise<string> {
    const existente = await this.prisma.conversa.findFirst({
      where: { tipo: "AVISOS" },
      select: { id: true },
    });
    if (existente) return existente.id;
    const nova = await this.prisma.conversa.create({
      data: { tipo: "AVISOS" },
      select: { id: true },
    });
    return nova.id;
  }

  private async garantirParticipacaoAvisos(motoristaId: string): Promise<void> {
    const canalId = await this.garantirCanalAvisos();
    const ja = await this.prisma.conversaParticipante.findFirst({
      where: { conversaId: canalId, motoristaId },
      select: { id: true },
    });
    if (ja) return;
    await this.prisma.conversaParticipante.create({
      data: { conversaId: canalId, motoristaId },
    });
  }
}
