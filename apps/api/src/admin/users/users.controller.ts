import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarUserInput, CriarUserInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { UsersService } from "./users.service";

const ListUsersQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListUsersQuery = z.infer<typeof ListUsersQuery>;

@ApiTags("admin/users")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/users")
export class UsersController {
  constructor(private readonly service: UsersService) {}

  // Sem @RequerPermissao de propósito (todo mundo precisa ler as próprias
  // permissões pra montar a sidebar) e sem escopo: o id vem do token, então só
  // devolve o próprio usuário. É a exceção à regra "todo @IgnoraEscopo exige
  // @RequerPermissao" — aqui não há dado de outra frota pra vazar.
  @IgnoraEscopo()
  @Roles("ADMIN_USER")
  @Get("me")
  me(@CurrentUser() user: AuthAdminUser) {
    return this.service.me(user.id);
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("usuarios.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListUsersQuery)) query: ListUsersQuery) {
    return this.service.list(query);
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("usuarios.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("usuarios.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarUserInput)) body: CriarUserInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    this.ensurePodeAtribuirPapel(body.papelId, user);
    this.ensurePodeDefinirEscopo(body, user);
    return this.service.create(body, user.id);
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("usuarios.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarUserInput)) body: AtualizarUserInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    this.ensurePodeAtribuirPapel(body.papelId, user);
    this.ensurePodeDefinirEscopo(body, user);
    return this.service.update(id, body);
  }

  /**
   * "usuarios.editar/criar" só cobre os dados do usuário. Atribuir papel é uma
   * ação de RBAC (pode dar acesso total via papel Administrador) e exige
   * "permissoes.gerenciar" — senão qualquer papel com edição de usuário vira
   * escalonamento de privilégio.
   */
  private ensurePodeAtribuirPapel(
    papelId: string | null | undefined,
    user: AuthAdminUser,
  ) {
    if (papelId === undefined) return;
    if (!user.permissoes.includes("permissoes.gerenciar")) {
      throw new ForbiddenException(
        "Você não tem permissão para atribuir papel a um usuário.",
      );
    }
  }

  /**
   * Mesmo raciocínio do papel: definir escopo é ação de RBAC, não dado
   * cadastral. Sem esta trava, quem tem "usuarios.editar" — inclusive um gestor
   * restrito editando o PRÓPRIO usuário — liga `acessoGlobal` e passa a ver a
   * base inteira. Escalonamento de privilégio em um PATCH.
   */
  private ensurePodeDefinirEscopo(
    body: { acessoGlobal?: boolean; transportadoraIds?: string[] },
    user: AuthAdminUser,
  ) {
    if (body.acessoGlobal === undefined && body.transportadoraIds === undefined) return;
    if (!user.permissoes.includes("permissoes.gerenciar")) {
      throw new ForbiddenException(
        "Você não tem permissão para definir o acesso por transportadora.",
      );
    }
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("usuarios.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
