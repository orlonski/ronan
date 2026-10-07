import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { ZodEffects, ZodObject, ZodOptional, ZodNullable, ZodArray, ZodDefault, type ZodTypeAny } from "zod";
// Carrega os controllers: é a declaração `@RotaV1` que alimenta o contrato.
import "./v1.controllers";
import { ROTAS_V1 } from "./rota-v1";
import { openApiCanonico } from "./openapi";
import { ARQUIVO_CONTRATO, verificarContratoCommitado } from "./publica.boot-check";
import { ERROS_PUBLICOS } from "./erros";
import { ESCOPO_POR_CHAVE } from "@ronan/shared-types";

/** Todo ZodObject da árvore, atravessando optional/nullable/effects/array. */
function objetos(s: ZodTypeAny, caminho: string, achados: { caminho: string; estrito: boolean }[] = []) {
  if (s instanceof ZodOptional || s instanceof ZodNullable || s instanceof ZodDefault) return objetos(s._def.innerType, caminho, achados);
  if (s instanceof ZodEffects) return objetos(s._def.schema, caminho, achados);
  if (s instanceof ZodArray) return objetos(s._def.type, `${caminho}[]`, achados);
  if (s instanceof ZodObject) {
    achados.push({ caminho, estrito: s._def.unknownKeys === "strict" });
    for (const [k, v] of Object.entries(s.shape as Record<string, ZodTypeAny>)) objetos(v, `${caminho}.${k}`, achados);
  }
  return achados;
}

describe("contrato da API pública", () => {
  it("toda entrada é estrita em TODOS os níveis (campo desconhecido é 400, nunca ignorado)", () => {
    const frouxos = ROTAS_V1.flatMap((r) =>
      (["params", "query", "corpo"] as const).flatMap((p) => (r[p] ? objetos(r[p]!, `${r.metodo} ${r.caminho} ${p}`) : [])),
    ).filter((o) => !o.estrito);
    expect(frouxos).toEqual([]);
  });

  it("toda rota tem escopo do catálogo (ou null declarado) e só erros do catálogo", () => {
    for (const r of ROTAS_V1) {
      if (r.escopo !== null) expect(ESCOPO_POR_CHAVE[r.escopo]).toBeDefined();
      for (const e of r.erros) expect(ERROS_PUBLICOS[e]).toBeDefined();
    }
    expect(ROTAS_V1.length).toBeGreaterThanOrEqual(7);
  });

  it("o contrato gerado é o commitado em openapi/v1.json (senão o boot não sobe)", () => {
    if (process.env.ATUALIZAR_OPENAPI === "1") writeFileSync(ARQUIVO_CONTRATO, openApiCanonico());
    expect(verificarContratoCommitado()).toBeNull();
  });
});

describe("dia da viagem no contrato", () => {
  it("só AAAA-MM-DD de um dia que existe", async () => {
    const { CriarViagemV1 } = await import("./contrato");
    const dia = CriarViagemV1.shape.data;
    expect(dia.safeParse("2026-10-07").success).toBe(true);
    for (const ruim of ["2026-02-30", "2026-13-01", "2026-10-31T22:30:00-03:00", "07/10/2026"]) {
      expect(dia.safeParse(ruim).success, ruim).toBe(false);
    }
  });
});
