import { Injectable, Logger } from "@nestjs/common";
import { StatusPostInstagram, type PostInstagram } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { InstagramConfig } from "./instagram.config";

/** Backoff exponencial (1min, 2min, 4min…) com teto de 30 min. */
export function atrasoBackoffMs(tentativa: number): number {
  const base = 60_000 * 2 ** Math.max(0, tentativa - 1);
  return Math.min(base, 30 * 60_000);
}

/** 24 bytes = 192 bits, como o token do comprovante de viagem. */
const TOKEN_BYTES = 24;

type Enfileirar = {
  peca: string;
  legenda: string;
  storageKey: string;
  publicarEm: Date | null;
  criadoPorId: string | null;
  validadeHoras: number;
};

/**
 * A fila de posts do Instagram. Vive no Postgres pelo mesmo motivo da fila do
 * agente: o processo reinicia no deploy e pode haver mais de uma réplica da
 * API — nenhuma dessas garantias sobrevive num array em memória.
 */
@Injectable()
export class InstagramFilaService {
  private readonly logger = new Logger(InstagramFilaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: InstagramConfig,
  ) {}

  /**
   * Já existe post vivo com essa peça?
   *
   * Duas execuções do agente rodam sem saber uma da outra, e nada impede que
   * escolham o mesmo ângulo — foi o que aconteceu na primeira leva: a mesma
   * peça entrou duas vezes, agendada pro mesmo horário. No feed isso seria o
   * post repetido.
   */
  async pecaJaNaFila(peca: string): Promise<boolean> {
    const n = await this.prisma.postInstagram.count({
      where: {
        peca,
        status: {
          in: [
            StatusPostInstagram.RASCUNHO,
            StatusPostInstagram.AGENDADO,
            StatusPostInstagram.PUBLICANDO,
            StatusPostInstagram.PUBLICADO,
          ],
        },
      },
    });
    return n > 0;
  }

  /**
   * Empurra o horário até achar um livre.
   *
   * Dois posts na mesma hora significam os dois saindo no mesmo ciclo — o teto
   * diário permite, mas o feed fica com duas publicações no mesmo minuto, que é
   * exatamente o padrão que derrubou a conta numa verificação anti-bot.
   */
  async horarioLivre(desejado: Date): Promise<Date> {
    const candidato = new Date(desejado);
    for (let tentativa = 0; tentativa < 30; tentativa++) {
      const ocupado = await this.prisma.postInstagram.count({
        where: {
          publicarEm: candidato,
          status: { in: [StatusPostInstagram.AGENDADO, StatusPostInstagram.PUBLICANDO] },
        },
      });
      if (ocupado === 0) return candidato;
      candidato.setDate(candidato.getDate() + 1);
    }
    return candidato;
  }

  async enfileirar(dados: Enfileirar): Promise<PostInstagram> {
    const expiraEm = new Date(Date.now() + dados.validadeHoras * 3600_000);
    return this.prisma.postInstagram.create({
      data: {
        peca: dados.peca,
        legenda: dados.legenda,
        storageKey: dados.storageKey,
        arteToken: randomBytes(TOKEN_BYTES).toString("base64url"),
        arteExpiraEm: expiraEm,
        publicarEm: dados.publicarEm,
        status: dados.publicarEm ? StatusPostInstagram.AGENDADO : StatusPostInstagram.RASCUNHO,
        criadoPorId: dados.criadoPorId,
      },
    });
  }

  /**
   * Pega posts cuja hora chegou, marcando posse no mesmo comando.
   *
   * `FOR UPDATE SKIP LOCKED` é o que impede duas réplicas da API de pegarem o
   * mesmo post — e post duplicado é o único erro aqui que não se desfaz. Um
   * `findMany` seguido de `update` tem uma janela entre a leitura e a escrita,
   * e é exatamente nessa janela que o post sai duas vezes.
   *
   * Nome de tabela e de enum é o do @@map (`posts_instagram`), não o do model.
   */
  async reivindicar(workerId: string, limite: number): Promise<PostInstagram[]> {
    if (limite <= 0) return [];
    return this.prisma.$queryRaw<PostInstagram[]>`
      UPDATE "posts_instagram"
         SET status = 'PUBLICANDO'::"StatusPostInstagram",
             "postAtivo" = id,
             "workerId" = ${workerId},
             "reivindicadoEm" = NOW(),
             "iniciadoEm" = COALESCE("iniciadoEm", NOW()),
             tentativas = tentativas + 1,
             "alteradoEm" = NOW()
       WHERE id IN (
         SELECT id FROM "posts_instagram"
          WHERE status = 'AGENDADO'::"StatusPostInstagram"
            AND "publicarEm" IS NOT NULL
            AND "publicarEm" <= NOW()
            AND ("proximaTentativaEm" IS NULL OR "proximaTentativaEm" <= NOW())
          ORDER BY "publicarEm" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limite}
       )
      RETURNING *;
    `;
  }

  /** Guarda o container assim que a Meta devolve, ANTES de tentar publicar. */
  async registrarContainer(id: string, containerId: string): Promise<void> {
    await this.prisma.postInstagram.update({
      where: { id },
      data: { containerId },
    });
  }

  async concluir(id: string, mediaId: string, permalink: string | null): Promise<void> {
    await this.prisma.postInstagram.update({
      where: { id },
      data: {
        status: StatusPostInstagram.PUBLICADO,
        mediaId,
        permalink,
        publicadoEm: new Date(),
        postAtivo: null,
        workerId: null,
        reivindicadoEm: null,
        erro: null,
        erroCodigo: null,
      },
    });
  }

