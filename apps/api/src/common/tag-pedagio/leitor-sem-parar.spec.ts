import { describe, expect, it } from "vitest";
import { faturaExemplo, textoDaFatura } from "./fatura-sintetica";
import { lerFaturaSemParar } from "./leitor-sem-parar";
import { chavesDasLinhas, type LinhaParaChave } from "./normalizacao";

/**
 * O leitor da fatura do Sem Parar NUNCA erra calado (04-qa B1). Tudo aqui roda
 * sobre um TEXTO SINTÉTICO com o layout do `pdf-parse` — placas, empresa e
 * números inventados. O PDF de cliente nunca entra no repositório.
 */

const base = () => textoDaFatura(faturaExemplo());

describe("leitor da fatura Sem Parar", () => {
  it("lê a fatura inteira, com as 6 checagens passando", () => {
    const r = lerFaturaSemParar(base());
    expect(r.checagens.filter((c) => !c.ok)).toEqual([]);
    expect(r.status).toBe("LIDO");
    expect(r.cabecalho).toMatchObject({
      semParar: true,
      numeroFatura: "99990000001",
      cnpj: "12345678000290",
      periodoDe: "2026-08-31",
      periodoAte: "2026-09-30",
      emitidoEm: "2026-09-30",
    });
    expect(r.placas.map((p) => p.placa)).toEqual(["TST1A23", "TST2B34", "TST3C45"]);
    const a = r.placas[0]!;
    expect(a.passagens).toHaveLength(11);
    expect(a.vales).toHaveLength(4); // 2 pares C/D
    expect(a.passagens.reduce((s, p) => s + p.valorCent, 0)).toBe(a.totais.pedagioCent);
    // A praça quebrada em duas linhas no vale é remontada.
    expect(a.vales.find((v) => v.cidade === "SANTO ANTÔNIO LEVERGER")).toBeTruthy();
    // Concessionária separada do embarcador só na linha D.
    expect(a.vales.filter((v) => v.dc === "D").every((v) => v.concessionaria === "NOVA ROTA DO OESTE")).toBe(true);
    expect(a.vales.filter((v) => v.dc === "C").every((v) => v.concessionaria === null)).toBe(true);
    expect(a.vales[0]!.embarcadorTexto).toBe("ALFA CEREAIS COMERC");
    expect(r.registrosCrus).toBe(11 + 4 + 4 + 3);
    expect(r.naoLidas).toEqual([]);
    expect(r.planos.filter((p) => p.placa === "TST1A23")).toHaveLength(3);
  });

  it("a diferença de quantidade entre o resumo e o detalhe é DITA, não derruba a leitura", () => {
    const r = lerFaturaSemParar(base());
    const c4 = r.checagens.find((c) => c.n === 4)!;
    expect(c4.ok).toBe(true);
    expect(c4.detalhe).toContain("TST2B34: resumo conta 5 usos, o detalhe tem 4 linhas");
  });

  describe("mutações do 04-qa: nunca entra calado", () => {
    it("arquivo de outra operadora → FALHOU", () => {
      const t = base().replace(/SEM PARAR/g, "OUTRA TAG").replace(/Nº da Fatura: \d+/, "Documento: 1");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("FALHOU");
      expect(r.motivo).toMatch(/não parece uma fatura do Sem Parar/);
    });

    it("sem nº da fatura → FALHOU", () => {
      const f = faturaExemplo();
      f.numeroFatura = "";
      expect(lerFaturaSemParar(textoDaFatura(f)).status).toBe("FALHOU");
    });

    it("zero placas → FALHOU, mesmo com cabeçalho perfeito", () => {
      const t = base().replace(/^TST\d[A-Z]\d{2} - .*$/gm, "Bloco ilegível");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("FALHOU");
      expect(r.placas).toHaveLength(0);
    });

    it("linha de vale sem o D/C: vai pra 'não lidas' e o registro seguinte NÃO é perdido", () => {
      const t = base().replace(/(\d{9} 42,00) C$/m, "$1");
      const r = lerFaturaSemParar(t);
      expect(r.status).not.toBe("LIDO");
      expect(r.naoLidas.some((n) => /vale que não fechou/.test(n.motivo))).toBe(true);
      expect(r.placas[0]!.vales).toHaveLength(3);
      expect(r.checagens.find((c) => c.n === 2)!.ok).toBe(false);
      expect(r.checagens.find((c) => c.n === 4)!.ok).toBe(false);
    });

    it("linha do resumo num formato novo → FALHOU (placa do detalhe fora do resumo)", () => {
      const t = base().replace(/^TST2B34 61,65 D .*$/m, "TST2B34 | 61,65 | 2.148,60 | 5");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("FALHOU");
      expect(r.naoLidas.some((n) => /Resumo/.test(n.motivo))).toBe(true);
    });

    it("placa com hífen no bloco: lê na placa certa (nada cai na placa de cima)", () => {
      const t = base().replace(/^TST2B34 - /m, "TST-2B34 - ");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("LIDO");
      expect(r.placas.find((p) => p.placa === "TST2B34")!.passagens).toHaveLength(4);
      expect(r.placas[0]!.passagens).toHaveLength(11);
    });

    it("título da seção mudou → FALHOU (a fatura cobra e nada foi lido)", () => {
      const t = base().replace(/Detalhamento das Passagens por Pedágios/g, "Passagens detalhadas");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("FALHOU");
    });

    it("ano com 4 dígitos: lê igual", () => {
      const t = base().replace(/^(\d{2}\/\d{2})\/26 (\d{2}:)/gm, "$1/2026 $2");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("LIDO");
      expect(r.placas[0]!.passagens).toHaveLength(11);
    });

    it("total de pedágio que não bate → LIDO_COM_DIVERGENCIA com a checagem dita", () => {
      const t = base().replace(/^Total de Pedágio ([\d.]+,\d{2}) D$/m, "Total de Pedágio 1,00 D");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("LIDO_COM_DIVERGENCIA");
      expect(r.motivo).toMatch(/Total de pedágio e de vale por placa/);
    });

    it("passagem num formato desconhecido vai pra 'não lidas' com a linha crua", () => {
      const t = base().replace(/^(\d{2}\/\d{2}\/26 \d{2}:\d{2}:\d{2}) ECOVIAS DO ARAGUAIA (BR153, KM745\+432, NORTE, ALVORADA) 5/m, "$1 ECOVIAS DO ARAGUAIA $2 CAT5");
      const r = lerFaturaSemParar(t);
      expect(r.status).toBe("LIDO_COM_DIVERGENCIA");
      expect(r.naoLidas[0]!.texto).toContain("ALVORADA");
    });
  });

  describe("idempotência por linha", () => {
    const chaves = (texto: string) => {
      const r = lerFaturaSemParar(texto);
      const linhas: LinhaParaChave[] = r.placas.flatMap((b) => [
        ...b.passagens.map((x) => ({ ...x, operadora: "SEM_PARAR", placa: b.placa, tipo: "PEDAGIO" as const })),
        ...b.vales.map((x) => ({ ...x, operadora: "SEM_PARAR", placa: b.placa, tipo: "VALE" as const, numeroViagemVale: x.numeroViagem })),
      ]);
      return chavesDasLinhas(linhas);
    };

    it("ler o mesmo texto duas vezes dá as mesmas chaves, todas únicas", () => {
      const a = chaves(base());
      expect(a).toEqual(chaves(base()));
      expect(new Set(a).size).toBe(a.length);
    });

    it("a mesma passagem repetida no arquivo vira DUAS chaves (a cobrança em dobro não some)", () => {
      const f = faturaExemplo();
      f.placas[2]!.passagens.push({ ...f.placas[2]!.passagens[0]! });
      const a = chaves(textoDaFatura(f));
      expect(new Set(a).size).toBe(a.length);
      expect(a.length).toBe(chaves(base()).length + 1);
    });
  });
});
