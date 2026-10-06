import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CODIGO_MODULO_NAO_CONTRATADO, MODULOS_POR_CHAVE } from "@ronan/shared-types";
import type { PrismaService } from "../prisma/prisma.service";
import { modulosDaConta } from "./conta/teto-da-conta";

/**
 * As portas que o próprio endpoint do gasto de viagem fecha (B6 do QA).
 *
 * O `ModuloGuard` só vale pra ADMIN_USER e o `CapacidadeAppGuard` começa em
 * SOMBRA — então, do lado do motorista, quem garante que empresa sem o módulo
 * não lança gasto é este arquivo. Os dois erros são 4xx de propósito: o item
 * do outbox vai pros Pendentes em vez de entrar em loop.
 */

/** O guard de acesso sem flag não checa aprovação (CLAUDE.md) — checa aqui. */
export async function exigirMotoristaAprovado(prisma: PrismaService, motoristaId: string): Promise<void> {
  const m = await prisma.motorista.findUnique({ where: { id: motoristaId }, select: { status: true } });
  if (m?.status !== "APROVADO") {
    throw new ForbiddenException({
      code: "CADASTRO_NAO_APROVADO",
      message: "Seu cadastro ainda está em análise.",
    });
  }
}

export async function contaTemModuloDespesas(prisma: PrismaService, contaId: string): Promise<boolean> {
  return (await modulosDaConta(prisma, contaId)).has("despesas");
}

export async function exigirModuloDespesas(prisma: PrismaService, contaId: string): Promise<void> {
  if (await contaTemModuloDespesas(prisma, contaId)) return;
  const def = MODULOS_POR_CHAVE.despesas;
  throw new ForbiddenException({
    code: CODIGO_MODULO_NAO_CONTRATADO,
    modulo: "despesas",
    nomeModulo: def.nome,
    pitch: def.pitch,
    message: "Esta empresa não usa o Gasto de viagem. Fale com o escritório.",
  });
}

/**
 * A foto é DESTE motorista nesta conta? Devolve o sha256 gravado no nome (ver
 * `UploadsService.putDespesaFoto`) ou null se a chave é de outro dono.
 */
export function shaDaFotoDoMotorista(key: string, contaId: string, motoristaId: string): string | null | false {
  const partes = key.split("/");
  // `${contaId}/despesas/${dia}/${motoristaId}/${sha256}_${uuid}.${ext}`
  if (partes.length !== 5) return false;
  if (partes[0] !== contaId || partes[1] !== "despesas" || partes[3] !== motoristaId) return false;
  if (partes.some((p) => p === ".." || p === "")) return false;
  const m = /^([0-9a-f]{64})_/.exec(partes[4]!);
  return m ? m[1]! : null;
}

export function exigirFotosDoMotorista(
  keys: readonly string[],
  contaId: string,
  motoristaId: string,
): { storageKey: string; sha256: string | null }[] {
  return keys.map((k) => {
    const sha = shaDaFotoDoMotorista(k, contaId, motoristaId);
    if (sha === false) {
      throw new BadRequestException({
        code: "FOTO_INVALIDA",
        message: "Uma das fotos deste gasto não foi enviada por este celular. Tire a foto de novo.",
      });
    }
    return { storageKey: k, sha256: sha };
  });
}
