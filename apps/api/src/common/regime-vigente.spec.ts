import { describe, expect, it } from "vitest";
import {
  abrirRegime,
  dentroDeEmprego,
  encerrarRegime,
  erroRegimeConflitante,
  periodosDeEmprego,
  regimeVivo,
  soDigitos,
  temVinculoDeEmprego,
} from "./regime-vigente";

/**
 * A trava que impede a mesma pessoa ser parceira autônoma e empregada
 * registrada na mesma empresa. Não é arrumação: é a linha que separa dois
 * módulos com bases legais diferentes, e furá-la desenha os elementos de
 * vínculo dentro do produto.
 */

function tx(
  vivo: { id: string; regime: "PARCEIRO" | "EMPREGADO" } | null = null,
  linhas: { iniciouEm: Date; encerradoEm: Date | null }[] = [],
) {
  const escritas: Record<string, unknown>[] = [];
  return {
    escritas,
    client: {
      regimeVigente: {
        findFirst: async () => vivo,
        findMany: async () => linhas,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          escritas.push({ op: "create", ...data });
          return data;
        },
        // O `where` importa tanto quanto o `data`: é nele que mora o alvo do
        // encerramento.
        updateMany: async ({
          data,
          where,
        }: {
          data: Record<string, unknown>;
          where: Record<string, unknown>;
        }) => {
          escritas.push({ op: "update", where, ...data });
          return { count: 1 };
        },
      },
    } as never,
  };
}

const CPF = "111.222.333-44";

const dt = (inicio: string, fim: string | null) => ({
  iniciouEm: new Date(`${inicio}T00:00:00.000Z`),
  encerradoEm: fim ? new Date(`${fim}T23:59:59.000Z`) : null,
});

describe("abrir regime", () => {
  it("grava a chave viva com o CPF só de dígitos", () => {
    // A chave viva é o que o índice único usa. CPF com pontuação diferente do
    // outro lado faria a trava não travar nada.
    const t = tx(null);
    return abrirRegime(t.client, { cpf: CPF, regime: "PARCEIRO", inicio: new Date() }).then(() => {
      expect(t.escritas[0]!.chaveViva).toBe("11122233344");
      expect(t.escritas[0]!.cpf).toBe("11122233344");
    });
  });

  it("recusa empregado quando já existe parceiro, dizendo QUAL é", async () => {
    const t = tx({ id: "r1", regime: "PARCEIRO" });
    await expect(
      abrirRegime(t.client, { cpf: CPF, regime: "EMPREGADO", inicio: new Date() }),
    ).rejects.toThrow(/parceiro autônomo/i);
    expect(t.escritas).toHaveLength(0);
  });

  it("e recusa parceiro quando já existe empregado", async () => {
    const t = tx({ id: "r1", regime: "EMPREGADO" });
    await expect(
      abrirRegime(t.client, { cpf: CPF, regime: "PARCEIRO", inicio: new Date() }),
    ).rejects.toThrow(/vínculo de emprego/i);
  });

  it("abrir o MESMO regime de novo não é erro — é a segunda obra da pessoa", async () => {
    const t = tx({ id: "r1", regime: "PARCEIRO" });
    await abrirRegime(t.client, { cpf: CPF, regime: "PARCEIRO", inicio: new Date() });
    expect(t.escritas).toHaveLength(0);
  });

  it("cadastro sem CPF passa sem travar nada", async () => {
    // O mensal já aceita motorista sem CPF, e a trava é sobre pessoa
    // identificada. Recusar aqui quebraria cadastro que funciona hoje.
    const t = tx(null);
    await abrirRegime(t.client, { cpf: "", regime: "PARCEIRO", inicio: new Date() });
    expect(t.escritas).toHaveLength(0);
  });

  it("CPF incompleto também não entra", async () => {
    const t = tx(null);
    await abrirRegime(t.client, { cpf: "123", regime: "EMPREGADO", inicio: new Date() });
    expect(t.escritas).toHaveLength(0);
  });
});

