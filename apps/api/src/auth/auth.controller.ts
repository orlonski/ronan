import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  LoginInput,
  LoginMotoristaInput,
  RefreshInput,
  TrocarSenhaInput,
} from "@ronan/shared-types";
import { AuthService } from "./auth.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "./decorators/public.decorator";
import { Roles } from "./decorators/roles.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { RolesGuard } from "./guards/roles.guard";
import type { AuthMotorista } from "./types";

@ApiTags("auth")
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post("admin/auth/login")
  async loginAdmin(@Body(new ZodValidationPipe(LoginInput)) body: LoginInput) {
    return this.auth.loginAdmin(body.email, body.senha);
  }

  @Public()
  @HttpCode(200)
  @Post("admin/auth/refresh")
  async refreshAdmin(@Body(new ZodValidationPipe(RefreshInput)) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/login")
  async loginMotorista(
    @Body(new ZodValidationPipe(LoginMotoristaInput)) body: LoginMotoristaInput,
  ) {
    return this.auth.loginMotorista(body.usuario, body.senha);
  }

  @Public()
  @HttpCode(200)
  @Post("m/auth/refresh")
  async refreshMotorista(@Body(new ZodValidationPipe(RefreshInput)) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("MOTORISTA")
  @Post("m/auth/trocar-senha")
  async trocarSenha(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(TrocarSenhaInput)) body: TrocarSenhaInput,
  ) {
    await this.auth.trocarSenhaMotorista(user.id, body.senhaAtual, body.novaSenha);
    return { ok: true };
  }
}
