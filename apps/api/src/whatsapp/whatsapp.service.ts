import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ErrorsService } from "../errors/errors.service";
import { AgenteService } from "./agente/agente.service";
import { EvolutionClientService } from "./evolution-client.service";
import { EnvioWhatsappService } from "./envio/envio-whatsapp.service";
import { SessaoService } from "./sessao.service";
import { ConviteService } from "./convite.service";
import { TranscricaoService } from "../ia/transcricao.service";
import { comConta, contaIdAtual } from "../common/conta/conta-context";

type MensagemTipo = "TEXTO" | "IMAGEM" | "AUDIO";

/**
 * Resposta padrão quando o agente está desligado (ConfiguracaoAgente.ativo=false).
 * Tom de parceria: esse número hoje serve só pra envios automáticos (avisos +
 * código de cadastro). Admin pode customizar via mensagemInativo na tela.
 */
const MENSAGEM_AGENTE_INATIVO =
  "Oi! 👋 Esse número é só pra envios automáticos (avisos e código de cadastro). " +
  "Pra registrar suas viagens, use o app. Qualquer dúvida, fala com o escritório!";

/**
 * Orquestrador da Fase 1: recebe webhook, identifica perfil, lida com fluxo
 * de vinculação (telefone novo) e responde ping/pong simples. A partir da
 * Fase 2, mensagens de telefone JÁ VINCULADO vão pra AgenteService (Claude
 * com tools).
 */
@Injectable()
export class WhatsappService {
  private readonly log = new Logger("WhatsappService");

  constructor(
    private readonly prisma: PrismaService,
    // Só pro download de mídia — a Cloud API baixa de outro jeito, e é o
    // provedor de entrada quem decide. Enviar é sempre pelo `envio`.
    private readonly evolution: EvolutionClientService,
    private readonly envio: EnvioWhatsappService,
    private readonly sessao: SessaoService,
    private readonly convite: ConviteService,
    private readonly agente: AgenteService,
    private readonly transcricao: TranscricaoService,
    private readonly errors: ErrorsService,
  ) {}

  /**
   * Reporta erro de fluxo WhatsApp pro error_logs (aparece em /admin/errors) +
   * stack barulhento no console (Easypanel logs). Nunca lança — falha do
   * reportar é só warn no logger.
   */
  private async reportarErro(
    e: unknown,
    contexto: {
      fase: string;
      telefone?: string;
      identidadeNome?: string | null;
      conteudoEntrada?: string;
      tipoMidia?: string;
      toolName?: string;
    },
  ): Promise<void> {
    const err = e instanceof Error ? e : new Error(String(e));
    const msg = err.message || "erro sem mensagem";
    // STDOUT barulhento — facilita grep no Easypanel
    this.log.error(
      `[whatsapp:erro] fase=${contexto.fase} ${contexto.toolName ? `tool=${contexto.toolName} ` : ""}telefone=${contexto.telefone ?? "?"} msg=${msg}`,
    );
    if (err.stack) this.log.error(err.stack);
    try {
      await this.errors.reportar({
        origem: "api",
        message: `[whatsapp:${contexto.fase}] ${msg}`,
        stack: err.stack,
        extra: {
          canal: "whatsapp",
          fase: contexto.fase,
          telefone: contexto.telefone ?? null,
          identidadeNome: contexto.identidadeNome ?? null,
          conteudoEntrada: contexto.conteudoEntrada?.slice(0, 500) ?? null,
          tipoMidia: contexto.tipoMidia ?? null,
          toolName: contexto.toolName ?? null,
        },
      });
    } catch (logErr) {
      this.log.warn(`Falhou ao registrar erro no error_logs: ${(logErr as Error).message}`);
    }
  }

