import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  DenunciaChatAdmin,
  MotivoDenuncia,
  PublicarAvisoInput,
  ResolverDenunciaInput,
} from "@ronan/shared-types";
import { contaIdAtual } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import { UploadsService } from "../uploads/uploads.service";
import { ChatService } from "./chat.service";

/** Quantas mensagens ao redor da denunciada acompanham a denúncia. */
const CONTEXTO_ANTES = 4;

/** Story dura 24h, igual ao do motorista. */
const DURACAO_STORY_MS = 24 * 60 * 60 * 1000;

/** Teto da legenda do story (o aviso pode ser bem mais longo que isso). */
const MAX_LEGENDA_STORY = 140;

/** Legenda do story a partir do texto do aviso, sem cortar no meio da palavra. */
function legendaDoAviso(texto: string): string {
  const t = texto.trim();
  if (t.length <= MAX_LEGENDA_STORY) return t;
  const corte = t.slice(0, MAX_LEGENDA_STORY - 1);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > 60 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/**
 * O lado da operação no chat: publicar aviso no canal e tratar denúncia.
 *
 * O que NÃO existe aqui, de propósito: qualquer forma de ler conversa de
 * motorista com motorista. O painel só enxerga o canal de Avisos (que ele
 * mesmo escreve) e o trecho que alguém denunciou. Chat de parceiro autônomo
 * não é correspondência da empresa.
 */
@Injectable()
export class ChatAdminService {
  private readonly log = new Logger("ChatAdminService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly uploads: UploadsService,
    private readonly chat: ChatService,
  ) {}

  /** Últimos avisos publicados (o que os motoristas estão vendo). */
  async listarAvisos(limit = 50) {
    const canalId = await this.chat.garantirCanalAvisos();
    const linhas = await this.prisma.mensagemChat.findMany({
      where: { conversaId: canalId },
      orderBy: { criadoEm: "desc" },
      take: Math.min(limit, 100),
      select: {
        id: true,
        autorNome: true,
        texto: true,
        criadoEm: true,
        apagadaEm: true,
        fotoKey: true,
        storyOficial: {
          select: {
            id: true,
            expiraEm: true,
            _count: { select: { visualizacoes: true } },
          },
        },
      },
    });
    const agora = new Date();
    const alcance = await this.prisma.conversaParticipante.count({
      where: { conversaId: canalId },
    });
    return {
      alcance,
      avisos: linhas.map((m) => ({
        id: m.id,
        autorNome: m.autorNome,
        texto: m.apagadaEm ? null : m.texto,
        apagada: m.apagadaEm !== null,
        criadoEm: m.criadoEm.toISOString(),
        temFoto: !m.apagadaEm && m.fotoKey !== null,
        story: m.storyOficial
          ? {
              id: m.storyOficial.id,
              expiraEm: m.storyOficial.expiraEm.toISOString(),
              /** Já passou das 24h: o story sumiu do app sozinho. */
              expirado: m.storyOficial.expiraEm <= agora,
              vistos: m.storyOficial._count.visualizacoes,
            }
          : null,
      })),
    };
  }

  /**
   * Sobe a foto do aviso e devolve a chave. Dois passos, igual ao story e ao
   * áudio: arquivo primeiro, publicação depois — assim o admin vê a prévia
   * antes de mandar o recado pra frota inteira.
   */
  async subirFoto(usuarioId: string, arquivo: Express.Multer.File): Promise<{ fotoKey: string }> {
    const fotoKey = await this.uploads.putAvisoFoto(
      arquivo.buffer,
      arquivo.mimetype,
      usuarioId,
    );
    return { fotoKey };
  }

  /** Bytes da foto de um aviso, pro painel mostrar a miniatura. */
  async fotoBuffer(avisoId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const canalId = await this.chat.garantirCanalAvisos();
    const aviso = await this.prisma.mensagemChat.findFirst({
      where: { id: avisoId, conversaId: canalId, apagadaEm: null },
      select: { fotoKey: true },
    });
    if (!aviso?.fotoKey) throw new NotFoundException("Foto não disponível.");
    const buffer = await this.uploads.getObjectBuffer(aviso.fotoKey);
    const ext = aviso.fotoKey.split(".").pop()?.toLowerCase();
    return { buffer, contentType: ext === "png" ? "image/png" : "image/jpeg" };
  }

  /**
   * Publica no canal de Avisos: grava a mensagem, garante que todo motorista
   * habilitado é participante (motorista novo entra aqui), soma o não-lido e
   * dispara a push. Fan-out em código porque é dezenas de linhas, não milhares.
   *
   * Com `fotoKey`, o aviso leva imagem; com `tambemStory`, a MESMA imagem vira
   * story oficial (24h). São dois lugares e uma publicação só — e uma push só,
   * porque duas notificações do mesmo recado é o jeito rápido de o motorista
   * silenciar o canal.
   */
  async publicarAviso(usuarioId: string, input: PublicarAvisoInput) {
    const canalId = await this.chat.garantirCanalAvisos();
    const autor = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      select: { nome: true },
    });

    const destinatarios = await this.prisma.motorista.findMany({
      where: { status: "APROVADO", ativo: true, podeChat: true },
      select: { id: true, expoPushToken: true },
    });

    const mensagem = await this.prisma.mensagemChat.create({
      data: {
        clientId: randomUUID(),
        conversaId: canalId,
        autor: "ADMIN",
        usuarioId,
        autorNome: autor?.nome ?? "Avisos",
        tipo: input.fotoKey ? "FOTO" : "TEXTO",
        texto: input.texto,
        fotoKey: input.fotoKey ?? null,
      },
      select: { id: true, criadoEm: true },
    });

    // Story oficial: mesma foto, mesmo texto (recortado), 24h. Nasce depois da
    // mensagem porque aponta pra ela — remover o aviso remove o story junto.
    let storyId: string | null = null;
    if (input.tambemStory && input.fotoKey) {
      const conta = await this.prisma.conta.findUnique({
        where: { id: contaIdAtual() },
        select: { nome: true },
      });
      const story = await this.prisma.story.create({
        data: {
          clientId: randomUUID(),
          oficial: true,
          usuarioId,
          // O motorista lê o nome da EMPRESA na bolinha, não o de quem publicou.
          autorNome: conta?.nome ?? "Avisos",
          storageKey: input.fotoKey,
          legenda: legendaDoAviso(input.texto),
          avisoMensagemId: mensagem.id,
          criadoEm: mensagem.criadoEm,
          expiraEm: new Date(mensagem.criadoEm.getTime() + DURACAO_STORY_MS),
        },
        select: { id: true },
      });
      storyId = story.id;
    }

    await this.prisma.conversa.update({
      where: { id: canalId },
      data: {
        ultimaMensagemEm: mensagem.criadoEm,
        ultimaMensagemTexto: (input.fotoKey ? `📷 ${input.texto}` : input.texto).slice(0, 120),
      },
    });

    // Quem ainda não era participante do canal entra agora (createMany com
    // skipDuplicates encosta no unique sem precisar consultar antes).
    await this.prisma.conversaParticipante.createMany({
      data: destinatarios.map((d) => ({ conversaId: canalId, motoristaId: d.id })),
      skipDuplicates: true,
    });
    await this.prisma.conversaParticipante.updateMany({
      where: { conversaId: canalId, motoristaId: { in: destinatarios.map((d) => d.id) } },
      data: { naoLidas: { increment: 1 } },
    });

    const silenciados = await this.prisma.conversaParticipante.findMany({
      where: { conversaId: canalId, silenciado: true },
      select: { motoristaId: true },
    });
    const mudos = new Set(silenciados.map((s) => s.motoristaId));

    let enviados = 0;
    for (const d of destinatarios) {
      if (mudos.has(d.id) || !d.expoPushToken) continue;
      try {
        const r = await this.push.enviar({
          motoristaId: d.id,
          token: d.expoPushToken,
          titulo: "Avisos da transportadora",
          corpo: input.texto.slice(0, 160),
          tipo: "chat-aviso",
          dados: { kind: "chat-mensagem", conversaId: canalId },
          criadoPorId: usuarioId,
          persistir: false,
        });
        if (r.enviado) enviados += 1;
      } catch (e) {
        this.log.warn(`Push de aviso falhou pra ${d.id}: ${e}`);
      }
    }

    return {
      id: mensagem.id,
      destinatarios: destinatarios.length,
      pushEnviadas: enviados,
      storyId,
    };
  }

  /**
   * Remove um aviso do canal (some pros motoristas na próxima carga). Leva
   * junto o story oficial que nasceu com ele e a foto no MinIO — tirar o aviso
   * e deixar a mesma imagem rodando no story seria o pior dos dois mundos.
   */
  async removerAviso(usuarioId: string, avisoId: string): Promise<void> {
    const canalId = await this.chat.garantirCanalAvisos();
    const aviso = await this.prisma.mensagemChat.findFirst({
      where: { id: avisoId, conversaId: canalId },
      select: { id: true, fotoKey: true },
    });
    if (!aviso) throw new NotFoundException("Aviso não encontrado.");

    await this.prisma.story.deleteMany({ where: { avisoMensagemId: avisoId } });
    await this.prisma.mensagemChat.update({
      where: { id: avisoId },
      data: {
        apagadaEm: new Date(),
        texto: null,
        fotoKey: null,
        removidaPorId: usuarioId,
      },
    });
    if (aviso.fotoKey) {
      await this.uploads.removeObject(aviso.fotoKey).catch(() => {
        this.log.warn(`Foto do aviso ${avisoId} não saiu do storage.`);
      });
    }
  }

  // ── Denúncias ─────────────────────────────────────────────────────────────

  async listarDenuncias(status?: "ABERTA" | "ARQUIVADA" | "REMOVIDA"): Promise<DenunciaChatAdmin[]> {
    const linhas = await this.prisma.denunciaMensagemChat.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
      take: 200,
      include: {
        denunciante: { select: { id: true, nome: true } },
        mensagem: {
          select: {
            id: true,
            texto: true,
            criadoEm: true,
            apagadaEm: true,
            motoristaId: true,
            autorNome: true,
            conversaId: true,
          },
        },
      },
    });

    // Contexto: as mensagens imediatamente ANTES da denunciada, pra a operação
    // julgar sem precisar abrir a conversa inteira (que ela não pode abrir).
    return Promise.all(
      linhas.map(async (d) => {
        const contexto = await this.prisma.mensagemChat.findMany({
          where: {
            conversaId: d.mensagem.conversaId,
            criadoEm: { lt: d.mensagem.criadoEm },
          },
          orderBy: { criadoEm: "desc" },
          take: CONTEXTO_ANTES,
          select: { autorNome: true, texto: true, criadoEm: true, apagadaEm: true },
        });
        return {
          id: d.id,
          motivo: d.motivo as MotivoDenuncia,
          detalhe: d.detalhe,
          status: d.status,
          criadoEm: d.criadoEm.toISOString(),
          denunciante: { id: d.denunciante.id, nome: d.denunciante.nome },
          autor: { id: d.mensagem.motoristaId, nome: d.mensagem.autorNome },
          mensagem: {
            id: d.mensagem.id,
            texto: d.mensagem.apagadaEm ? null : d.mensagem.texto,
            criadoEm: d.mensagem.criadoEm.toISOString(),
            apagada: d.mensagem.apagadaEm !== null,
          },
          contexto: contexto.reverse().map((c) => ({
            autorNome: c.autorNome,
            texto: c.apagadaEm ? null : c.texto,
            criadoEm: c.criadoEm.toISOString(),
          })),
        };
      }),
    );
  }

  async contarAbertas(): Promise<{ abertas: number }> {
    const abertas = await this.prisma.denunciaMensagemChat.count({
      where: { status: "ABERTA" },
    });
    return { abertas };
  }

  /**
   * ARQUIVADA = olhei e não é violação. REMOVIDA = apaga a mensagem pros dois
   * lados (a bolha vira "removida por violar as regras"). Nunca hard delete:
   * o histórico da denúncia precisa continuar existindo.
   */
  async resolverDenuncia(
    usuarioId: string,
    denunciaId: string,
    input: ResolverDenunciaInput,
  ): Promise<void> {
    const denuncia = await this.prisma.denunciaMensagemChat.findUnique({
      where: { id: denunciaId },
      select: { id: true, mensagemId: true },
    });
    if (!denuncia) throw new NotFoundException("Denúncia não encontrada.");

    await this.prisma.denunciaMensagemChat.update({
      where: { id: denunciaId },
      data: { status: input.status, resolvidoPorId: usuarioId, resolvidoEm: new Date() },
    });

    if (input.status === "REMOVIDA") {
      // Áudio removido por moderação sai do bucket também — senão o arquivo
      // continua lá, sem nenhuma linha apontando pra ele.
      const alvo = await this.prisma.mensagemChat.findUnique({
        where: { id: denuncia.mensagemId },
        select: { audioKey: true },
      });
      if (alvo?.audioKey) {
        await this.uploads.removeObject(alvo.audioKey).catch(() => {
          /* já pode ter sumido */
        });
      }
      await this.prisma.mensagemChat.update({
        where: { id: denuncia.mensagemId },
        data: {
          apagadaEm: new Date(),
          texto: null,
          audioKey: null,
          transcricao: null,
          removidaPorId: usuarioId,
        },
      });
    }
  }
}
