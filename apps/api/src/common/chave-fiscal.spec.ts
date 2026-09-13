import { describe, expect, it } from "vitest";
import { dvChave, lerChaveFiscal, soDigitos } from "./chave-fiscal";

/** Monta uma chave com DV correto a partir dos 43 primeiros dígitos. */
function comDv(base43: string): string {
  return base43 + String(dvChave(base43));
}

// SP (35), junho de 2026 (2606), CNPJ, modelo 57 (CT-e), série 001, nº 000000123.
const BASE_CTE = "35" + "2606" + "12345678000195" + "57" + "001" + "000000123" + "1" + "00000001";
const CTE = comDv(BASE_CTE);

const BASE_NFE = "35" + "2606" + "12345678000195" + "55" + "001" + "000000456" + "1" + "00000002";
const NFE = comDv(BASE_NFE);

describe("lerChaveFiscal", () => {
  it("aceita e destrincha uma chave válida", () => {
    const r = lerChaveFiscal(CTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.uf).toBe("SP");
    expect(r.dados.nomeModelo).toBe("CT-e");
    expect(r.dados.cnpjEmitente).toBe("12345678000195");
    expect(r.dados.serie).toBe("001");
    expect(r.dados.numero).toBe("000000123");
    expect(r.dados.competencia).toBe("2606");
  });

  it("aceita chave com pontuação colada de qualquer jeito", () => {
    // Ninguém digita 44 números limpos: copia do DACTE, do e-mail, do WhatsApp.
    const suja = CTE.replace(/(\d{4})/g, "$1 ").trim();
    expect(lerChaveFiscal(suja).ok).toBe(true);
  });

  it("recusa chave curta dizendo quantos números faltam", () => {
    const r = lerChaveFiscal(CTE.slice(0, 43));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("43");
  });

  it("recusa chave vazia", () => {
    expect(lerChaveFiscal("").ok).toBe(false);
  });

  it("pega dígito verificador errado", () => {
    // O erro de digitação mais comum, e o único que só o DV encontra.
    const errada = CTE.slice(0, 43) + (Number(CTE[43]) === 9 ? "0" : String(Number(CTE[43]) + 1));
    const r = lerChaveFiscal(errada);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("não confere");
  });

  it("pega dois dígitos trocados de lugar", () => {
    // Transposição: o tamanho está certo e os números são os mesmos. Só o
    // módulo 11 pega.
    const arr = CTE.split("");
    [arr[10], arr[11]] = [arr[11]!, arr[10]!];
    const trocada = arr.join("");
    // (se os dois dígitos forem iguais, a troca não muda nada — aí não há erro)
    if (trocada !== CTE) expect(lerChaveFiscal(trocada).ok).toBe(false);
  });

  it("recusa UF que não existe", () => {
    const r = lerChaveFiscal(comDv("99" + BASE_CTE.slice(2)));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("estado");
  });

  it("recusa mês impossível na competência", () => {
    const r = lerChaveFiscal(comDv("35" + "2613" + BASE_CTE.slice(6)));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("mês");
  });

  it("recusa modelo desconhecido", () => {
    const r = lerChaveFiscal(comDv(BASE_CTE.slice(0, 20) + "99" + BASE_CTE.slice(22)));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("Modelo");
  });

  it("avisa quando a chave é de outro documento", () => {
    // Colar a chave da NF-e no campo do CT-e: a chave é VÁLIDA, o DV bate, e
    // sem esta checagem entraria calada. É o erro mais provável do mundo.
    const r = lerChaveFiscal(NFE, "57");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("NF-e");
    expect(r.motivo).toContain("CT-e");
  });

  it("aceita a chave certa quando o modelo é exigido", () => {
    expect(lerChaveFiscal(CTE, "57").ok).toBe(true);
    expect(lerChaveFiscal(NFE, "55").ok).toBe(true);
  });
});

describe("dvChave", () => {
  it("resto 0 ou 1 vira dígito 0", () => {
    // Regra da SEFAZ, não arredondamento nosso. 43 zeros somam 0.
    expect(dvChave("0".repeat(43))).toBe(0);
  });
});

describe("soDigitos", () => {
  it("tira tudo que não é número", () => {
    expect(soDigitos("3526-06.1234 5678/0001")).toBe("352606123456780001");
  });
});