  /**
   * Processa um evento de mensagem recebida do Evolution.
   * Estrutura do payload (event=messages.upsert):
   * {
   *   data: {
   *     key: { id, remoteJid, fromMe },
   *     message: { conversation?, imageMessage?, audioMessage? },
   *     pushName,
   *   }
   * }
   */
  async processarMensagemRecebida(payload: any): Promise<void> {
    const data = payload?.data;
    if (!data || data.key?.fromMe) return; // ignora mensagens enviadas pela própria instância

    const remoteJid: string | undefined = data.key?.remoteJid;
    if (!remoteJid || remoteJid.endsWith("@g.us")) return; // ignora grupos

    const telefone = SessaoService.normalizar(remoteJid.split("@")[0]!);
    const { texto, tipo } = extrairConteudo(data);

    if (!texto && tipo === "TEXTO") return; // mensagem vazia/desconhecida

    // Antes de tocar em qualquer dado é preciso saber de QUAL EMPRESA é esta
    // mensagem — o número sozinho não diz, porque o mesmo motorista pode rodar
    // pra mais de uma. É a sessão que revela, e ela é buscada sem filtro (igual
    // ao login). Daqui pra frente tudo roda dentro da conta dele.
    let identidade: Awaited<ReturnType<SessaoService["resolverPorTelefone"]>>;
    try {
      identidade = await this.sessao.resolverPorTelefone(telefone);
    } catch (e) {
      // Sem conta resolvida não dá nem pra gravar o erro (error_logs é da conta).
      this.log.error(`Falha ao resolver o telefone ${telefone}: ${(e as Error).message}`);
      return;
    }

    // Número que ainda não está vinculado a ninguém: quem revela a empresa é o
    // CÓDIGO DE CONVITE que ele mandou. Sem código não há como saber de quem é a
    // mensagem — e responder "de qual empresa?" seria pior que o silêncio,
    // porque a resposta em si já teria que ser gravada em alguma conta.
    const contaId =
      identidade.contaId ??
      (tipo === "TEXTO" ? await this.convite.contaDoCodigo(texto ?? "") : null);
    if (contaId === null) {
      this.log.warn(`Mensagem de ${telefone} sem vínculo e sem código — ignorada.`);
      return;
    }

    return comConta(contaId, () =>
      this.processarDaEmpresa(data, telefone, texto, tipo, identidade),
    );
  }

