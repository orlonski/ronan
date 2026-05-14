import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AgenteService } from "./agente/agente.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";
import { ConviteService } from "./convite.service";
import { TranscricaoService } from "./transcricao.service";

type MensagemTipo = "TEXTO" | "IMAGEM" | "AUDIO";

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
    private readonly evolution: EvolutionClientService,
    private readonly sessao: SessaoService,
    private readonly convite: ConviteService,
    private readonly agente: AgenteService,
    private readonly transcricao: TranscricaoService,
  ) {}

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

    // Resolve identidade
    const identidade = await this.sessao.resolverPorTelefone(telefone);

    const evolutionMessageId = data.key?.id ?? null;

    // Áudio: transcreve via Whisper antes de logar — assim conteudo persiste
    // já com o texto entendido, sem retranscrever pra montar histórico depois.
    // Só transcreve pra telefone vinculado (poupa custo de DESCONHECIDO).
    let textoEntrada = texto ?? "";
    let metadataTranscricao: Record<string, unknown> | null = null;
    if (tipo === "AUDIO" && identidade.tipo !== "DESCONHECIDO") {
      const r = await this.transcricao.transcrever({ key: data.key, message: data.message });
      textoEntrada = r.texto;
      metadataTranscricao = {
        origem: "audio_transcrito",
        modelo: r.modelo,
        erro: r.erro ?? null,
      };
    }

    // Loga entrada
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
      await this.tratarDesconhecido(telefone, textoEntrada, tipo);
      return;
    }

    // Telefone vinculado → marca atividade
    await this.sessao.marcarMensagemRecebida(identidade.sessaoId);

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
    try {
      const resposta = await this.agente.processar(identidade, textoEntrada, {
        evolutionMessageId: evolutionMessageId ?? undefined,
        tipoMidia: tipo === "IMAGEM" ? "imagem" : tipo === "AUDIO" ? "audio" : undefined,
        // Payload bruto da mensagem (key + message) — necessário pra baixar mídia
        // sem depender de DATABASE_SAVE_DATA_NEW_MESSAGE no Evolution
        evolutionPayload: tipo === "IMAGEM" || tipo === "AUDIO"
          ? { key: data.key, message: data.message }
          : undefined,
      });
      await this.enviarTexto(telefone, resposta, identidade.sessaoId);
    } catch (e) {
      this.log.error(`Agente falhou: ${(e as Error).message}`);
      await this.enviarTexto(
        telefone,
        "Tive um problema processando sua mensagem. Tenta de novo, ou manda 'ajuda'.",
        identidade.sessaoId,
      );
    }
  }

  async enviarTexto(telefone: string, texto: string, sessaoId: string | null = null) {
    if (this.evolution.configurado) {
      try {
        await this.evolution.enviarTexto(telefone, texto);
      } catch (e) {
        this.log.error(`Falha ao enviar pra ${telefone}: ${(e as Error).message}`);
      }
    } else {
      this.log.log(`[DEV] enviaria pra ${telefone}: ${texto}`);
    }
    await this.prisma.whatsappMensagem.create({
      data: {
        sessaoId,
        telefone,
        direcao: "SAIDA",
        conteudo: texto,
        tipo: "TEXTO",
      },
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
        const tipoStr = sessao.motoristaId ? "motorista" : sessao.user?.perfil ?? "admin";
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

function extrairConteudo(data: any): { texto: string | null; tipo: MensagemTipo } {
  const m = data?.message;
  if (!m) return { texto: null, tipo: "TEXTO" };
  if (typeof m.conversation === "string") return { texto: m.conversation, tipo: "TEXTO" };
  if (typeof m.extendedTextMessage?.text === "string") {
    return { texto: m.extendedTextMessage.text, tipo: "TEXTO" };
  }
  if (m.imageMessage) return { texto: m.imageMessage.caption ?? "", tipo: "IMAGEM" };
  if (m.audioMessage) return { texto: "", tipo: "AUDIO" };
  return { texto: null, tipo: "TEXTO" };
}
