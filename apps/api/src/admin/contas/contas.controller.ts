import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { ContasService } from "./contas.service";

const CriarContaBody = z.object({
  nome: z.string().trim().min(2, "Diga o nome da empresa."),
  slug: z.string().trim().optional(),
  // CPF (11) ou CNPJ (14) — chega com máscara da tela, guarda só dígitos.
  cnpj: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine(
      (v) => v === "" || v.length === 11 || v.length === 14,
      "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)",
    )
    .optional(),
  adminNome: z.string().trim().min(2, "Diga o nome de quem vai administrar."),
  adminEmail: z.string().trim().email("E-mail inválido."),
  adminSenha: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
});

const AtivaBody = z.object({ ativa: z.boolean() });

/**
 * Gestão das empresas que usam o sistema. Fica atrás do `PlataformaGuard`, e não
 * do catálogo de permissões: criar empresa não é algo que um administrador de
 * empresa possa ganhar por engano na matriz de papéis.
 */
@ApiTags("admin/contas")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/contas")
export class ContasController {
  constructor(private readonly service: ContasService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  criar(@Body(new ZodValidationPipe(CriarContaBody)) body: z.infer<typeof CriarContaBody>) {
    return this.service.criar(body);
  }

  @Patch(":id/ativa")
  definirAtiva(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtivaBody)) body: z.infer<typeof AtivaBody>,
  ) {
    return this.service.definirAtiva(id, body.ativa);
  }

  @Patch(":id/auto-cadastro")
  definirAutoCadastro(@Param("id") id: string) {
    return this.service.definirAutoCadastro(id);
  }

  @Post(":id/logo")
  @UseInterceptors(FileInterceptor("logo"))
  async enviarLogo(@Param("id") id: string, @UploadedFile() arquivo?: Express.Multer.File) {
    validarLogo(arquivo);
    return this.service.definirLogo(id, arquivo!.buffer, arquivo!.mimetype);
  }

  @Delete(":id/logo")
  removerLogo(@Param("id") id: string) {
    return this.service.removerLogo(id);
  }

  @Post(":id/codigo-convite")
  trocarCodigo(@Param("id") id: string) {
    return this.service.trocarCodigoConvite(id);
  }
}

const LOGO_TIPOS = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Compartilhado entre a tela da plataforma e a da própria empresa. */
export function validarLogo(arquivo?: Express.Multer.File): void {
  if (!arquivo) throw new BadRequestException("Escolha um arquivo de imagem.");
  if (!LOGO_TIPOS.includes(arquivo.mimetype)) {
    throw new BadRequestException("A logo precisa ser PNG, JPG ou WEBP.");
  }
  if (arquivo.size > LOGO_MAX_BYTES) {
    throw new BadRequestException("A logo precisa ter no máximo 2 MB.");
  }
}

/**
 * A empresa mexendo na marca dela mesma. Rota separada de propósito: aqui o id
 * NÃO vem da URL, vem do usuário logado — senão um admin poderia trocar a logo
 * de outra empresa só mudando o id no endereço.
 */
@ApiTags("admin/minha-empresa")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/minha-empresa")
export class MinhaEmpresaController {
  constructor(private readonly service: ContasService) {}

  @RequerPermissao("minha-empresa.editar")
  @Post("logo")
  @UseInterceptors(FileInterceptor("logo"))
  async enviarLogo(
    @CurrentUser() user: AuthAdminUser,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    validarLogo(arquivo);
    return this.service.definirLogo(user.contaId, arquivo!.buffer, arquivo!.mimetype);
  }

  @RequerPermissao("minha-empresa.editar")
  @Delete("logo")
  removerLogo(@CurrentUser() user: AuthAdminUser) {
    return this.service.removerLogo(user.contaId);
  }

  /**
   * Troca o código de convite da empresa. Serve pra quando ele circulou além do
   * time — o antigo para de valer na hora, e quem estava com ele não consegue
   * mais mandar cadastro pra cá.
   */
  @RequerPermissao("minha-empresa.editar")
  @Post("codigo-convite")
  trocarCodigo(@CurrentUser() user: AuthAdminUser) {
    return this.service.trocarCodigoConvite(user.contaId);
  }
}
