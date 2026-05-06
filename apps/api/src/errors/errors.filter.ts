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
      const userId =
        (req as Request & { user?: { id?: string; perfil?: string } }).user?.id;
      const userType =
        (req as Request & { user?: { id?: string; perfil?: string } }).user?.perfil;

      try {
        await this.errors.reportar({
          origem: "api",
          message: err.message ?? String(exception),
          stack: err.stack,
          url: `${req.method} ${req.url}`,
          userAgent: req.headers["user-agent"],
          userId,
          userType,
          extra: {
            body: this.sanitizar(req.body as unknown),
            query: req.query,
          },
        });
      } catch (logErr) {
        this.log.error("Falhou ao registrar erro no error_logs", logErr);
      }

      this.log.error(`5xx em ${req.method} ${req.url}: ${err.message}`, err.stack);
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
  private sanitizar(body: unknown): unknown {
    if (!body || typeof body !== "object") return body;
    const SENSIVEIS = ["senha", "password", "token", "accessToken", "refreshToken"];
    const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const k of SENSIVEIS) {
      if (k in copy) copy[k] = "[REDACTED]";
    }
    return copy;
  }
}
