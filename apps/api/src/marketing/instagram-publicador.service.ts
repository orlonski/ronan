import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StatusPostInstagram, type PostInstagram } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { comoSistema } from "../common/conta/conta-context";
import { InstagramConfig } from "./instagram.config";
import { InstagramFilaService } from "./instagram-fila.service";
import { ErroMeta, MetaClient } from "./meta-client";

/**
 * Publica no Instagram do @movatruck na hora marcada.
 *
 * Roda no processo da API, como os outros crons, pela mesma razão escrita no
 * worker da conferência de ticket: o que justificou dar container próprio ao
 * `ronan_agente` foi a capacidade de executar código e escrever no repositório,
 * e nada disso existe aqui — isto é uma chamada HTTP e uma escrita no banco.
 *
 * A cada 5 minutos em vez de um `setInterval` curto porque o feed tem hora
 * marcada: não há evento externo enchendo a fila a qualquer momento.
 */
@Injectable()
export class InstagramPublicadorService implements OnModuleInit {
  private readonly logger = new Logger(InstagramPublicadorService.name);
  private readonly workerId = `api-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly meta: MetaClient;
  /** Um tick lento não pode se sobrepor ao seguinte e publicar duas vezes. */
  private tickRodando = false;

  constructor(
    private readonly config: InstagramConfig,
    private readonly fila: InstagramFilaService,
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly appConfig: ConfigService,
  ) {
    this.meta = new MetaClient(config);
  }

  onModuleInit() {
    this.config.descreverNoBoot();
  }

  @Cron("0 */5 * * * *", { name: "publicar-instagram", timeZone: "America/Sao_Paulo" })
  async tick(): Promise<void> {
    await this.rodar();
  }

  /**
   * O tick, com relato do que aconteceu.
   *
   * O relato existe porque "o post não saiu e não há erro em lugar nenhum" é o
   * estado mais caro de depurar aqui: sem acesso ao log do servidor, um return
   * cedo é indistinguível de um cron que não rodou. Cada saída antecipada diz
   * o próprio nome.
   */
  async rodar(): Promise<{ passo: string; detalhe?: string; posts: number }> {
    if (!this.config.habilitado) return { passo: "sem-credencial", posts: 0 };
    if (this.tickRodando) return { passo: "tick-anterior-ainda-rodando", posts: 0 };
    this.tickRodando = true;
    try {
      // Model global não tem contaId pra trava injetar: roda como sistema.
      return await comoSistema(async () => {
        if (!(await this.ligadoNaConfiguracao())) {
          return { passo: "publicacao-desligada", posts: 0 };
        }
        const orfaos = await this.fila.marcarOrfaos();

        const cabe = await this.quantosCabem();
        if (cabe <= 0) return { passo: "teto-diario-atingido", posts: 0 };

        const posts = await this.fila.reivindicar(this.workerId, Math.min(cabe, this.config.loteMax));
        if (posts.length === 0) {
          const espiar = await this.fila.espiarFila();
          return { passo: "nada-na-hora", detalhe: espiar, posts: 0 };
        }
        for (const post of posts) {
          await this.publicarUm(post);
        }
        return { passo: "processou", detalhe: `orfaos=${orfaos}`, posts: posts.length };
      });
    } catch (erro) {
      this.logger.error(`Tick falhou: ${(erro as Error).message}`);
      return { passo: "erro", detalhe: (erro as Error).message, posts: 0 };
    } finally {
      this.tickRodando = false;
    }
  }

  /**
   * O interruptor que mora no banco, separado do que mora em env.
   *
   * O env diz "tem credencial"; este diz "pode publicar". Sem os dois, nada
   * sai — e o daqui nasce false, então subir o código não liga nada.
   */
  private async ligadoNaConfiguracao(): Promise<boolean> {
    const cfg = await this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" } });
    return cfg?.instagramAtivo === true;
  }

  /** Teto próprio, checado ANTES de reivindicar: post barrado continua AGENDADO. */
  private async quantosCabem(): Promise<number> {
    const cfg = await this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" } });
    const teto = cfg?.instagramMaxPorDia ?? 3;
    const jaSairam = await this.fila.publicadosUltimas24h();
    return Math.max(0, teto - jaSairam);
  }

  private async publicarUm(post: PostInstagram): Promise<void> {
    try {
      // A arte precisa existir e o link precisa estar de pé: a Meta vai buscar
      // a imagem, e uma URL morta vira uma chamada perdida com erro obscuro.
      if (post.arteExpiraEm.getTime() <= Date.now()) {
        await this.fila.descartar(post.id, "O link público da arte expirou antes da publicação.");
        return;
      }
      try {
        await this.uploads.getObjectBuffer(post.storageKey);
      } catch {
        await this.fila.descartar(post.id, "A arte não está mais no storage.");
        return;
      }

      // Retomada: com container já criado, não cria outro. É a chave de
      // idempotência entre as duas fases da Meta.
      const containerId = post.containerId ?? (await this.criarContainer(post));

      if (this.config.modoSombra) {
        this.logger.log(
          `[SOMBRA] Container ${containerId} pronto para "${post.peca}" — não vou publicar.`,
        );
        await this.fila.reagendar(post, null, "Modo sombra: container montado, publicação não feita.");
        return;
      }

      const { id: mediaId } = await this.meta.publicar(containerId);
      const permalink = await this.meta.permalink(mediaId).catch(() => null);
      await this.fila.concluir(post.id, mediaId, permalink);
      this.logger.log(`Publicado "${post.peca}" → ${permalink ?? mediaId}`);
    } catch (erro) {
      await this.tratarFalha(post, erro);
    }
  }

  private async criarContainer(post: PostInstagram): Promise<string> {
    const url = this.urlPublicaDaArte(post.arteToken);
    const containerId = await this.meta.criarContainer(url, post.legenda);
    // Grava ANTES de publicar: se o processo morrer agora, a retomada reaproveita.
    await this.fila.registrarContainer(post.id, containerId);
    await this.esperarContainer(containerId);
    return containerId;
  }

  /** Foto costuma ficar pronta na hora, mas publicar antes de FINISHED falha. */
  private async esperarContainer(containerId: string): Promise<void> {
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const { status, erro } = await this.meta.statusContainer(containerId);
      if (status === "FINISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new ErroMeta(null, null, false, `Container ${status}: ${erro ?? "sem detalhe"}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new ErroMeta(null, null, true, "Container não ficou pronto a tempo.");
  }

  private async tratarFalha(post: PostInstagram, erro: unknown): Promise<void> {
    const meta = erro instanceof ErroMeta ? erro : null;
    const motivo = meta
      ? `Meta code=${meta.codigo ?? "-"} subcode=${meta.subcodigo ?? "-"}: ${meta.message}`
      : (erro as Error).message;

    const transitorio = meta?.transitorio ?? false;
    if (transitorio && post.tentativas < this.config.tentativasMax) {
      await this.fila.reagendar(post, meta?.codigo ?? null, motivo);
      return;
    }

    await this.fila.falhar(post.id, meta?.codigo ?? null, motivo);
    this.logger.error(`Post "${post.peca}" FALHOU: ${motivo}`);
  }

  /**
   * A URL que a Meta vai buscar.
   *
   * Sai pela API, nunca pelo MinIO: o bucket tem leitura anônima habilitada na
   * criação, e dar domínio público a ele exporia todo ticket e documento de
   * motorista de todas as contas. Aqui vai um token aleatório, com validade.
   */
  private urlPublicaDaArte(token: string): string {
    const base = (this.appConfig.get<string>("PUBLIC_API_URL") ?? "").replace(/\/+$/, "");
    return `${base}/publico/marketing/artes/${token}`;
  }

  /**
   * Descobre se um post INDETERMINADO saiu ou não, perguntando à Meta.
   *
   * Roda de madrugada porque é conserto, não operação: o caso normal é essa
   * lista estar vazia. Só volta pra fila o que ficar provado que não saiu; o
   * que ficar ambíguo continua parado esperando gente olhar — melhor um post
   * atrasado do que um post repetido no feed.
   */
  @Cron("0 20 4 * * *", { name: "reconciliar-instagram", timeZone: "America/Sao_Paulo" })
  async reconciliar(): Promise<void> {
    if (!this.config.habilitado) return;
    await comoSistema(async () => {
      const pendentes = await this.fila.indeterminados();
      if (pendentes.length === 0) return;

      const recentes = await this.meta.midiasRecentes(25).catch(() => []);
      for (const post of pendentes) {
        const casou = recentes.find((m) => (m.caption ?? "").trim() === post.legenda.trim());
        if (casou) {
          await this.fila.concluir(post.id, casou.id, null);
          this.logger.warn(`"${post.peca}" tinha publicado sim — reconciliado com ${casou.id}.`);
          continue;
        }
        if (recentes.length === 0) {
          this.logger.error(`Não consegui listar as mídias: "${post.peca}" segue INDETERMINADO.`);
          continue;
        }
        await this.prisma.postInstagram.update({
          where: { id: post.id },
          data: { status: StatusPostInstagram.AGENDADO, containerId: null, proximaTentativaEm: null },
        });
        this.logger.warn(`"${post.peca}" não saiu: devolvido pra fila.`);
      }
    });
  }
}
