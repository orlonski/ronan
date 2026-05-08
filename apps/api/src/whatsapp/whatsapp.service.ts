import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";
import { ConviteService } from "./convite.service";

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

    // Loga entrada
    await this.prisma.whatsappMensagem.create({
      data: {
        sessaoId: identidade.sessaoId,
        telefone,
        direcao: "ENTRADA",
        conteudo: texto ?? "",
        tipo,
        metadata: { evolutionMsgId: data.key?.id ?? null, pushName: data.pushName ?? null },
      },
    });

    // Telefone desconhecido → fluxo de vinculação
    if (identidade.tipo === "DESCONHECIDO") {
      await this.tratarDesconhecido(telefone, texto ?? "", tipo);
      return;
    }

    // Telefone vinculado → marca atividade
    await this.sessao.marcarMensagemRecebida(identidade.sessaoId);

    // Fase 1: ping/pong simples + comandos básicos. Fase 2 conecta o agente IA.
    await this.tratarVinculado(telefone, texto ?? "", tipo, identidade);
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

  private async tratarVinculado(
    telefone: string,
    texto: string,
    tipo: MensagemTipo,
    identidade: Exclude<Awaited<ReturnType<SessaoService["resolverPorTelefone"]>>, { tipo: "DESCONHECIDO" }>,
  ) {
    const txt = texto.trim().toLowerCase();

    if (tipo !== "TEXTO") {
      await this.enviarTexto(
        telefone,
        "Por enquanto só processo mensagens de texto. Mídia/áudio em breve!",
        identidade.sessaoId,
      );
      return;
    }

    if (txt === "ping") {
      await this.enviarTexto(telefone, "pong 🏓", identidade.sessaoId);
      return;
    }

    if (txt === "ajuda" || txt === "help" || txt === "?") {
      const texto =
        identidade.tipo === "MOTORISTA"
          ? `Olá ${identidade.nome}! Em breve você vai poder lançar viagens por aqui. Por enquanto:\n• "ping" — testa conexão\n• "sair" — desvincula esse número`
          : `Olá ${identidade.nome}! Em breve você vai poder consultar o dashboard por aqui. Por enquanto:\n• "ping" — testa conexão\n• "sair" — desvincula esse número`;
      await this.enviarTexto(telefone, texto, identidade.sessaoId);
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

    // Default Fase 1 — Fase 2 substitui isso por chamada ao AgenteService
    await this.enviarTexto(
      telefone,
      `Recebi: "${texto.slice(0, 100)}". Em breve eu vou entender mensagens livres com IA. Por enquanto manda "ajuda".`,
      identidade.sessaoId,
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
