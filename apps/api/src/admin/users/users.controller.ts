import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AtualizarUserInput, CriarUserInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { UsersService } from "./users.service";

@ApiTags("admin/users")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/users")
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Roles("ADMIN", "OPERADOR")
  @Get("me")
  me(@CurrentUser() user: AuthAdminUser) {
    return this.service.me(user.id);
  }

  @Roles("ADMIN")
  @Get()
  list() {
    return this.service.list();
  }

  @Roles("ADMIN")
  @Post()
  create(@Body(new ZodValidationPipe(CriarUserInput)) body: CriarUserInput) {
    return this.service.create(body);
  }

  @Roles("ADMIN")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarUserInput)) body: AtualizarUserInput,
  ) {
    return this.service.update(id, body);
  }

  @Roles("ADMIN")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
