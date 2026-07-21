import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { CriarLocalInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { LocaisService } from "./locais.service";
import { LocaisImagemService } from "../../locais-imagem/locais-imagem.service";

/** lat/lng do ponto cuja foto queremos (Street View / satélite). */
const ImagemQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const ListLocaisQuery = paginationQuerySchema.extend({
  clienteId: z.string().uuid().optional(),
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]).optional(),
  ativo: z.enum(["true", "false"]).optional(),
  nivelConfianca: z
    .enum(["RASCUNHO", "PRESENCA_PONTUAL", "DWELL_CONFIRMADO", "RECORRENTE", "HUMANO"])
    .optional(),
  emValidacao: z.enum(["true", "false"]).optional(),
});
type ListLocaisQuery = z.infer<typeof ListLocaisQuery>;

const MesclarInput = z.object({ destinoId: z.string().uuid() });

const DuplicatasGeoQuery = z.object({
  raioM: z.coerce.number().int().min(20).max(5000).optional(),
});

const DuplicataMapaQuery = z.object({ ids: z.string().min(1) });
type DuplicataMapaQuery = z.infer<typeof DuplicataMapaQuery>;

const ProximoQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  raioM: z.coerce.number().int().min(20).max(5000).optional(),
  excluirId: z.string().uuid().optional(),
});
type ProximoQuery = z.infer<typeof ProximoQuery>;

@ApiTags("admin/locais")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/locais")
export class LocaisController {
  constructor(
    private readonly service: LocaisService,
    private readonly imagens: LocaisImagemService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListLocaisQuery)) query: ListLocaisQuery) {
    return this.service.list(query);
  }

  /**
   * Local ativo mais próximo de um ponto GPS (pro botão "usar lugar do
   * lançamento" no form de editar viagem). Antes de :id pra Nest não tratar
   * "proximo" como id.
   */
  @Get("proximo")
  proximo(@Query(new ZodValidationPipe(ProximoQuery)) query: ProximoQuery) {
    return this.service.proximo({
      lat: query.lat,
      lng: query.lng,
      raioM: query.raioM,
      excluirId: query.excluirId,
    });
  }

  /**
   * Lista enxuta pra exibir no mapa (sem paginação). Definida ANTES de :id
   * pra Nest não interpretar "mapa" como id.
   */
  @Get("mapa")
  mapa(@Query(new ZodValidationPipe(ListLocaisQuery)) query: ListLocaisQuery) {
    return this.service.mapa(query);
  }

  /**
   * Grupos de locais ativos com nome parecido (provável duplicata). Usado pela
   * lista pra exibir tarja vermelha. Definido ANTES de :id pra Nest não tratar
   * "duplicatas" como id.
   */
  @Get("duplicatas")
  duplicatas() {
    return this.service.duplicatas();
  }

  /**
   * Locais de um grupo + pontos de descarga das viagens de cada, pro modal de
   * revisão de duplicata. Antes de :id.
   */
  @Get("duplicata-mapa")
  duplicataMapa(@Query(new ZodValidationPipe(DuplicataMapaQuery)) query: DuplicataMapaQuery) {
    const ids = query.ids
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);
    return this.service.duplicataMapa(ids);
  }

  /**
   * Grupos de locais ativos GEOGRAFICAMENTE próximos (prováveis duplicados do
   * mesmo lugar), com score de qualidade + gravidade. `raioM` = distância que
   * considera "mesmo lugar" (ajustável no painel, default 200). Definido ANTES
   * de :id pra Nest não tratar "duplicatas-geo" como id.
   */
  @Get("duplicatas-geo")
  duplicatasGeo(
    @Query(new ZodValidationPipe(DuplicatasGeoQuery)) query: z.infer<typeof DuplicatasGeoQuery>,
  ) {
    return this.service.duplicatasGeo(query.raioM);
  }

  /**
   * Foto do ponto (Street View, ou satélite onde não há cobertura) pra o admin
   * conferir se o pin caiu no lugar certo. Derivada do lat/lng e cacheada por
   * coordenada — serve tanto o detalhe quanto o preview do form (local ainda
   * sem id). ANTES de :id pra Nest não tratar "imagem" como id.
   */
  @Get("imagem")
  async imagem(
    @Query(new ZodValidationPipe(ImagemQuery)) query: z.infer<typeof ImagemQuery>,
    @Res() res: Response,
  ) {
    const { buffer, tipo } = await this.imagens.obter(query.lat, query.lng);
    res.set("Content-Type", "image/jpeg");
    res.set("X-Imagem-Tipo", tipo);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(buffer);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  /**
   * Pontos de lançamento (lat/lng da viagem) das viagens deste local — pra
   * plotar no mapa do "ver local". Mais recentes primeiro, limitado.
   */
  @Get(":id/lancamentos")
  lancamentos(@Param("id") id: string) {
    return this.service.lancamentos(id);
  }

  @RequerPermissao("locais.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarLocalInput)) body: CriarLocalInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("locais.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CriarLocalInput.partial())) body: Partial<CriarLocalInput>,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("locais.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  /**
   * Admin homologa o local — sobe pra HUMANO. Usado pela aba "Em validação"
   * pra confirmar locais que vieram com evidência boa.
   */
  @RequerPermissao("locais.homologar")
  @Post(":id/homologar")
  homologar(@Param("id") id: string) {
    return this.service.homologar(id);
  }

  /**
   * Mescla duplicata: move viagens do local atual pra destinoId e apaga o
   * atual. Pra quando o pre-check de 200m não pegou duplicata.
   */
  @RequerPermissao("locais.homologar")
  @Post(":id/mesclar")
  mesclar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MesclarInput)) body: z.infer<typeof MesclarInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.mesclar(id, body.destinoId, user.id);
  }
}