  /** Falha transitória: volta pra fila com espera, até o teto de tentativas. */
  async reagendar(post: PostInstagram, codigo: number | null, motivo: string): Promise<void> {
    const espera = atrasoBackoffMs(post.tentativas);
    await this.prisma.postInstagram.update({
      where: { id: post.id },
      data: {
        status: StatusPostInstagram.AGENDADO,
        proximaTentativaEm: new Date(Date.now() + espera),
        postAtivo: null,
        workerId: null,
        reivindicadoEm: null,
        erroCodigo: codigo,
        erro: motivo.slice(0, 2000),
      },
    });
    this.logger.warn(
      `Post ${post.peca} adiado ${Math.round(espera / 1000)}s (tentativa ${post.tentativas}): ${motivo}`,
    );
  }

  /** Falha definitiva: sai da fila e espera gente. */
  async falhar(id: string, codigo: number | null, motivo: string): Promise<void> {
    await this.prisma.postInstagram.update({
      where: { id },
      data: {
        status: StatusPostInstagram.FALHOU,
        postAtivo: null,
        workerId: null,
        reivindicadoEm: null,
        erroCodigo: codigo,
        erro: motivo.slice(0, 2000),
      },
    });
  }

  /**
   * Terminou sem publicar, e isso não é falha: a arte sumiu do storage ou o
   * link expirou antes da hora. Nunca retenta — republicar não conserta o que
   * falta é o arquivo.
   */
  async descartar(id: string, motivo: string): Promise<void> {
    await this.prisma.postInstagram.update({
      where: { id },
      data: {
        status: StatusPostInstagram.DESCARTADA,
        postAtivo: null,
        workerId: null,
        reivindicadoEm: null,
        erro: motivo.slice(0, 2000),
      },
    });
  }

  /**
   * Posts que ficaram presos em PUBLICANDO.
   *
   * Aqui o projeto se desvia de propósito do `recuperarPresas` da fila do
   * agente, que devolve o item direto pra PENDENTE. Para o agente, reexecutar é
   * desperdício; aqui, pode ser um post duplicado no feed público. Se o
   * processo morreu depois do `media_publish` e antes de gravar o resultado, o
   * post PODE já estar no ar — e não há como saber sem perguntar.
   *
   * Então vira INDETERMINADO, que não volta pra fila sozinho: quem resolve é a
   * reconciliação contra a API da Meta.
   */
  async marcarOrfaos(): Promise<number> {
    const limite = new Date(Date.now() - this.config.timeoutPublicacaoMs);
    const { count } = await this.prisma.postInstagram.updateMany({
      where: { status: StatusPostInstagram.PUBLICANDO, reivindicadoEm: { lt: limite } },
      data: {
        status: StatusPostInstagram.INDETERMINADO,
        postAtivo: null,
        workerId: null,
      },
    });
    if (count > 0) {
      this.logger.error(
        `${count} post(s) ficaram INDETERMINADOS: o processo morreu no meio da publicação. ` +
          `Não vou retentar — a reconciliação decide se saiu ou não.`,
      );
    }
    return count;
  }

  /** Quantos posts já saíram na janela de 24h, pro teto próprio. */
  async publicadosUltimas24h(): Promise<number> {
    return this.prisma.postInstagram.count({
      where: {
        status: StatusPostInstagram.PUBLICADO,
        publicadoEm: { gte: new Date(Date.now() - 24 * 3600_000) },
      },
    });
  }

  async porToken(token: string): Promise<PostInstagram | null> {
    return this.prisma.postInstagram.findUnique({ where: { arteToken: token } });
  }

  /**
   * Por que o `reivindicar` não devolveu nada.
   *
   * Sem isto, "a fila está vazia" e "tem post mas a hora não chegou" e "a hora
   * chegou mas o backoff segura" são o mesmo silêncio.
   */
  async espiarFila(): Promise<string> {
    const agora = new Date();
    const [total, agendados, proximo] = await Promise.all([
      this.prisma.postInstagram.count(),
      this.prisma.postInstagram.count({ where: { status: StatusPostInstagram.AGENDADO } }),
      this.prisma.postInstagram.findFirst({
        where: { status: StatusPostInstagram.AGENDADO },
        orderBy: { publicarEm: "asc" },
        select: { peca: true, publicarEm: true, proximaTentativaEm: true },
      }),
    ]);
    if (!proximo) return `fila: ${total} posts, nenhum AGENDADO`;
    const espera =
      proximo.publicarEm && proximo.publicarEm > agora
        ? `hora ainda não chegou (${proximo.publicarEm.toISOString()}, agora ${agora.toISOString()})`
        : proximo.proximaTentativaEm && proximo.proximaTentativaEm > agora
          ? `em backoff até ${proximo.proximaTentativaEm.toISOString()}`
          : "deveria ter sido pescado — investigar o claim";
    return `fila: ${total} posts, ${agendados} agendados; próximo "${proximo.peca}": ${espera}`;
  }

  async indeterminados(): Promise<PostInstagram[]> {
    return this.prisma.postInstagram.findMany({
      where: { status: StatusPostInstagram.INDETERMINADO },
      orderBy: { criadoEm: "asc" },
      take: 20,
    });
  }
}
