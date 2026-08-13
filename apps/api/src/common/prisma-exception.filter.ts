import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Response } from "express";

/**
 * Traduz erro do Prisma em resposta de cliente, em vez de 500.
 *
 * Ficou necessário com o isolamento por empresa: a trava injeta o `contaId` em
 * todo `where`, então buscar por id um registro de OUTRA empresa não acha nada e
 * o `findUniqueOrThrow`/`update`/`delete` levanta P2025. Sem esta tradução, ler
 * o id errado viraria 500 — que mente sobre a causa e ainda entope o error_logs.
 *
 * 404 e não 403 de propósito: 403 confirmaria que o registro existe em algum
 * lugar, virando um oráculo pra descobrir ids de outras empresas.
 *
 * P2003 (chave estrangeira) vira 400 pela regra que o app do motorista já
 * exige: 5xx trava o outbox em loop de retentativa, 4xx manda o lançamento pra
 * tela de Pendentes pro motorista corrigir.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(PrismaExceptionFilter.name);

  catch(erro: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    const traduzido =
      erro.code === "P2025"
        ? new NotFoundException("Registro não encontrado.")
        : erro.code === "P2003"
          ? new BadRequestException(
              "Um dos itens escolhidos não existe mais. Atualize a tela e tente de novo.",
            )
          : erro.code === "P2002"
            ? new BadRequestException("Já existe um registro com esse valor.")
            : null;

    if (!traduzido) {
      // Código que não sabemos traduzir segue como 500 — mas registrado com o
      // código do Prisma, senão vira "Internal server error" sem pista nenhuma.
      this.log.error(`Prisma ${erro.code}: ${erro.message}`);
      res.status(500).json({ statusCode: 500, message: "Internal server error" });
      return;
    }

    const status = traduzido.getStatus();
    res.status(status).json(traduzido.getResponse());
  }
}
