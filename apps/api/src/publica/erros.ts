import { HttpException } from "@nestjs/common";

/**
 * Os códigos de erro da API pública. Estáveis: o integrador escreve `if
 * (erro.codigo === "VIAGEM_TRAVADA")` no código dele, então mudar um nome aqui
 * quebra cliente. Código novo pode entrar; código existente não muda.
 *
 * Nenhum erro da `/v1` sai com um código fora desta lista (o filtro troca por
 * ERRO_INTERNO) — há teste.
 */
export const ERROS_PUBLICOS = {
  NAO_AUTENTICADO: { status: 401, mensagem: "Mande a chave de acesso no cabeçalho Authorization: Bearer mvt_live_…" },
  CHAVE_REVOGADA: { status: 401, mensagem: "Esta chave foi desligada. Peça uma nova a quem administra a empresa no Movatruck." },
  EMPRESA_INDISPONIVEL: { status: 403, mensagem: "A empresa desta chave está com o acesso suspenso." },
  CONTA_SOMENTE_LEITURA: { status: 403, mensagem: "A empresa está em modo somente leitura: dá pra consultar, não dá pra gravar." },
  MODULO_NAO_CONTRATADO: { status: 403, mensagem: "A empresa não tem o módulo Integrações contratado." },
  ESCOPO_INSUFICIENTE: { status: 403, mensagem: "Esta chave não tem permissão pra isso." },
  VALIDACAO: { status: 400, mensagem: "Algum campo veio errado. Veja `detalhes`." },
  IDENTIFICACAO_OBRIGATORIA: {
    status: 400,
    mensagem: "Mande `externo` no corpo ou o cabeçalho Idempotency-Key — senão um reenvio cria a viagem duas vezes.",
  },
  NAO_ENCONTRADO: { status: 404, mensagem: "Não existe." },
  REFERENCIA_OBRIGATORIA: { status: 422, mensagem: "Não achamos o motorista ou o caminhão informado." },
  IDEMPOTENCIA_CONFLITO: {
    status: 422,
    mensagem: "Esta Idempotency-Key já foi usada com outro conteúdo. Use uma chave nova pra um pedido novo.",
  },
  REQUISICAO_EM_ANDAMENTO: { status: 409, mensagem: "Um pedido igual ainda está sendo processado. Tente de novo em alguns segundos." },
  VIAGEM_DE_OUTRA_ORIGEM: {
    status: 409,
    mensagem: "Esta viagem não foi criada por este sistema (veio do app do motorista ou do painel). Ela só pode ser lida.",
  },
  VIAGEM_TRAVADA: {
    status: 409,
    mensagem: "A viagem já foi conferida, entrou num fechamento ou num acerto. Correção agora só pelo painel.",
  },
  LIMITE_EXCEDIDO: { status: 429, mensagem: "Chamadas demais em pouco tempo. Espere os segundos de Retry-After." },
  CORPO_GRANDE_DEMAIS: { status: 413, mensagem: "O corpo passa de 1 MB." },
  ERRO_INTERNO: { status: 500, mensagem: "Erro do nosso lado. Já ficou registrado; tente de novo em instantes." },
} as const;

export type CodigoErroPublico = keyof typeof ERROS_PUBLICOS;

export type DetalheErro = { campo: string; codigo: string; mensagem: string };

/**
 * O erro que a `/v1` lança. Carrega o código estável; o filtro monta o envelope
 * `{ erro: { codigo, mensagem, detalhes, requisicaoId } }`.
 */
export class ErroPublico extends HttpException {
  constructor(
    readonly codigo: CodigoErroPublico,
    mensagem?: string,
    readonly detalhes?: DetalheErro[],
    readonly cabecalhos?: Record<string, string>,
  ) {
    super({ codigo, mensagem: mensagem ?? ERROS_PUBLICOS[codigo].mensagem }, ERROS_PUBLICOS[codigo].status);
  }
}
