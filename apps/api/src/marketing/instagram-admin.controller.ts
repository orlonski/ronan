import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  Res,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { StatusPostInstagram } from "@prisma/client";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { comoSistema } from "../common/conta/conta-context";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { InstagramConfig } from "./instagram.config";
import { InstagramFilaService } from "./instagram-fila.service";
import { InstagramPublicadorService } from "./instagram-publicador.service";
import { PautaService } from "./pauta.service";

/**
 * Limites da Meta, validados aqui e não no worker.
 *
 * Legenda longa demais pega no enfileiramento vira mensagem na tela; pega no
 * worker vira um FALHOU silencioso três dias depois, quando o post não sai.
 */
const AgendarInput = z.object({
  peca: z.string().trim().min(1, "Diga qual peça é").max(120),
  legenda: z
    .string()
    .trim()
    .min(1, "A legenda não pode ficar vazia")
    .max(2200, "O Instagram corta em 2200 caracteres"),
  publicarEm: z.coerce
    .date()
    .optional()
    .refine((d) => !d || d.getTime() > Date.now() - 60_000, {
      message: "A hora de publicar já passou",
    }),
});
type AgendarInput = z.infer<typeof AgendarInput>;

/**
 * Ligar a publicação é decisão de gente, e por isso passa por endpoint com
 * permissão própria (`marketing.publicar`) — não por variável de ambiente nem
 * por UPDATE no banco. O que sai daqui vai pro feed público da marca.
 */
const ConfigInput = z.object({
  ativo: z.boolean().optional(),
  maxPorDia: z.number().int().min(1, "No mínimo 1").max(25, "Acima de 25 o Instagram começa a recusar").optional(),
});
type ConfigInput = z.infer<typeof ConfigInput>;

const ListarQuery = z.object({
  status: z.nativeEnum(StatusPostInstagram).optional(),
});
type ListarQuery = z.infer<typeof ListarQuery>;

@ApiTags("admin/marketing")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/marketing/instagram")
export class InstagramAdminController {
  private readonly logger = new Logger(InstagramAdminController.name);

  constructor(
    private readonly fila: InstagramFilaService,
    private readonly uploads: UploadsService,
    private readonly prisma: PrismaService,
    private readonly config: InstagramConfig,
    private readonly publicador: InstagramPublicadorService,
    private readonly pauta: PautaService,
  ) {}

  @RequerPermissao("marketing.ver")
  @Get()
  async listar(@Query(new ZodValidationPipe(ListarQuery)) q: ListarQuery) {
    return comoSistema(() =>
      this.prisma.postInstagram.findMany({
        where: q.status ? { status: q.status } : {},
        orderBy: [{ publicarEm: "asc" }, { criadoEm: "desc" }],
        take: 100,
        // Whitelist: storageKey e arteToken não saem daqui. O token abre a arte
        // sem autenticação nenhuma — quem pode ver a fila não precisa dele.
        select: {
          id: true,
          peca: true,
          legenda: true,
          status: true,
          publicarEm: true,
          publicadoEm: true,
          permalink: true,
          tentativas: true,
          erro: true,
          erroCodigo: true,
          criadoEm: true,
          criadoPor: { select: { nome: true } },
        },
      }),
    );
  }

