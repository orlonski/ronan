import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { ORDEM_IMPORTACAO } from "../../common/importacao/campos";
import { montarModeloImportacao } from "../../common/importacao/modelo-planilha";
import { ImportacaoService } from "./importacao.service";

const LinhaSchema = z.object({
  numero: z.number().int(),
  valores: z.record(z.union([z.string(), z.number()])),
  chave: z.string(),
  erros: z.array(z.object({ campo: z.string(), mensagem: z.string() })),
  duplicadaNoArquivo: z.boolean().optional(),
});

const AplicarInput = z.object({
  entidade: z.string().min(2).max(40),
  empresaId: z.string().uuid().optional(),
  linhas: z.array(LinhaSchema).max(5000),
});

/**
 * Trazer a base que a transportadora já tem.
 *
 * Duas etapas de propósito: `analisar` não grava nada e devolve o que ENTRARIA,
 * `aplicar` grava o que o usuário confirmou. Importação de um clique só é a que
 * suja a base de um cliente novo no primeiro dia — e dessa não se volta.
 *
 * A permissão é um recurso PRÓPRIO (`importacao`) porque importar é ato de
 * implantação, e não a criação avulsa de um cadastro: quem pode criar um
 * cliente não deveria, por isso, poder reescrever a base inteira.
 */
@ApiTags("admin/importacao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/importacao")
export class ImportacaoController {
  constructor(private readonly service: ImportacaoService) {}

  /**
   * O que dá pra importar, e com que colunas. A tela monta o passo a passo daqui.
   *
   * Na ORDEM da implantação: viagem depende de motorista, veículo, cliente,
   * material e local já existirem. Listar em ordem alfabética faria o usuário
   * começar pela última.
   */
  @RequerPermissao("importacao.ver")
  @Get("entidades")
  entidades() {
    return ORDEM_IMPORTACAO.map((e) => ({
      chave: e.chave,
      rotulo: e.rotulo,
      descricao: e.descricao,
      chaveNatural: e.chaveNatural,
      campos: e.campos.map((c) => ({
        chave: c.chave,
        rotulo: c.rotulo,
        obrigatorio: c.obrigatorio,
        ajuda: c.ajuda,
        exemplos: c.sinonimos.slice(0, 4),
      })),
    }));
  }

  /**
   * A planilha modelo da entidade.
   *
   * O importador já aceita vários nomes de coluna, e isso resolve o arquivo
   * que o cliente JÁ tem. O que não resolvia é o caso mais comum: o cliente
   * não tem arquivo nenhum e não sabe por onde começar.
   */
  @RequerPermissao("importacao.ver")
  @Get(":entidade/modelo")
  async modelo(@Param("entidade") entidade: string, @Res() res: Response) {
    const def = ORDEM_IMPORTACAO.find((e) => e.chave === entidade);
    if (!def) throw new BadRequestException("Não sei importar isso.");
    const buffer = await montarModeloImportacao(def);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="modelo-${def.chave}.xlsx"`);
    res.send(buffer);
  }

  @RequerPermissao("importacao.executar")
  @HttpCode(200)
  @Post("analisar")
  // 10 MB: uma planilha de cadastro da maior transportadora não chega perto
  // disso, e o teto evita que um .xlsx com imagem colada derrube o processo.
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: 10 * 1024 * 1024 } }))
  analisar(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body() body: { entidade?: string; mapa?: string; linhaCabecalho?: string },
  ) {
    if (!arquivo) throw new BadRequestException("Envie a planilha.");
    return this.service.analisar({
      entidade: String(body.entidade ?? ""),
      buffer: arquivo.buffer,
      nomeArquivo: arquivo.originalname,
      mimetype: arquivo.mimetype,
      // Vêm como texto porque o corpo é multipart — o usuário corrigiu o
      // palpite na tela e reenviou o mesmo arquivo.
      mapa: body.mapa ? JSON.parse(body.mapa) : undefined,
      linhaCabecalho:
        body.linhaCabecalho !== undefined ? Number(body.linhaCabecalho) : undefined,
    });
  }

  @RequerPermissao("importacao.executar")
  @HttpCode(200)
  @Post("aplicar")
  aplicar(
    @Body(new ZodValidationPipe(AplicarInput)) body: z.infer<typeof AplicarInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.aplicar({
      entidade: body.entidade,
      linhas: body.linhas,
      empresaId: body.empresaId,
      usuarioId: user.id,
    });
  }
}
