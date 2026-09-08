import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AtualizarPerfilInput,
  AtualizarPlacasInput,
  CriarLancamentoPessoalInput,
  CriarViagemPessoalInput,
  EditarLancamentoPessoalInput,
  EditarViagemPessoalInput,
  RegistrarPushTokenInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ymdSaoPaulo } from "../common/timezone";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Roles } from "./decorators/roles.decorator";
import { RolesGuard } from "./guards/roles.guard";
import { EuService } from "./eu.service";
import { LancamentosPessoaisService } from "./lancamentos-pessoais.service";
import type { AuthIdentidade } from "./types";

/**
 * O que a PESSOA vê e faz sobre si mesma — vale com ou sem empresa.
 *
 * Prefixo próprio (`m/eu`) e papel próprio (`IDENTIDADE`) porque o token daqui
 * NÃO abre nada de empresa: quem não aceitou convite nenhum não tem dado de
 * transportadora pra ler. As rotas `m/*` continuam exigindo `MOTORISTA`, que é
 * o vínculo. Ver docs/identidade-motorista.md.
 */
@ApiTags("motorista")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("IDENTIDADE")
@Controller("m/eu")
export class EuController {
  constructor(
    private readonly service: EuService,
    private readonly lancamentos: LancamentosPessoaisService,
  ) {}

  @Get()
  perfil(@CurrentUser() user: AuthIdentidade) {
    return this.service.perfil(user.id);
  }

  @Patch()
  atualizar(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(AtualizarPerfilInput)) body: AtualizarPerfilInput,
  ) {
    return this.service.atualizarPerfil(user.id, body);
  }

  /**
   * Apagar a conta pelo próprio app — exigência da App Store (5.1.1-v).
   *
   * Sem corpo e sem confirmação no servidor: quem chega aqui já tem o token da
   * pessoa, e a confirmação é da tela (ele digita APAGAR). O que fica de fora é
   * a viagem rodada pra transportadora, que é documento fiscal dela — a resposta
   * diz quantos vínculos foram desligados pra tela poder contar isso pra ele.
   */
  @Delete()
  excluirConta(@CurrentUser() user: AuthIdentidade) {
    return this.service.excluirConta(user.id);
  }

  @Get("empresas")
  empresas(@CurrentUser() user: AuthIdentidade) {
    return this.service.empresas(user.id);
  }

  @Get("convites")
  convites(@CurrentUser() user: AuthIdentidade) {
    return this.service.convites(user.id);
  }

  @HttpCode(200)
  @Post("convites/:motoristaId/aceitar")
  aceitar(@CurrentUser() user: AuthIdentidade, @Param("motoristaId") motoristaId: string) {
    return this.service.aceitar(user.id, motoristaId);
  }

  @HttpCode(200)
  @Post("convites/:motoristaId/recusar")
  recusar(@CurrentUser() user: AuthIdentidade, @Param("motoristaId") motoristaId: string) {
    return this.service.recusar(user.id, motoristaId);
  }

  @Patch("placas")
  placas(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(AtualizarPlacasInput)) body: AtualizarPlacasInput,
  ) {
    return this.service.atualizarPlacas(user.id, body.placas, body.placaDefault);
  }

  // ---- O caderninho dele (gastos e recebimentos do próprio bolso) ----

  /** Lançamentos do mês (`?mes=YYYY-MM`; sem o parâmetro, o mês corrente). */
  @Get("lancamentos")
  lancamentosDoMes(@CurrentUser() user: AuthIdentidade, @Query("mes") mes?: string) {
    return this.lancamentos.listar(user.id, mesValido(mes));
  }

  @Get("lancamentos/resumo")
  resumoDoMes(@CurrentUser() user: AuthIdentidade, @Query("mes") mes?: string) {
    return this.lancamentos.resumo(user.id, mesValido(mes));
  }

  @HttpCode(200)
  @Post("lancamentos")
  criarLancamento(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(CriarLancamentoPessoalInput)) body: CriarLancamentoPessoalInput,
  ) {
    return this.lancamentos.criar(user.id, body);
  }

  /** Corrigir um gasto já lançado — o valor errado envenenava o mês pra sempre. */
  @Put("lancamentos/:id")
  editarLancamento(
    @CurrentUser() user: AuthIdentidade,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EditarLancamentoPessoalInput)) body: EditarLancamentoPessoalInput,
  ) {
    return this.lancamentos.editar(user.id, id, body);
  }

  @Delete("lancamentos/:id")
  apagarLancamento(@CurrentUser() user: AuthIdentidade, @Param("id") id: string) {
    return this.lancamentos.apagar(user.id, id);
  }

  // ---- As viagens que ele faz por conta própria ----

  @Get("viagens")
  viagensDoMes(@CurrentUser() user: AuthIdentidade, @Query("mes") mes?: string) {
    return this.lancamentos.listarViagens(user.id, mesValido(mes));
  }

  @HttpCode(200)
  @Post("viagens")
  criarViagem(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(CriarViagemPessoalInput)) body: CriarViagemPessoalInput,
  ) {
    return this.lancamentos.criarViagem(user.id, body);
  }

  /**
   * Corrigir um frete já gravado.
   *
   * É o que fecha o frete aberto pelo GPS guiado: ele nasce sem origem e sem
   * valor, e até existir esta rota não havia caminho nenhum pra completar.
   */
  @Put("viagens/:id")
  editarViagem(
    @CurrentUser() user: AuthIdentidade,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EditarViagemPessoalInput)) body: EditarViagemPessoalInput,
  ) {
    return this.lancamentos.editarViagem(user.id, id, body);
  }

  @Delete("viagens/:id")
  apagarViagem(@CurrentUser() user: AuthIdentidade, @Param("id") id: string) {
    return this.lancamentos.apagarViagem(user.id, id);
  }

  @HttpCode(200)
  @Post("push-token")
  pushToken(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(RegistrarPushTokenInput)) body: RegistrarPushTokenInput,
  ) {
    return this.service.registrarPushToken(user.id, body.token);
  }
}

/**
 * O mês pedido, ou o corrente.
 *
 * O corrente é ancorado em **São Paulo**: o container roda em UTC e, na virada
 * do mês, "hoje" pelo relógio do servidor já é dia 1º enquanto o motorista
 * ainda está no dia 30 — e ele veria o mês novo vazio no lugar do fechamento
 * do que acabou de rodar.
 */
function mesValido(mes?: string): string {
  if (mes) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      throw new BadRequestException("Mês inválido. Use o formato AAAA-MM.");
    }
    return mes;
  }
  const [ano, m] = ymdSaoPaulo();
  return `${ano}-${String(m).padStart(2, "0")}`;
}