  private async processarDaEmpresa(
    data: any,
    telefone: string,
    texto: string | null,
    tipo: MensagemTipo,
    identidade: Awaited<ReturnType<SessaoService["resolverPorTelefone"]>>,
  ): Promise<void> {
    // Estado capturado pra contexto de erro — preenchido conforme avança no fluxo
    const evolutionMessageId = data.key?.id ?? null;
    let textoEntrada = texto ?? "";
    let faseAtual = "sessao";

    try {
      // Carimba a hora da mensagem ANTES de qualquer decisão. É o que registra
      // que a pessoa falou com a gente — e portanto que a janela de 24h da Meta
      // está aberta, dentro da qual dá pra responder texto livre de graça.
      //
      // Ficava lá embaixo, depois do `return` do agente desligado. Como o agente
      // nasce desligado (e em produção está desligado), na prática o campo nunca
      // era escrito e a janela era invisível.
      if (identidade.sessaoId) {
        await this.sessao.marcarMensagemRecebida(identidade.sessaoId);
      }

      // Agente desligado na config → não gasta IA (sem Whisper, sem Claude/Gemini).
      // Loga a entrada e responde educado. Vale pra qualquer remetente: hoje esse
      // número serve só pra enviar código de cadastro (outbound, fora deste fluxo).
      const cfgAgente = await this.prisma.configuracaoAgente.upsert({
        where: { contaId: contaIdAtual() },
        update: {},
        create: {},
      });
      if (!cfgAgente.ativo) {
        faseAtual = "agente_desligado";
        await this.prisma.whatsappMensagem.create({
          data: {
            sessaoId: identidade.sessaoId,
            telefone,
            direcao: "ENTRADA",
            conteudo: textoEntrada,
            tipo,
            metadata: {
              evolutionMsgId: evolutionMessageId,
              pushName: data.pushName ?? null,
              agenteDesligado: true,
            },
          },
        });
        await this.enviarTexto(
          telefone,
          cfgAgente.mensagemInativo?.trim() || MENSAGEM_AGENTE_INATIVO,
          identidade.sessaoId,
        );
        return;
      }

      // Áudio: transcreve via Whisper antes de logar — assim conteudo persiste
      // já com o texto entendido, sem retranscrever pra montar histórico depois.
      // Só transcreve pra telefone vinculado (poupa custo de DESCONHECIDO).
      let metadataTranscricao: Record<string, unknown> | null = null;
      if (tipo === "AUDIO" && identidade.tipo !== "DESCONHECIDO") {
        faseAtual = "transcricao";
        // Baixa da Evolution aqui: o serviço de transcrição é genérico e só
        // recebe o buffer (o chat do app usa o mesmo, vindo do MinIO).
        const midia = await this.evolution.baixarMidia({ key: data.key, message: data.message });
        const r = midia
          ? await this.transcricao.transcreverBuffer(midia.buffer, midia.mimetype)
          : { texto: "", modelo: "whisper-1", erro: "Falha ao baixar áudio" };
        textoEntrada = r.texto;
        metadataTranscricao = {
          origem: "audio_transcrito",
          modelo: r.modelo,
          erro: r.erro ?? null,
        };
        // Se Whisper falhou (HTTP, key ausente, etc), reporta — mas NÃO crash:
        // ainda mandamos resposta amigável abaixo.
        if (r.erro && r.erro !== "Áudio sem fala (silêncio/ruído)") {
          await this.reportarErro(new Error(`Transcrição falhou: ${r.erro}`), {
            fase: "transcricao",
            telefone,
            identidadeNome: nomeDeIdentidade(identidade),
            tipoMidia: "audio",
          });
        }
      }

      faseAtual = "log_entrada";
      await this.prisma.whatsappMensagem.create({
        data: {
          sessaoId: identidade.sessaoId,
          telefone,
          direcao: "ENTRADA",
          conteudo: textoEntrada,
          tipo,
          metadata: {
            evolutionMsgId: evolutionMessageId,
            pushName: data.pushName ?? null,
            ...(metadataTranscricao ?? {}),
          },
        },
      });

      // Telefone desconhecido → fluxo de vinculação
      if (identidade.tipo === "DESCONHECIDO") {
        faseAtual = "vinculacao";
        await this.tratarDesconhecido(telefone, textoEntrada, tipo);
        return;
      }

      // (a atividade da sessão já foi marcada no início do fluxo)

      // Áudio sem transcrição (chave faltando, falha, alucinação) → avisa o
      // motorista em vez de mandar string vazia pro agente.
      if (tipo === "AUDIO" && !textoEntrada.trim()) {
        await this.enviarTexto(
          telefone,
          "Não consegui entender o áudio. Tenta mandar de novo (falando mais perto) ou escreve por favor.",
          identidade.sessaoId,
        );
        return;
      }

      // Atalhos rápidos (não gasta token IA)
      const txt = textoEntrada.trim().toLowerCase();
      if (txt === "ping") {
        await this.enviarTexto(telefone, "pong 🏓", identidade.sessaoId);
        return;
      }
      if (txt === "sair" || txt === "desvincular") {
        await this.sessao.desvincular(identidade.sessaoId);
        await this.enviarTexto(
          telefone,
          "Pronto, você foi desvinculado(a). Pra voltar, peça outro código de convite ao admin.",
        );
        return;
      }

      // Tudo o resto vai pro agente IA
      faseAtual = "agente";
      const sessaoId = identidade.sessaoId;
      try {
        const resposta = await this.agente.processar(identidade, textoEntrada, {
          evolutionMessageId: evolutionMessageId ?? undefined,
          tipoMidia: tipo === "IMAGEM" ? "imagem" : tipo === "AUDIO" ? "audio" : undefined,
          telefoneRemetente: telefone,
          // Payload bruto da mensagem (key + message) — necessário pra baixar mídia
          // sem depender de DATABASE_SAVE_DATA_NEW_MESSAGE no Evolution
          evolutionPayload: tipo === "IMAGEM" || tipo === "AUDIO"
            ? { key: data.key, message: data.message }
            : undefined,
        });
        // Modelo pode terminar sem texto (ex: depois de oferecer_opcoes, a tool
        // já mandou os botões — texto adicional só duplicaria).
        if (resposta && resposta.trim()) {
          await this.enviarTexto(telefone, resposta, sessaoId);
        }
      } catch (e) {
        const toolName = (e as { toolName?: string }).toolName;
        const transitorio = (e as { transitorio?: boolean }).transitorio === true;
        await this.reportarErro(e, {
          fase: toolName ? `agente:tool:${toolName}` : "agente",
          telefone,
          identidadeNome: nomeDeIdentidade(identidade),
          conteudoEntrada: textoEntrada,
          tipoMidia: tipo === "IMAGEM" ? "imagem" : tipo === "AUDIO" ? "audio" : undefined,
          toolName,
        });
        // Erros transitórios (Gemini sobrecarregado, rate limit) merecem
        // mensagem amigável diferente do erro genérico de "deu pau".
        const msgPraMotorista = transitorio
          ? "Tô sobrecarregado agora 😴 (servidor da IA com fila). Tenta de novo daqui 1 minuto."
          : "Tive um problema processando sua mensagem. Tenta de novo, ou manda 'ajuda'.";
        await this.enviarTexto(telefone, msgPraMotorista, sessaoId);
      }
    } catch (e) {
      // Catch-all: erros fora do bloco do agente (extração, sessão,
      // transcrição, log_entrada, vinculação). Tudo registra em error_logs.
      await this.reportarErro(e, {
        fase: faseAtual,
        telefone,
        identidadeNome: identidade ? nomeDeIdentidade(identidade) : null,
        conteudoEntrada: textoEntrada,
        tipoMidia: tipo === "IMAGEM" ? "imagem" : tipo === "AUDIO" ? "audio" : undefined,
      });
      // Tenta mandar fallback amigável se sabemos o telefone — não bloqueia se falhar.
      try {
        await this.enviarTexto(
          telefone,
          "Tive um problema interno aqui. O admin já foi avisado — tenta de novo em alguns minutos.",
          identidade?.sessaoId ?? null,
        );
      } catch {
        /* swallow — não dá pra fazer mais nada */
      }
    }
  }

