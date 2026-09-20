import { describe, expect, it } from "vitest";
import { abrirRegime, encerrarRegime, erroRegimeConflitante, regimeVivo, soDigitos } from "./regime-vigente";

/**
 * A trava que impede a mesma pessoa ser parceira autônoma e empregada
 * registrada na mesma empresa. Não é arrumação: é a linha que separa dois
 * módulos com bases legais diferentes, e furá-la desenha os elementos de
 * vínculo dentro do produto.
 */

function tx(vivo: { id: string; regime: "PARCEIRO" | "EMPREGADO" } | null = null) {
  const escritas: Record<string, unknown>[] = [];
  return {
    escritas,
    client: {
      regimeVigente: {
        findFirst: async () => vivo,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          escritas.push({ op: "create", ...data });
          return data;
        },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          escritas.push({ op: "update", ...data });
          return { count: 1 };
        },
      },
    } as never,
  };
}

const CPF = "111.222.333-44";

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
