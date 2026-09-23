import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { CteService } from "./cte.service";

const ConfigInput = z.object({
  cteEmissor: z.enum(["SIMULADOR", "GATEWAY", "SEFAZ"]).optional(),
  /** UF do autorizador. Separada da UF do endereço. */
  cteUfAutorizador: z.string().trim().length(2).toUpperCase().nullish(),
  cteAmbiente: z.union([z.literal(1), z.literal(2)]).optional(),
  cteSerie: z.number().int().min(0).max(999).optional(),
  cteNaturezaCfop: z.string().trim().regex(/^\d{3}$/, "Use os 3 últimos dígitos, ex.: 353").nullish(),
  cteNaturezaOperacao: z.string().trim().max(60).nullish(),
  cteIcmsTipo: z.enum(["SN", "00", "20", "45", "60", "90"]).nullish(),
  cteIcmsAliquota: z.coerce.number().min(0).max(100).nullish(),
  cteIcmsReducao: z.coerce.number().min(0).max(100).nullish(),
  cteIcmsCst: z.enum(["40", "41", "51"]).nullish(),
  cteGatewayUrl: z.string().trim().url().nullish().or(z.literal("")),
  /** Vazio = não mexi. O servidor nunca devolve o token, então em branco não
   *  pode significar "apague" — significaria perder a credencial a cada save. */
  cteGatewayToken: z.string().trim().max(500).nullish(),
});

const CertificadoInput = z.object({
  senha: z.string().min(1, "Informe a senha do certificado").max(200),
});

const CancelarInput = z.object({
  // A SEFAZ exige 15 caracteres. Cobrar aqui evita gastar o evento de
  // cancelamento — que é contado e aparece na consulta do documento.
  justificativa: z.string().trim().min(15, "A justificativa precisa ter ao menos 15 letras").max(255),
});

/**
 * Emissão de CT-e.
 *
 * Recurso próprio na matriz, e não `viagens.editar`: emitir documento fiscal é
 * ato com consequência jurídica — quem lança uma viagem não deveria, por isso,
 * poder emitir em nome da empresa.
 *
 * O EMISSOR (config, certificado, testar conexão, emitir teste) é outra tela e
 * outra chave, `config-cte`, desde 23/09/2026: quem confere os CT-e emitidos
 * não precisa, por isso, enxergar nem trocar o certificado A1 da empresa.
 */
@ApiTags("admin/cte")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/cte")
export class CteController {
  constructor(private readonly service: CteService) {}

  @RequerPermissao("cte.ver")
  @Get()
  listar(@Query("status") status?: string, @Query("viagemId") viagemId?: string) {
    return this.service.listar({ status, viagemId });
  }

  /**
   * O que sairia, e o que falta pra sair. NÃO consome número nem grava nada:
   * buraco na numeração é coisa que a SEFAZ pergunta, e gastar um número num
   * documento que a validação local já sabia que ia falhar cria um.
   */
  @RequerPermissao("cte.ver")
  @Get("previa/:viagemId")
  previa(@Param("viagemId") viagemId: string) {
    return this.service.previa(viagemId);
  }

  /**
   * A configuração de emissão. Declarada ANTES de `:id` — senão a rota
   * `/admin/cte/config` cairia no detalhe de um documento chamado "config".
   */
  @RequerPermissao("config-cte.ver")
  @Get("config")
  config() {
    return this.service.configuracao();
  }

  @RequerPermissao("config-cte.editar")
  @Patch("config")
  salvarConfig(
    @Body(new ZodValidationPipe(ConfigInput)) body: z.infer<typeof ConfigInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarConfiguracao(user.contaId, body as never);
  }

  /** O certificado que está guardado. Nunca o arquivo, nunca a senha. */
  @RequerPermissao("config-cte.ver")
  @Get("certificado")
  certificado() {
    return this.service.certificadoResumo();
  }

  /**
   * Sobe o A1.
   *
   * Os metadados saem do PRÓPRIO arquivo — CNPJ, titular e validade. Digitar
   * qualquer um seria a brecha pra cadastrar o certificado de uma empresa
   * dizendo que é de outra.
   */
  @RequerPermissao("config-cte.editar")
  @HttpCode(200)
  @Post("certificado")
  // 512 KB: um A1 tem uns poucos KB, e o teto evita que um arquivo trocado por
  // engano atravesse a rede inteira antes de ser recusado.
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: 512 * 1024 } }))
  subirCertificado(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(CertificadoInput)) body: z.infer<typeof CertificadoInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    if (!arquivo) throw new BadRequestException("Envie o arquivo .pfx do certificado.");
    return this.service.salvarCertificado(arquivo.buffer, body.senha, user.id);
  }

  /**
   * "A SEFAZ está no ar e o meu certificado serve?"
   *
   * A única chamada que não precisa de documento nenhum, e por isso a primeira
   * que se faz: prova certificado, cadeia, credenciamento e rede de uma vez,
   * sem arriscar um CT-e nem queimar um número da série.
   */
  @RequerPermissao("config-cte.ver")
  @HttpCode(200)
  @Post("testar-conexao")
  testarConexao() {
    return this.service.testarConexao();
  }

  /**
   * Emite um CT-e sintético contra a SEFAZ de homologação.
   *
   * Responde em um clique o que nenhum teste de unidade responde: "o que a
   * SEFAZ diz do MEU documento, com o MEU certificado?". A rejeição é resultado
   * válido — ela vem com código e motivo da própria SEFAZ, mais útil que
   * qualquer suposição nossa sobre o que falta.
   *
   * Série 999, reservada: passa pelo mesmo caminho da emissão real sem gastar
   * número da numeração fiscal de verdade.
   */
  @RequerPermissao("config-cte.editar")
  @HttpCode(200)
  @Post("emitir-teste")
  emitirTeste(@CurrentUser() user: AuthAdminUser) {
    return this.service.emitirTeste(user.id);
  }

  @RequerPermissao("cte.ver")
  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  /**
   * O DACTE em PDF.
   *
   * `inline` e não `attachment`: quem clica nisso quase sempre quer CONFERIR na
   * tela antes de mandar imprimir, e forçar download põe um arquivo na pasta de
   * downloads a cada olhada.
   */
  @RequerPermissao("cte.ver")
  @Get(":id/dacte")
  async dacte(@Param("id") id: string, @Res() res: Response) {
    const { pdf, nome } = await this.service.dacte(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nome}.pdf"`);
    // Documento fiscal de UMA empresa: cache intermediário serviria o DACTE de
    // uma conta pra outra.
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  }

  @RequerPermissao("cte.emitir")
  @HttpCode(200)
  @Post("emitir/:viagemId")
  emitir(@Param("viagemId") viagemId: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.emitir(viagemId, user.id);
  }

  @RequerPermissao("cte.cancelar")
  @HttpCode(200)
  @Post(":id/cancelar")
  cancelar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CancelarInput)) body: z.infer<typeof CancelarInput>,
  ) {
    return this.service.cancelar(id, body.justificativa);
  }
}