  async enviarTexto(telefone: string, texto: string, sessaoId: string | null = null) {
    // O erro é engolido de propósito: isto roda dentro do webhook, e uma falha
    // de envio não pode derrubar o processamento da mensagem. A linha de SAIDA
    // é gravada pela própria fachada, inclusive quando o envio não sai — o
    // histórico do agente é montado a partir dela.
    await this.envio.tentarEnviar({
      destino: { tipo: "TELEFONE", numero: telefone },
      rota: "RESPOSTA_AGENTE",
      texto,
      sessaoId,
    });
  }

  private async tratarDesconhecido(telefone: string, texto: string, tipo: MensagemTipo) {
    if (tipo !== "TEXTO") {
      await this.enviarTexto(
        telefone,
        "Olá! Pra usar esse canal você precisa vincular sua conta. Pede pro admin gerar um código de convite no painel e me envia aqui.",
      );
      return;
    }

    // Tenta interpretar como código de convite (4-8 chars alfanuméricos)
    const possivelCodigo = texto.trim().toUpperCase();
    if (/^[A-Z0-9]{4,8}$/.test(possivelCodigo)) {
      try {
        const sessao = await this.convite.consumir(possivelCodigo, telefone);
        const nome = sessao.motorista?.nome ?? sessao.user?.nome ?? "amigo";
        const tipoStr = sessao.motoristaId ? "motorista" : "admin";
        await this.enviarTexto(
          telefone,
          `Beleza, ${nome}! Você foi vinculado(a) como ${tipoStr}. Manda "ajuda" pra ver o que dá pra fazer.`,
          sessao.id,
        );
        return;
      } catch (e) {
        await this.enviarTexto(telefone, `Não rolou: ${(e as Error).message}`);
        return;
      }
    }

    // Mensagem genérica
    await this.enviarTexto(
      telefone,
      "Olá! Pra usar esse canal você precisa vincular sua conta.\n\nPede pro admin gerar um código de convite no painel e me envia o código aqui (algo tipo `A3F7K9`).",
    );
  }


  async historicoRecente(sessaoId: string, limit = 50) {
    return this.prisma.whatsappMensagem.findMany({
      where: { sessaoId },
      orderBy: { criadoEm: "desc" },
      take: limit,
    });
  }
}

function nomeDeIdentidade(
  identidade: { tipo: "MOTORISTA"; nome: string }
    | { tipo: "ADMIN"; nome: string }
    | { tipo: "DESCONHECIDO" }
    | null,
): string | null {
  if (!identidade) return null;
  if (identidade.tipo === "DESCONHECIDO") return null;
  return identidade.nome;
}

function extrairConteudo(data: any): { texto: string | null; tipo: MensagemTipo } {
  const m = data?.message;
  if (!m) return { texto: null, tipo: "TEXTO" };
  if (typeof m.conversation === "string") return { texto: m.conversation, tipo: "TEXTO" };
  if (typeof m.extendedTextMessage?.text === "string") {
    return { texto: m.extendedTextMessage.text, tipo: "TEXTO" };
  }
  if (m.imageMessage) return { texto: m.imageMessage.caption ?? "", tipo: "IMAGEM" };
  if (m.audioMessage) return { texto: "", tipo: "AUDIO" };
  // Botão clicado (resposta de oferecer_opcoes): vira "[OPÇÃO] <texto>"
  // pra fluir pro agente como se fosse mensagem de texto.
  const botao =
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    m.interactiveResponseMessage?.body?.text ??
    null;
  if (typeof botao === "string" && botao.trim()) {
    return { texto: botao.trim(), tipo: "TEXTO" };
  }
  // Localização (clipe → Localização → "Enviar localização atual"
  // ou "Compartilhar localização em tempo real"). Vira marcador no texto pra
  // o agente reconhecer e chamar `local_mais_proximo`.
  const loc = m.locationMessage ?? m.liveLocationMessage;
  if (loc && typeof loc.degreesLatitude === "number" && typeof loc.degreesLongitude === "number") {
    const lat = loc.degreesLatitude.toFixed(6);
    const lng = loc.degreesLongitude.toFixed(6);
    const captionExtra = typeof loc.name === "string" && loc.name.trim() ? ` (${loc.name.trim()})` : "";
    return {
      texto: `[localização: ${lat}, ${lng}]${captionExtra}`,
      tipo: "TEXTO",
    };
  }
  return { texto: null, tipo: "TEXTO" };
}
