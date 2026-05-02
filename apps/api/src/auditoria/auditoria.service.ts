import { Injectable } from "@nestjs/common";
import { Prisma, AcaoAuditoria } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type AuditEntry = {
  usuarioId?: string | null;
  entidade: string;
  entidadeId: string;
  acao: AcaoAuditoria;
  campo?: string | null;
  valorAntes?: unknown;
  valorDepois?: unknown;
  motivo?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

const IGNORED_FIELDS = new Set(["alteradoEm", "sincronizadoEm", "criadoEm", "id"]);

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    await this.prisma.auditLog.create({
      data: {
        usuarioId: entry.usuarioId ?? null,
        entidade: entry.entidade,
        entidadeId: entry.entidadeId,
        acao: entry.acao,
        campo: entry.campo ?? null,
        valorAntes: serializable(entry.valorAntes),
        valorDepois: serializable(entry.valorDepois),
        motivo: entry.motivo ?? null,
        metadata: entry.metadata ?? Prisma.DbNull,
      },
    });
  }

  async logDiff(
    base: Omit<AuditEntry, "campo" | "valorAntes" | "valorDepois">,
    antes: Record<string, unknown>,
    depois: Record<string, unknown>,
  ) {
    const fields = new Set<string>([...Object.keys(antes), ...Object.keys(depois)]);
    const writes: Promise<unknown>[] = [];
    for (const f of fields) {
      if (IGNORED_FIELDS.has(f)) continue;
      const a = antes[f];
      const d = depois[f];
      if (JSON.stringify(a) === JSON.stringify(d)) continue;
      writes.push(
        this.log({
          ...base,
          campo: f,
          valorAntes: a,
          valorDepois: d,
        }),
      );
    }
    await Promise.all(writes);
  }

  async historicoDe(entidade: string, entidadeId: string) {
    return this.prisma.auditLog.findMany({
      where: { entidade, entidadeId },
      orderBy: { criadoEm: "asc" },
      include: { usuario: { select: { id: true, nome: true, email: true } } },
    });
  }
}

function serializable(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toJSON" in value) {
    try {
      return (value as { toJSON: () => Prisma.InputJsonValue }).toJSON();
    } catch {
      /* ignore */
    }
  }
  if (typeof value === "bigint") return value.toString();
  return value as Prisma.InputJsonValue;
}
