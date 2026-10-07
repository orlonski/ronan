import { conteudoParaGuardar, urlSemSegredo } from "../common/chamadas-externas/registro";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ErrorsService } from "./errors.service";

/**
 * Captura QUALQUER exception não tratada do backend e:
 * 1. Loga no error_logs com origem='api' (pra investigar depois)
 * 2. Retorna response padrão pro cliente
 *
 * Não interfere em HttpException (deixa NestJS tratar normalmente —
 * são erros "esperados" como 404, 401, validação Zod, etc).
 */
@Catch()
export class ErrorsExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("ErrorsExceptionFilter");

  constructor(private readonly errors: ErrorsService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Só registra no error_logs erros 5xx (bugs reais).
    // 4xx (client errors) entopem o log sem serem úteis.
    if (status >= 500) {
      const err = exception as Error;
      const reqUser = (req as Request & { user?: { id?: string; kind?: string } }).user;
      const userId = reqUser?.id;
      const userType = reqUser?.kind;

      try {
        await this.errors.reportar({
          origem: "api",
          message: err.message ?? String(exception),
          stack: err.stack,
          // Sem segredo no endereço: `?access_token=` (o JWT aceita token na
          // query) ia inteiro pro error_logs, que a equipe lê na tela de Erros.
          url: `${req.method} ${urlSemSegredo(`http://api${req.url}`).caminho}`,
          userAgent: req.headers["user-agent"],
          userId,
          userType,
          extra: {
            body: this.sanitizar(req.body as unknown),
            query: this.sanitizar(req.query as unknown),
          },
        });
      } catch (logErr) {
        this.log.error("Falhou ao registrar erro no error_logs", logErr);
      }

      this.log.error(`5xx em ${req.method} ${urlSemSegredo(`http://api${req.url}`).caminho}: ${err.message}`, err.stack);
    }

    // Resposta padrão NestJS
    if (isHttp) {
      const body = exception.getResponse();
      res
        .status(status)
        .json(typeof body === "string" ? { message: body } : body);
    } else {
      res.status(status).json({ message: "Internal server error" });
    }
  }

  /** Remove campos sensíveis do body antes de salvar. */
  /**
   * A mesma limpeza do registro de chamadas externas: senha, token, chave e
   * cookie em QUALQUER nível (antes só o 1º nível e 5 nomes fixos), foto em
   * base64 fora, CPF/telefone/e-mail mascarados, corte de tamanho.
   */
  private sanitizar(body: unknown): unknown {
    if (!body || typeof body !== "object") return body;
    return conteudoParaGuardar(body);
  }
}
