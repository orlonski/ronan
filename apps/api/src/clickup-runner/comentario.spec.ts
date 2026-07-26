import { describe, expect, it } from "vitest";
import { montarComentario } from "./comentario";

const job = { id: "job-1", taskId: "abc", tentativas: 0 };

describe("montarComentario", () => {
  it("traz status, resumo, arquivos, branch, duração e custo", () => {
    const texto = montarComentario(
      job,
      {
        status: "CONCLUIDA",
        resumo: "ajustei o filtro",
        arquivosAlterados: ["src/a.ts", "src/b.ts"],
        branch: "feat/abc",
        custoUsd: 1.234,
        exitCode: 0,
      },
      2_500,
    );

    expect(texto).toContain("✅ Concluída");
    expect(texto).toContain("ajustei o filtro");
    expect(texto).toContain("`src/a.ts`");
    expect(texto).toContain("`feat/abc`");
    expect(texto).toContain("2.5s");
    expect(texto).toContain("US$ 1.23");
    expect(texto).toContain("job-1");
  });

  it("diz explicitamente quando não mudou arquivo nenhum", () => {
    const texto = montarComentario(job, { status: "CONCLUIDA", resumo: "nada a fazer" }, 100);
    expect(texto).toContain("nenhum");
  });

  it("resume a lista quando são muitos arquivos", () => {
    const arquivos = Array.from({ length: 45 }, (_, i) => `src/f${i}.ts`);
    const texto = montarComentario(
      job,
      { status: "CONCLUIDA", resumo: "grande", arquivosAlterados: arquivos },
      100,
    );
    expect(texto).toContain("e mais 5");
  });

  it("marca o número da tentativa quando houve retentativa", () => {
    const texto = montarComentario(
      { ...job, tentativas: 2 },
      { status: "FALHOU", resumo: "não deu" },
      100,
    );
    expect(texto).toContain("**Tentativas:** 3");
  });
});
