import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  atualizarLeadSchema,
  criarInteracaoSchema,
  listLeadsSchema,
  type AtualizarLeadInput,
  type CriarInteracaoInput,
  type ListLeadsParams,
} from "./prospeccao.schema";
import { ProspeccaoService } from "./prospeccao.service";
import { EnriquecimentoService } from "./enriquecimento.service";
import { LeadChatwootService } from "./lead-chatwoot.service";
import { RntrcService } from "./rntrc.service";

/**
 * Captação de clientes da plataforma.
 *
 * Gateado por `prospeccao.*`, que é chave de PLATAFORMA: o administrador de uma
 * transportadora cliente não recebe essas chaves e nem vê o menu. A lista de
 * quem a gente está prospectando não é assunto de quem já é cliente.
 */
@ApiTags("prospeccao")
@Roles("ADMIN_USER")
@Controller("admin/prospeccao")
export class ProspeccaoController {
  constructor(
    private readonly prospeccao: ProspeccaoService,
    private readonly rntrc: RntrcService,
    private readonly enriquecimento: EnriquecimentoService,
    private readonly chatwoot: LeadChatwootService,
  ) {}

  @RequerPermissao("prospeccao.ver")
  @Get("resumo")
  async resumo() {
    return this.prospeccao.resumo();
  }

  @RequerPermissao("prospeccao.ver")
  @Get("leads")
  async leads(@Query(new ZodValidationPipe(listLeadsSchema)) params: ListLeadsParams) {
    return this.prospeccao.listar(params);
  }

  @RequerPermissao("prospeccao.ver")
  @Get("leads/:id")
  async lead(@Param("id") id: string) {
    const achado = await this.prospeccao.detalhe(id);
    if (!achado) throw new NotFoundException("Lead não encontrado");
    return achado;
  }

  @RequerPermissao("prospeccao.editar")
  @Patch("leads/:id")
  async atualizarLead(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(atualizarLeadSchema)) body: AtualizarLeadInput,
  ) {
    return this.prospeccao.atualizar(id, body);
  }

  /**
   * Apaga o lead e a conversa dele. Sem desfazer.
   *
   * `prospeccao.excluir` é chave própria, não `editar`: quem arruma um telefone
   * errado não é necessariamente quem pode apagar um lead da base.
   */
  @RequerPermissao("prospeccao.excluir")
  @Delete("leads/:id")
  async excluirLead(@Param("id") id: string) {
    return this.prospeccao.excluir(id);
  }

  /** Registra um toque. `PEDIU_OPT_OUT` já dispara a supressão. */
  @RequerPermissao("prospeccao.editar")
  @Post("leads/:id/interacoes")
  async registrarInteracao(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(criarInteracaoSchema)) body: CriarInteracaoInput,
    @Req() req: { user?: { nome?: string; email?: string } },
  ) {
    return this.prospeccao.registrarInteracao(
      id,
      body,
      req.user?.nome ?? req.user?.email ?? undefined,
    );
  }

  /**
   * Dispara a carga do RNTRC. Demora minutos (o arquivo tem ~159 MB), então
   * responde só quando termina — não é rota pra chamar de tela sem aviso.
   */
  @RequerPermissao("prospeccao.importar")
  @Post("importar-rntrc")
  async importarRntrc(@Body() body: { ufs?: string[]; urlDireta?: string }) {
    return this.rntrc.importar({ ufs: body?.ufs, urlDireta: body?.urlDireta });
  }

  /**
   * Busca telefone e e-mail dos leads sem contato, do melhor pro pior.
   *
   * Vai devagar de propósito (~1 consulta por segundo): a fonte é um serviço
   * público gratuito. 500 leads levam uns 8 minutos; chamar de novo continua
   * de onde parou.
   */
  @RequerPermissao("prospeccao.importar")
  @Post("enriquecer")
  async enriquecer(@Body() body: { limite?: number; scoreMinimo?: number }) {
    return this.enriquecimento.enriquecerPendentes({
      limite: body?.limite,
      scoreMinimo: body?.scoreMinimo,
    });
  }

  /** Repontua a base sem rebaixar nada do trabalho de campo. Roda em segundos. */
  @RequerPermissao("prospeccao.importar")
  @Post("recalcular-scores")
  async recalcularScores() {
    return this.rntrc.recalcularScores();
  }

  /**
   * Sobe pro Chatwoot os leads que têm telefone, como contatos.
   *
   * Sem isto o contato só nascia quando a pessoa escrevia — quem a gente ainda
   * não abordou não existia no atendimento. Chamar de novo continua de onde
   * parou; quem já foi não vai duas vezes.
   */
  @RequerPermissao("prospeccao.importar")
  @Post("chatwoot/contatos")
  async sincronizarContatosChatwoot(@Body() body: { limite?: number }) {
    return this.chatwoot.sincronizarContatos(body?.limite);
  }

  /**
   * Prepara a conversa com esse lead no Chatwoot e devolve o endereço.
   *
   * Não manda mensagem: fora da janela de 24h a Meta só aceita template
   * aprovado, e quem escolhe a primeira palavra pra um lead frio é uma pessoa.
   */
  @RequerPermissao("prospeccao.editar")
  @Post("leads/:id/chatwoot/conversa")
  async abrirConversaChatwoot(@Param("id") id: string) {
    try {
      return await this.chatwoot.abrirConversa(id);
    } catch (e) {
      // A mensagem de erro daqui vai direto pra tela de quem clicou: "essa
      // empresa pediu pra não ser contatada" é resposta, não log.
      throw new BadRequestException((e as Error).message);
    }
  }

  /**
   * Registra que alguém pediu pra não ser mais contatado.
   *
   * Grava na tabela de supressão E marca o lead. A supressão é o que sobrevive
   * à próxima carga mensal; a marcação no lead é o que aparece na tela.
   */
  @RequerPermissao("prospeccao.editar")
  @Post("opt-out")
  async optOut(@Body() body: { contato: string; motivo?: string; fonte?: string }) {
    return this.prospeccao.registrarOptOut(body.contato, body.motivo, body.fonte);
  }
}
