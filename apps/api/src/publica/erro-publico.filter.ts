import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { conteudoParaGuardar, mascararTexto, urlSemSegredo } from "../common/chamadas-externas/registro";
import { ErrorsService } from "../errors/errors.service";
import { ERROS_PUBLICOS, ErroPublico, type CodigoErroPublico } from "./erros";

/** Status HTTP de um erro que não veio como `ErroPublico` → o código público mais próximo. */
const CODIGO_DO_STATUS: Record<number, CodigoErroPublico> = {
  400: "VALIDACAO",
  401: "NAO_AUTENTICADO",
  403: "ESCOPO_INSUFICIENTE",
  404: "NAO_ENCONTRADO",
  409: "REQUISICAO_EM_ANDAMENTO",
  413: "CORPO_GRANDE_DEMAIS",
  422: "VALIDACAO",
  429: "LIMITE_EXCEDIDO",
};

/**
 * O formato único de erro da `/v1`:
 *
 *   { "erro": { "codigo": "KM_PROTEGIDO", "mensagem": "…", "detalhes": [...], "requisicaoId": "req_…" } }
 *
 * Exceção que não é `ErroPublico` (um service reaproveitado que lança
 * `BadRequestException` em português) sai com o código mais próximo do status;
 * erro sem status vira ERRO_INTERNO, vai pro registro de erros e NUNCA ecoa a
 * mensagem original (pode trazer nome de constraint ou valor de outra linha).
 */
@Injectable()
@Catch()
export class ErroPublicoFilter implements ExceptionFilter {
  private readonly log = new Logger("ErroPublicoFilter");

  constructor(private readonly errors: ErrorsService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requisicaoId = `req_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    let codigo: CodigoErroPublico;
    let mensagem: string;
    let detalhes: unknown;
    let cabecalhos: Record<string, string> | undefined;

    if (exception instanceof ErroPublico) {
      codigo = exception.codigo;
      mensagem = (exception.getResponse() as { mensagem: string }).mensagem;
      detalhes = exception.detalhes;
      cabecalhos = exception.cabecalhos;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === "P2003") {
      // FK que não existe (na conta): é referência errada do integrador, não bug nosso.
      codigo = "NAO_ENCONTRADO";
      mensagem = "Algum id informado não existe.";
    } else if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      codigo = CODIGO_DO_STATUS[status] ?? "VALIDACAO";
      const corpo = exception.getResponse();
      // Mensagem em português de um service reaproveitado: útil e sem dado de
      // outra linha (são frases escritas por nós). Corpo do Express (413) idem.
      const original = typeof corpo === "string" ? corpo : (corpo as { message?: unknown }).message;
      mensagem = typeof original === "string" ? original : ERROS_PUBLICOS[codigo].mensagem;
      if ((exception as { type?: string }).type === "entity.too.large" || status === 413) codigo = "CORPO_GRANDE_DEMAIS";
    } else if (ehCorpoGrande(exception)) {
      codigo = "CORPO_GRANDE_DEMAIS";
      mensagem = ERROS_PUBLICOS.CORPO_GRANDE_DEMAIS.mensagem;
    } else {
      codigo = "ERRO_INTERNO";
      mensagem = ERROS_PUBLICOS.ERRO_INTERNO.mensagem;
      await this.registrar(exception, req, requisicaoId);
    }

    const status = ERROS_PUBLICOS[codigo].status;
    (res.locals as { codigoErroPublico?: string }).codigoErroPublico = codigo;
    if (cabecalhos) for (const [k, v] of Object.entries(cabecalhos)) res.setHeader(k, v);
    res.setHeader("X-Requisicao-Id", requisicaoId);
    res.status(status).json({
      erro: { codigo, mensagem, ...(detalhes ? { detalhes } : {}), requisicaoId },
    });
  }

  private async registrar(exception: unknown, req: Request, requisicaoId: string) {
    const err = exception as Error;
    const caminho = urlSemSegredo(`http://api${req.url}`).caminho;
    try {
      await this.errors.reportar({
        origem: "api",
        message: mascararTexto(err?.message ?? String(exception)),
        stack: err?.stack ? mascararTexto(err.stack) : undefined,
        url: `${req.method} ${caminho}`,
        userAgent: req.headers["user-agent"],
        userType: "INTEGRACAO",
        extra: { requisicaoId, body: conteudoParaGuardar(req.body as unknown) },
      });
    } catch (logErr) {
      this.log.error("Falhou ao registrar erro da /v1", logErr as Error);
    }
    this.log.error(`5xx em ${req.method} ${caminho} (${requisicaoId}): ${err?.message}`, err?.stack);
  }
}

function ehCorpoGrande(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { type?: string }).type === "entity.too.large";
}