  @RequerPermissao("marketing.ver")
  @Get("estado")
  async estado() {
    const cfg = await comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" } }),
    );
    const jaSairam = await comoSistema(() => this.fila.publicadosUltimas24h());
    // Nunca devolve o token, nem mascarado: só se está configurado.
    return {
      credencialConfigurada: this.config.habilitado,
      modoSombra: this.config.modoSombra,
      ativo: cfg?.instagramAtivo ?? false,
      maxPorDia: cfg?.instagramMaxPorDia ?? 3,
      publicadosUltimas24h: jaSairam,
    };
  }

  /**
   * Enfileira um post: sobe a arte e marca a hora.
   *
   * A arte chega em JPEG já pronta — renderizar é passo de quem produz, não da
   * API (nenhum container do projeto tem Chromium). Sem `publicarEm`, o post
   * fica RASCUNHO e não é pescado pelo cron.
   */
  @RequerPermissao("marketing.criar")
  @Post()
  @UseInterceptors(FileInterceptor("arte"))
  async agendar(
    @UploadedFile() arte: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(AgendarInput)) body: AgendarInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    if (!arte) throw new BadRequestException("Mande a arte no campo `arte`");
    // A Meta não aceita PNG e recusa acima de 8 MB. Barrar aqui evita um post
    // que só falha na hora H.
    if (!arte.mimetype.includes("jpeg") && !arte.mimetype.includes("jpg")) {
      throw new BadRequestException("A arte precisa ser JPEG — a API do Instagram não aceita PNG");
    }
    if (arte.size > 8 * 1024 * 1024) {
      throw new BadRequestException("A arte passa de 8 MB, que é o teto do Instagram");
    }

    return comoSistema(async () => {
      const storageKey = await this.uploads.putArteInstagram(arte.buffer);
      return this.fila.enfileirar({
        peca: body.peca,
        legenda: body.legenda,
        storageKey,
        publicarEm: body.publicarEm ?? null,
        criadoPorId: user.id,
        validadeHoras: this.config.arteValidadeHoras,
      });
    });
  }

  /**
   * Liga ou desliga a publicação, e ajusta o teto diário.
   *
   * Separado da credencial de propósito: o token diz que dá pra publicar, este
   * diz que pode. Desligar aqui é o freio de mão — os posts continuam entrando
   * na fila e nada sai até religar.
   */
  @RequerPermissao("marketing.publicar")
  @Patch("config")
  async configurar(@Body(new ZodValidationPipe(ConfigInput)) body: ConfigInput) {
    if (body.ativo === undefined && body.maxPorDia === undefined) {
      throw new BadRequestException("Diga o que mudar: `ativo` ou `maxPorDia`");
    }
    if (body.ativo === true && !this.config.habilitado) {
      throw new BadRequestException(
        "Sem INSTAGRAM_ACCESS_TOKEN configurado não adianta ligar: o cron não roda.",
      );
    }
    // Traduzido campo a campo de propósito: o corpo fala a língua da API
    // (`ativo`) e a tabela fala a dela (`instagramAtivo`). Espalhar `...body`
    // direto compila — spread de variável não sofre checagem de propriedade
    // excedente — e explode em runtime com "Unknown argument `ativo`".
    const dados = {
      ...(body.ativo !== undefined ? { instagramAtivo: body.ativo } : {}),
      ...(body.maxPorDia !== undefined ? { instagramMaxPorDia: body.maxPorDia } : {}),
    };

    return comoSistema(async () => {
      const cfg = await this.prisma.configuracaoPlataforma.upsert({
        where: { id: "singleton" },
        update: dados,
        create: { id: "singleton", ...dados },
        select: { instagramAtivo: true, instagramMaxPorDia: true },
      });
      this.logger.warn(
        `Publicação do Instagram agora está ${cfg.instagramAtivo ? "LIGADA" : "DESLIGADA"} ` +
          `(teto de ${cfg.instagramMaxPorDia}/dia)`,
      );
      return cfg;
    });
  }

  /**
   * Roda o ciclo agora, sem esperar os 5 minutos do cron, e conta o que houve.
   *
   * Serve pra testar a integração e pra responder "por que não saiu?" sem
   * acesso ao log do servidor — que é justamente onde essa pergunta costuma
   * morrer.
   */
  @RequerPermissao("marketing.publicar")
  @Post("rodar-agora")
  async rodarAgora() {
    return this.publicador.rodar();
  }

  /**
   * A arte do post, pra quem está olhando a fila.
   *
   * Serve a imagem autenticada em vez de devolver o `arteToken` na listagem: o
   * token abre a arte SEM autenticação nenhuma (é o que a Meta usa), então quem
   * pode ver a fila não deve recebê-lo de brinde.
   *
   * Sem isto, revisar um post era ler a legenda e confiar — e o que vai pro
   * feed é principalmente a imagem.
   */
  @RequerPermissao("marketing.ver")
  @Get(":id/arte")
  async arte(@Param("id") id: string, @Res() res: Response) {
    const post = await comoSistema(() =>
      this.prisma.postInstagram.findUnique({ where: { id }, select: { storageKey: true } }),
    );
    if (!post) throw new NotFoundException("Post não encontrado");
    const buffer = await this.uploads.getObjectBuffer(post.storageKey);
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }

  /**
   * Pede ao agente a próxima leva agora, sem esperar a segunda de manhã.
   *
   * Se já houver post esperando na fila, não pede: cada leva custa uma execução
   * do agente, e empilhar trabalho que ninguém consumiu é gastar por nada.
   */
  @RequerPermissao("marketing.criar")
  @Post("pedir-leva")
  async pedirLeva() {
    return this.pauta.pedirLeva(this.config.postsPorLeva);
  }

  /**
   * Adianta um post: manda sair no próximo ciclo em vez de esperar a hora.
   *
   * Não publica na hora de propósito. O cron roda de 5 em 5 minutos, e esses
   * minutos são a janela de arrependimento — com o modo sombra desligado, o
   * post vai pro feed público e de lá não volta.
   *
   * Também limpa `proximaTentativaEm`: um post que estava em backoff depois de
   * uma falha ficaria esperando o backoff mesmo com a hora adiantada.
   */
  @RequerPermissao("marketing.publicar")
  @Post(":id/adiantar")
  async adiantar(@Param("id") id: string) {
    return comoSistema(async () => {
      const post = await this.prisma.postInstagram.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!post) throw new NotFoundException("Post não encontrado");
      // Só faz sentido no que ainda pode sair. Adiantar um publicado não
      // republicaria (o mediaId barra), mas mexer no estado dele confunde quem
      // lê a fila depois.
      const adiantavel =
        post.status === StatusPostInstagram.AGENDADO ||
        post.status === StatusPostInstagram.RASCUNHO;
      if (!adiantavel) {
        throw new BadRequestException(`Post ${post.status.toLowerCase()} não entra na fila de novo`);
      }
      return this.prisma.postInstagram.update({
        where: { id },
        data: {
          status: StatusPostInstagram.AGENDADO,
          publicarEm: new Date(),
          proximaTentativaEm: null,
        },
        select: { id: true, status: true, publicarEm: true },
      });
    });
  }

  /** Tira da fila. Não apaga: post cancelado fica no histórico com o motivo. */
  @RequerPermissao("marketing.publicar")
  @Post(":id/cancelar")
  async cancelar(@Param("id") id: string) {
    return comoSistema(() =>
      this.prisma.postInstagram.update({
        where: { id },
        data: { status: StatusPostInstagram.CANCELADO, postAtivo: null },
        select: { id: true, status: true },
      }),
    );
  }
}