describe("encerrar regime", () => {
  it("limpa a chave viva e carimba o motivo, sem apagar a linha", async () => {
    // O histórico responde "essa pessoa foi parceira até quando?", que é a
    // pergunta que aparece justamente quando alguém discute vínculo.
    const t = tx({ id: "r1", regime: "PARCEIRO" });
    await encerrarRegime(t.client, { cpf: CPF, motivo: "obra terminou" });
    expect(t.escritas[0]!.chaveViva).toBeNull();
    expect(t.escritas[0]!.motivo).toBe("obra terminou");
    expect(t.escritas[0]!.encerradoEm).toBeInstanceOf(Date);
  });

  it("sem alvo, encerra o regime vivo seja ele qual for", async () => {
    const t = tx({ id: "r1", regime: "PARCEIRO" });
    await encerrarRegime(t.client, { cpf: CPF, motivo: "x" });
    expect(t.escritas[0]!.where).toEqual({ chaveViva: "11122233344" });
  });

  it("com alvo, o regime entra no WHERE — não num if antes", async () => {
    // ⚠️ Desligar um funcionário não pode soltar a chave de um contrato de
    // PARCEIRO. E a checagem vai no banco: decidir fora deixa uma fresta
    // entre ler e escrever.
    const t = tx({ id: "r1", regime: "PARCEIRO" });
    await encerrarRegime(t.client, { cpf: CPF, motivo: "desligamento", regime: "EMPREGADO" });
    expect(t.escritas[0]!.where).toEqual({
      chaveViva: "11122233344",
      regime: "EMPREGADO",
    });
  });
});

describe("quem é empregado, e desde quando", () => {
  it("temVinculoDeEmprego é verdade só pro regime de emprego", async () => {
    expect(await temVinculoDeEmprego(tx({ id: "r", regime: "EMPREGADO" }).client, CPF)).toBe(true);
    expect(await temVinculoDeEmprego(tx({ id: "r", regime: "PARCEIRO" }).client, CPF)).toBe(false);
    expect(await temVinculoDeEmprego(tx(null).client, CPF)).toBe(false);
  });

  it("CPF malformado não é empregado (e não varre a tabela)", async () => {
    expect(await temVinculoDeEmprego(tx({ id: "r", regime: "EMPREGADO" }).client, "123")).toBe(
      false,
    );
    expect(await periodosDeEmprego(tx(null, [dt("2026-01-01", null)]).client, "123")).toEqual([]);
  });

  it("período aberto à direita alcança qualquer data depois do início", async () => {
    const p = await periodosDeEmprego(tx(null, [dt("2026-03-10", null)]).client, CPF);
    expect(dentroDeEmprego(p, new Date("2026-03-09T12:00:00Z"))).toBe(false);
    expect(dentroDeEmprego(p, new Date("2026-03-10T00:00:00Z"))).toBe(true);
    expect(dentroDeEmprego(p, new Date("2030-01-01T00:00:00Z"))).toBe(true);
  });

  it("quem foi parceiro até março e registrado em abril mantém março", async () => {
    // O ponto inteiro de perguntar por DATA, e não "o que ele é hoje": o
    // acerto de março é direito dele, o de maio não pode existir.
    const p = await periodosDeEmprego(tx(null, [dt("2026-04-01", null)]).client, CPF);
    expect(dentroDeEmprego(p, new Date("2026-03-20T00:00:00Z"))).toBe(false);
    expect(dentroDeEmprego(p, new Date("2026-05-20T00:00:00Z"))).toBe(true);
  });

  it("vínculo encerrado só alcança o que está dentro da janela", async () => {
    const p = await periodosDeEmprego(
      tx(null, [dt("2025-01-01", "2025-06-30"), dt("2026-02-01", null)]).client,
      CPF,
    );
    expect(dentroDeEmprego(p, new Date("2025-03-15T00:00:00Z"))).toBe(true);
    expect(dentroDeEmprego(p, new Date("2025-09-15T00:00:00Z"))).toBe(false);
    expect(dentroDeEmprego(p, new Date("2026-03-15T00:00:00Z"))).toBe(true);
  });

  it("sem nenhum vínculo, nenhuma data está dentro", async () => {
    const p = await periodosDeEmprego(tx(null, []).client, CPF);
    expect(dentroDeEmprego(p, new Date())).toBe(false);
  });
});

describe("detalhes", () => {
  it("regimeVivo ignora CPF malformado em vez de varrer a tabela", async () => {
    const t = tx({ id: "r1", regime: "PARCEIRO" });
    expect(await regimeVivo(t.client, "123")).toBeNull();
  });

  it("a mensagem do conflito diz o caminho de saída", () => {
    expect(erroRegimeConflitante("EMPREGADO").message).toMatch(/Encerre o anterior/i);
  });

  it("soDigitos aceita qualquer pontuação", () => {
    expect(soDigitos("111.222.333-44")).toBe("11122233344");
  });
});
