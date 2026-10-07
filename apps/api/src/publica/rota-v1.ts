import {
  applyDecorators,
  CallHandler,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  NestInterceptor,
  Post,
  Put,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ZodError, type ZodTypeAny } from "zod";
import type { EscopoIntegracao } from "@ronan/shared-types";
import { RequerEscopo } from "./integracao.guard";
import { ErroPublico, type CodigoErroPublico, type DetalheErro } from "./erros";

/**
 * O contrato de uma rota da `/v1`, declarado UMA vez.
 *
 * Desta declaração saem: o método HTTP do Nest, o escopo que o porteiro cobra,
 * a validação do corpo/query/parâmetros e a entrada na documentação pública
 * (`/v1/openapi.json`). Não dá pra uma divergir da outra, porque são a mesma
 * coisa. Rota da `/v1` sem isto não sobe (`publica.boot-check.ts`).
 */
export type ContratoRota = {
  metodo: "get" | "post" | "put";
  /** Caminho no formato OpenAPI, sem o `/v1`: `/viagens/externo/{idExterno}`. */
  caminho: string;
  escopo: EscopoIntegracao | null;
  resumo: string;
  descricao?: string;
  /** Agrupa na documentação ("Viagens", "Cadastros"). */
  grupo: string;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  corpo?: ZodTypeAny;
  /** Aceita (e documenta) o cabeçalho Idempotency-Key. */
  idempotente?: boolean;
  sucesso: { status: 200 | 201; descricao: string; schema: ZodTypeAny };
  /** Respostas de sucesso alternativas (ex.: 200 quando atualizou em vez de criar). */
  outrosSucessos?: { status: 200 | 201; descricao: string }[];
  erros: CodigoErroPublico[];
};

export const CONTRATO_KEY = "publica:contrato";

/** Toda rota declarada, na ordem em que as classes carregaram. É a fonte do OpenAPI. */
export const ROTAS_V1: ContratoRota[] = [];

export function RotaV1(contrato: ContratoRota): MethodDecorator {
  ROTAS_V1.push(contrato);
  const caminhoNest = contrato.caminho.replace(/\{(\w+)\}/g, ":$1").replace(/^\//, "");
  const metodo = { get: Get, post: Post, put: Put }[contrato.metodo];
  return applyDecorators(
    metodo(caminhoNest),
    HttpCode(contrato.sucesso.status),
    RequerEscopo(contrato.escopo),
    SetMetadata(CONTRATO_KEY, contrato),
  );
}

export type EntradaValidada = { params: unknown; query: unknown; corpo: unknown };
type RequestComEntrada = Request & { entradaV1?: EntradaValidada };

/**
 * Valida a entrada pelo contrato. Roda depois do porteiro (interceptor vem
 * depois dos guards): quem não tem chave nem chega a ser validado.
 *
 * O resultado vai pra `req.entradaV1` e não por cima de `req.query` — no
 * Express 5 a query é só leitura.
 */
@Injectable()
export class ContratoInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const contrato = this.reflector.get<ContratoRota | undefined>(CONTRATO_KEY, context.getHandler());
    if (contrato) {
      const req = context.switchToHttp().getRequest<RequestComEntrada>();
      req.entradaV1 = {
        params: validar(contrato.params, req.params, "params"),
        query: validar(contrato.query, req.query ?? {}, "query"),
        corpo: validar(contrato.corpo, req.body, "corpo"),
      };
    }
    return next.handle();
  }
}

function validar(schema: ZodTypeAny | undefined, valor: unknown, onde: "params" | "query" | "corpo"): unknown {
  if (!schema) return undefined;
  const r = schema.safeParse(valor ?? (onde === "corpo" ? undefined : {}));
  if (r.success) return r.data;
  throw new ErroPublico("VALIDACAO", undefined, detalhesDoZod(r.error, onde));
}

export function detalhesDoZod(err: ZodError, onde: string): DetalheErro[] {
  return err.issues.slice(0, 50).map((i) => ({
    campo: [onde === "corpo" ? null : onde, ...i.path].filter((p) => p !== null && p !== "").join(".") || `(${onde})`,
    codigo: i.code,
    mensagem:
      i.code === "unrecognized_keys"
        ? `Campo que não existe no contrato: ${(i as { keys: string[] }).keys.join(", ")}. Nada foi gravado.`
        : i.message,
  }));
}

/** A entrada já validada pelo contrato da rota. */
export const Entrada = createParamDecorator((parte: keyof EntradaValidada, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RequestComEntrada>();
  if (!req.entradaV1) throw new ErroPublico("ERRO_INTERNO", "Rota sem contrato.");
  return req.entradaV1[parte];
});
