import { applyDecorators, Controller, Headers, Res, UseFilters, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import type { z } from "zod";
import { Public } from "../auth/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { IntegracaoAtual, IntegracaoGuard, type AuthIntegracao } from "./integracao.guard";
import { ContratoInterceptor, Entrada, RotaV1 } from "./rota-v1";
import { ErroPublicoFilter } from "./erro-publico.filter";
import { ErroPublico } from "./erros";
import {
  AtualizarViagemV1,
  CriarViagemV1,
  EuV1,
  ParamId,
  ParamIdExterno,
  PutLocalV1,
  PutMotoristaV1,
  PutVeiculoV1,
  RespostaGravarViagemV1,
  RespostaLocalV1,
  RespostaMotoristaV1,
  RespostaVeiculoV1,
  ViagemV1,
} from "./contrato";
import { ViagensPublicaService } from "./viagens-publica.service";
import { CadastrosPublicaService } from "./cadastros-publica.service";

/**
 * Tudo que um controller da `/v1` precisa, num decorator só (o boot-check
 * confere que todos usam):
 *  - `@Public()`: não é JWT. Os guards globais do painel não veem a chave;
 *    quem cobra tudo é o `IntegracaoGuard`, fechado por padrão;
 *  - o contrato valida a entrada; o filtro dá o formato único de erro;
 *  - fora do Swagger interno — a documentação pública é a `/v1/docs`.
 */
export function ControllerV1(): ClassDecorator {
  return applyDecorators(
    ApiExcludeController(),
    Public(),
    Controller("v1"),
    UseGuards(IntegracaoGuard),
    UseInterceptors(ContratoInterceptor),
    UseFilters(ErroPublicoFilter),
  );
}

function chaveIdempotencia(h: string | undefined): string | undefined {
  if (h === undefined) return undefined;
  const t = h.trim();
  if (t.length < 8 || t.length > 255) {
    throw new ErroPublico("VALIDACAO", "Idempotency-Key precisa ter de 8 a 255 caracteres (use um UUID).");
  }
  return t;
}

const ERROS_DE_ACESSO = ["NAO_AUTENTICADO", "CHAVE_REVOGADA", "EMPRESA_INDISPONIVEL", "MODULO_NAO_CONTRATADO", "ESCOPO_INSUFICIENTE", "LIMITE_EXCEDIDO"] as const;
const ERROS_DE_ESCRITA = [...ERROS_DE_ACESSO, "CONTA_SOMENTE_LEITURA", "VALIDACAO", "CORPO_GRANDE_DEMAIS"] as const;

@ControllerV1()
export class EuV1Controller {
  constructor(private readonly prisma: PrismaService) {}

  @RotaV1({
    metodo: "get",
    caminho: "/eu",
    escopo: null,
    grupo: "Conexão",
    resumo: "Testa a chave",
    descricao: "Diz de qual empresa e de qual integração é a chave, e o que ela pode fazer. Bom primeiro passo.",
    sucesso: { status: 200, descricao: "Chave válida.", schema: EuV1 },
    erros: [...ERROS_DE_ACESSO],
  })
  async eu(@IntegracaoAtual() integ: AuthIntegracao): Promise<z.infer<typeof EuV1>> {
    const conta = await this.prisma.conta.findUnique({ where: { id: integ.contaId }, select: { nome: true } });
    return {
      integracao: { id: integ.integracaoId, nome: integ.nome, sistema: integ.sistema },
      empresa: { nome: conta?.nome ?? "" },
      escopos: integ.escopos,
    };
  }
}

@ControllerV1()
export class ViagensV1Controller {
  constructor(private readonly viagens: ViagensPublicaService) {}

  @RotaV1({
    metodo: "post",
    caminho: "/viagens",
    escopo: "viagens:escrever",
    grupo: "Viagens",
    resumo: "Cria uma viagem",
    descricao:
      "Mande `externo` (o número da viagem no sistema de vocês) ou o cabeçalho `Idempotency-Key`: sem nenhum dos dois, um reenvio duplicaria a viagem. " +
      "Com `externo` já usado, a viagem existente é atualizada (mesma regra do PUT). " +
      "Sem `toneladas`, a viagem entra como AGUARDANDO_PESO e fica fora de fechamento até ter peso. " +
      "O valor (R$) sai da tabela de preço da empresa no Movatruck; não é aceito de fora.",
    corpo: CriarViagemV1,
    idempotente: true,
    sucesso: { status: 201, descricao: "Criada.", schema: RespostaGravarViagemV1 },
    outrosSucessos: [{ status: 200, descricao: "Já existia (mesmo `externo` ou mesma Idempotency-Key): atualizada ou devolvida." }],
    erros: [...ERROS_DE_ESCRITA, "IDENTIFICACAO_OBRIGATORIA", "REFERENCIA_OBRIGATORIA", "IDEMPOTENCIA_CONFLITO", "REQUISICAO_EM_ANDAMENTO", "VIAGEM_DE_OUTRA_ORIGEM", "VIAGEM_TRAVADA"],
  })
  async criar(
    @IntegracaoAtual() integ: AuthIntegracao,
    @Entrada("corpo") corpo: z.infer<typeof CriarViagemV1>,
    @Headers("idempotency-key") idem: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.viagens.criar(integ, corpo, chaveIdempotencia(idem));
    res.status(r.status);
    return r.corpo;
  }

  @RotaV1({
    metodo: "put",
    caminho: "/viagens/externo/{idExterno}",
    escopo: "viagens:escrever",
    grupo: "Viagens",
    resumo: "Cria ou atualiza pelo número de vocês",
    descricao:
      "Só altera viagem criada por esta integração. Viagem conferida, em fechamento ou em acerto não muda mais (VIAGEM_TRAVADA). " +
      "Campo que uma pessoa corrigiu no painel fica como ela deixou, e a resposta traz o aviso CAMPO_PROTEGIDO.",
    params: ParamIdExterno,
    corpo: AtualizarViagemV1,
    idempotente: true,
    sucesso: { status: 200, descricao: "Atualizada.", schema: RespostaGravarViagemV1 },
    outrosSucessos: [{ status: 201, descricao: "Não existia: criada." }],
    erros: [...ERROS_DE_ESCRITA, "REFERENCIA_OBRIGATORIA", "IDEMPOTENCIA_CONFLITO", "REQUISICAO_EM_ANDAMENTO", "VIAGEM_DE_OUTRA_ORIGEM", "VIAGEM_TRAVADA"],
  })
  async gravarPorExterno(
    @IntegracaoAtual() integ: AuthIntegracao,
    @Entrada("params") params: z.infer<typeof ParamIdExterno>,
    @Entrada("corpo") corpo: z.infer<typeof AtualizarViagemV1>,
    @Headers("idempotency-key") idem: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.viagens.gravarPorExterno(integ, params.idExterno, corpo, chaveIdempotencia(idem));
    res.status(r.status);
    return r.corpo;
  }

  @RotaV1({
    metodo: "get",
    caminho: "/viagens/externo/{idExterno}",
    escopo: "viagens:ler",
    grupo: "Viagens",
    resumo: "Lê uma viagem pelo número de vocês",
    params: ParamIdExterno,
    sucesso: { status: 200, descricao: "A viagem.", schema: ViagemV1 },
    erros: [...ERROS_DE_ACESSO, "NAO_ENCONTRADO"],
  })
  lerPorExterno(@IntegracaoAtual() integ: AuthIntegracao, @Entrada("params") params: z.infer<typeof ParamIdExterno>) {
    return this.viagens.lerPorExterno(integ, params.idExterno);
  }

  @RotaV1({
    metodo: "get",
    caminho: "/viagens/{id}",
    escopo: "viagens:ler",
    grupo: "Viagens",
    resumo: "Lê uma viagem pelo id do Movatruck",
    params: ParamId,
    sucesso: { status: 200, descricao: "A viagem.", schema: ViagemV1 },
    erros: [...ERROS_DE_ACESSO, "NAO_ENCONTRADO"],
  })
  lerPorId(@IntegracaoAtual() integ: AuthIntegracao, @Entrada("params") params: z.infer<typeof ParamId>) {
    return this.viagens.lerPorId(integ, params.id);
  }
}

@ControllerV1()
export class CadastrosV1Controller {
  constructor(private readonly cadastros: CadastrosPublicaService) {}

  @RotaV1({
    metodo: "put",
    caminho: "/motoristas/externo/{idExterno}",
    escopo: "cadastros:escrever",
    grupo: "Cadastros",
    resumo: "Cria ou atualiza um motorista",
    descricao:
      "Se já existe motorista com o mesmo CPF nesta empresa, ele é ligado ao número de vocês e NÃO é alterado. " +
      "O motorista criado aqui existe pras viagens e pro acerto; ele não entra no app (o convite pro app é feito por uma pessoa no painel) " +
      "e não recebe mensagem nossa.",
    params: ParamIdExterno,
    corpo: PutMotoristaV1,
    sucesso: { status: 200, descricao: "Já existia.", schema: RespostaMotoristaV1 },
    outrosSucessos: [{ status: 201, descricao: "Criado." }],
    erros: [...ERROS_DE_ESCRITA],
  })
  async motorista(
    @IntegracaoAtual() integ: AuthIntegracao,
    @Entrada("params") params: z.infer<typeof ParamIdExterno>,
    @Entrada("corpo") corpo: z.infer<typeof PutMotoristaV1>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.cadastros.motorista(integ, params.idExterno, corpo);
    res.status(r.status);
    return r.corpo;
  }

  @RotaV1({
    metodo: "put",
    caminho: "/veiculos/externo/{idExterno}",
    escopo: "cadastros:escrever",
    grupo: "Cadastros",
    resumo: "Cria ou atualiza um caminhão",
    descricao: "Se já existe caminhão com a mesma placa nesta empresa, ele é ligado ao número de vocês e NÃO é alterado.",
    params: ParamIdExterno,
    corpo: PutVeiculoV1,
    sucesso: { status: 200, descricao: "Já existia.", schema: RespostaVeiculoV1 },
    outrosSucessos: [{ status: 201, descricao: "Criado." }],
    erros: [...ERROS_DE_ESCRITA],
  })
  async veiculo(
    @IntegracaoAtual() integ: AuthIntegracao,
    @Entrada("params") params: z.infer<typeof ParamIdExterno>,
    @Entrada("corpo") corpo: z.infer<typeof PutVeiculoV1>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.cadastros.veiculo(integ, params.idExterno, corpo);
    res.status(r.status);
    return r.corpo;
  }

  @RotaV1({
    metodo: "put",
    caminho: "/locais/externo/{idExterno}",
    escopo: "cadastros:escrever",
    grupo: "Cadastros",
    resumo: "Cria ou atualiza um local de carga ou descarga",
    descricao:
      "Local não é casado por nome (nomes se repetem): sem o número de vocês, nasce um novo. " +
      "A coordenada de um local que o app do motorista já usou só muda pelo painel.",
    params: ParamIdExterno,
    corpo: PutLocalV1,
    sucesso: { status: 200, descricao: "Já existia.", schema: RespostaLocalV1 },
    outrosSucessos: [{ status: 201, descricao: "Criado." }],
    erros: [...ERROS_DE_ESCRITA, "VIAGEM_DE_OUTRA_ORIGEM"],
  })
  async local(
    @IntegracaoAtual() integ: AuthIntegracao,
    @Entrada("params") params: z.infer<typeof ParamIdExterno>,
    @Entrada("corpo") corpo: z.infer<typeof PutLocalV1>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.cadastros.local(integ, params.idExterno, corpo);
    res.status(r.status);
    return r.corpo;
  }
}
