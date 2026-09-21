import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StatusPostInstagram, type ArtePostInstagram, type PostInstagram } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { comoSistema } from "../common/conta/conta-context";
import { InstagramConfig } from "./instagram.config";
import { InstagramFilaService } from "./instagram-fila.service";
import { ErroMeta, MetaClient } from "./meta-client";

/**
 * O container da Meta venceu antes de publicarmos.
 *
 * Separado de `ErroMeta` porque o conserto é outro: não adianta retentar com o
 * mesmo container, tem que jogar fora e montar de novo.
 */
class ContainerExpirado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ContainerExpirado";
  }
}

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

      const artes = await this.fila.artesDoPost(post.id);
      if (artes.length === 0) {
        await this.fila.descartar(post.id, "O post não tem arte nenhuma.");
        return;
      }
      // TODOS os slides antes de criar container nenhum. Descobrir no slide 7
      // que o 8 sumiu deixaria sete containers órfãos consumindo cota.
      for (const arte of artes) {
        try {
          await this.uploads.getObjectBuffer(arte.storageKey);
        } catch {
          const qual = artes.length > 1 ? ` (slide ${arte.ordem + 1} de ${artes.length})` : "";
          await this.fila.descartar(post.id, `A arte não está mais no storage${qual}.`);
          return;
        }
      }

      // Retomada: com container já criado, não cria outro. É a chave de
      // idempotência entre as duas fases da Meta.
      const containerId = post.containerId ?? (await this.criarContainer(post, artes));

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

  private async criarContainer(post: PostInstagram, artes: ArtePostInstagram[]): Promise<string> {
    const containerId =
      artes.length === 1
        ? await this.meta.criarContainer(this.urlPublicaDaArte(artes[0].token), post.legenda)
        : await this.criarContainerCarrossel(post, artes);
    // Grava ANTES de publicar: se o processo morrer agora, a retomada reaproveita.
    await this.fila.registrarContainer(post.id, containerId);
    await this.esperarContainer(containerId);
    return containerId;
  }

  /**
   * Monta o carrossel: um container por slide, depois o pai que os amarra.
   *
   * Cada filho é gravado assim que a Meta o aceita, pelo mesmo motivo do
   * container do post: um processo que morre no slide 6 de 8 não pode obrigar a
   * refazer os cinco primeiros. Cada `criarContainerSlide` é uma chamada que
   * conta na cota.
   *
   * A ordem de `filhos` é a ordem do feed, e vem de `artes`, que a fila entrega
   * ordenada por `ordem`. Confiar na ordem de chegada do upload em vez disso
   * seria deixar o slide 1 sair no meio do carrossel.
   */
  private async criarContainerCarrossel(
    post: PostInstagram,
    artes: ArtePostInstagram[],
  ): Promise<string> {
    const filhos: string[] = [];
    for (const arte of artes) {
      if (arte.containerId) {
        filhos.push(arte.containerId);
        continue;
      }
      const filho = await this.meta.criarContainerSlide(this.urlPublicaDaArte(arte.token));
      await this.fila.registrarContainerSlide(arte.id, filho);
      filhos.push(filho);
    }
    // Um filho ainda processando derruba o pai inteiro com erro genérico.
    for (const filho of filhos) await this.esperarContainer(filho);
    return this.meta.criarContainerCarrossel(filhos, post.legenda);
  }

  /** Foto costuma ficar pronta na hora, mas publicar antes de FINISHED falha. */
  private async esperarContainer(containerId: string): Promise<void> {
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const { status, erro } = await this.meta.statusContainer(containerId);
      if (status === "FINISHED") return;
      // EXPIRED não é a peça com defeito: é o container da Meta, que dura 24h.
      // Um post preso em modo sombra passa desse prazo reusando o mesmo
      // container e, antes disto, virava FALHOU definitivo — com a arte
      // intacta e nada pra consertar. Recriar resolve, então é transitório, e
      // quem trata limpa o container velho antes de tentar de novo.
      if (status === "EXPIRED") {
        throw new ContainerExpirado(`Container expirou antes de publicar: ${erro ?? "sem detalhe"}`);
      }
      if (status === "ERROR") {
        throw new ErroMeta(null, null, false, `Container ERROR: ${erro ?? "sem detalhe"}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new ErroMeta(null, null, true, "Container não ficou pronto a tempo.");
  }

  /**
   * Esquece os containers deste post — o do post e o de cada slide.
   *
   * Sem isto a retomada reusaria exatamente o container que acabou de expirar,
   * e o post ficaria batendo na mesma parede até esgotar as tentativas.
   */
  private async limparContainers(postId: string): Promise<void> {
    await this.fila.esquecerContainers(postId);
  }

  private async tratarFalha(post: PostInstagram, erro: unknown): Promise<void> {
    if (erro instanceof ContainerExpirado) {
      await this.limparContainers(post.id);
      await this.fila.reagendar(post, null, `${erro.message} Vou montar outro na próxima tentativa.`);
      return;
    }
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
        // Esquece os containers junto: o pai some e os filhos de um carrossel
        // não servem pra outro pai.
        await this.fila.esquecerContainers(post.id);
        await this.prisma.postInstagram.update({
          where: { id: post.id },
          data: { status: StatusPostInstagram.AGENDADO, proximaTentativaEm: null },
        });
        this.logger.warn(`"${post.peca}" não saiu: devolvido pra fila.`);
      }
    });
  }
}
