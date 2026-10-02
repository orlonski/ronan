import { describe, expect, it } from "vitest";
import {
  casar,
  catalogoPedidoParaPrompt,
  contarPaginasPdf,
  tipoDoArquivo,
  lerData,
  lerNumero,
  lerUnidade,
  pedidoDoJson,
  referenciaDeHoje,
  type CatalogoPedido,
} from "./pedido-documento";

const CATALOGO: CatalogoPedido = {
  empresas: [
    { id: "e1", nome: "Construtora Alvorada", razaoSocial: "CONSTRUTORA ALVORADA LTDA", cnpj: "12.345.678/0001-90" },
    { id: "e2", nome: "Pavimentadora Sul", razaoSocial: null, cnpj: null },
    { id: "e3", nome: "Prefeitura de Araucária" },
  ],
  obras: [
    { id: "o1", nome: "Residencial Jardim das Flores", apelidos: ["Jardim das Flores"], empresaId: "e1" },
    { id: "o2", nome: "Obra Centro", empresaId: "e1" },
    { id: "o3", nome: "Obra Centro", empresaId: "e2" },
    { id: "o4", nome: "Duplicação BR-476", apelidos: ["Contorno Sul"], empresaId: "e2" },
  ],
  materiais: [
    { id: "m1", nome: "Brita 1", apelidos: ["Brita nº 1"] },
    { id: "m2", nome: "Brita", apelidos: [] },
    { id: "m3", nome: "Brita Graduada", apelidos: ["BGS"] },
    { id: "m4", nome: "CBUQ", apelidos: ["C.B.U.Q", "Massa asfáltica"] },
    { id: "m5", nome: "Areia Média" },
  ],
  locais: [
    { id: "l1", nome: "Pedreira São João", apelidos: ["São João"], logradouro: "Rodovia do Xisto", numero: "km 12", cidade: "Araucária", uf: "PR" },
    { id: "l2", nome: "Canteiro Jardim das Flores", logradouro: "Rua das Palmeiras", numero: "1500", cidade: "Curitiba", uf: "PR" },
    { id: "l3", nome: "Pátio Prefeitura", logradouro: "Rua das Palmeiras", numero: "1500", cidade: "Araucária", uf: "PR" },
  ],
};

const OPTS = { unidadesAceitas: ["VIAGENS", "TONELADAS"], hoje: "2026-10-01", origem: "TEXTO" as const };

describe("casar", () => {
  it("exato depois de normalizar, inclusive tirando LTDA", () => {
    expect(casar("CONSTRUTORA ALVORADA LTDA.", CATALOGO.empresas)).toEqual({ id: "e1", confianca: "ALTA" });
    expect(casar("prefeitura de araucaria", CATALOGO.empresas)).toEqual({ id: "e3", confianca: "ALTA" });
  });

  it("parcial vale MEDIA e o mais longo vence", () => {
    expect(casar("BRITA GRADUADA SIMPLES", CATALOGO.materiais)).toEqual({ id: "m3", confianca: "MEDIA" });
  });

  it("dois cadastros iguais (empate) não escolhe ninguém", () => {
    expect(casar("Obra Centro", CATALOGO.obras)).toBeNull();
  });

  it("texto curto demais não casa por parte", () => {
    expect(casar("Br", CATALOGO.materiais)).toBeNull();
    expect(casar(undefined, CATALOGO.materiais)).toBeNull();
  });
});

describe("leitores", () => {
  it("número brasileiro", () => {
    expect(lerNumero("1.200,5")).toBe(1200.5);
    expect(lerNumero("1.200")).toBe(1200);
    expect(lerNumero("12.5")).toBe(12.5);
    expect(lerNumero(300)).toBe(300);
    expect(lerNumero("abc")).toBeUndefined();
  });

  it("data BR, ISO e impossível", () => {
    expect(lerData("05/10/2026")).toBe("2026-10-05");
    expect(lerData("2026-10-05")).toBe("2026-10-05");
    expect(lerData("31/02/2026")).toBeUndefined();
    expect(lerData("semana que vem")).toBeUndefined();
  });

  it("unidade: m³ no texto cru, kg vira tonelada, carga vira viagem", () => {
    expect(lerUnidade("m³")).toEqual({ tipo: "M3" });
    expect(lerUnidade("M3")).toEqual({ tipo: "M3" });
    expect(lerUnidade("metros cúbicos")).toEqual({ tipo: "M3" });
    expect(lerUnidade("kg")).toEqual({ tipo: "TONELADAS", fator: 0.001 });
    expect(lerUnidade("Toneladas")).toEqual({ tipo: "TONELADAS", fator: 1 });
    expect(lerUnidade("cargas")).toEqual({ tipo: "VIAGENS", fator: 1 });
    expect(lerUnidade("caminhões")).toEqual({ tipo: "VIAGENS", fator: 1 });
    expect(lerUnidade("sacos")).toEqual({ tipo: "DESCONHECIDA" });
  });

  it("referência de hoje leva o dia da semana", () => {
    expect(referenciaDeHoje("2026-10-01")).toBe("Hoje é 2026-10-01 (quinta-feira).");
  });
});

describe("pedidoDoJson", () => {
  it("e-mail do engenheiro: 300 m³ de brita 1 pra obra, a partir de segunda (sem m³ no sistema)", () => {
    // O que a IA devolve de: "Bom dia, preciso de 300 m³ de brita 1 pra obra
    // Jardim das Flores a partir de segunda. Eng. Paulo (41) 99999-0000"
    const r = pedidoDoJson(
      {
        ehPedido: true,
        cliente: "Construtora Alvorada",
        obra: "Jardim das Flores",
        material: "Brita 1",
        quantidade: 300,
        unidade: "m³",
        inicio: "2026-10-05",
        contato: "Eng. Paulo (41) 99999-0000",
        confidence: 0.85,
      },
      CATALOGO,
      OPTS,
    );
    expect(r.empresa).toMatchObject({ valor: "e1", nome: "Construtora Alvorada", confianca: "ALTA" });
    expect(r.obra).toMatchObject({ valor: "o1", nome: "Residencial Jardim das Flores", confianca: "ALTA" });
    expect(r.material).toMatchObject({ valor: "m1", confianca: "ALTA" });
    // 300 m³ NÃO pode virar 300 viagens: quantidade e unidade ficam vazias.
    expect(r.quantidade.valor).toBeUndefined();
    expect(r.quantidade.lido).toBe("300 m³");
    expect(r.unidade.valor).toBeUndefined();
    expect(r.avisos.join(" ")).toMatch(/300 m³.*ainda não mede em m³/);
    expect(r.inicioEm).toEqual({ valor: "2026-10-05", lido: "2026-10-05", confianca: "ALTA" });
    expect(r.prazoEm.valor).toBeUndefined();
    expect(r.observacao.valor).toBe("Contato: Eng. Paulo (41) 99999-0000");
    expect(r.contato.valor).toBe("Eng. Paulo (41) 99999-0000");
  });

  it("com M3 aceito pelo sistema, a mesma leitura preenche m³", () => {
    const r = pedidoDoJson(
      { quantidade: "300", unidade: "m3", confidence: 0.9 },
      CATALOGO,
      { ...OPTS, unidadesAceitas: ["VIAGENS", "TONELADAS", "M3"] },
    );
    expect(r.quantidade.valor).toBe(300);
    expect(r.unidade.valor).toBe("M3");
    expect(r.avisos).toEqual([]);
  });

  it("ordem de compra em PDF: CNPJ, kg → toneladas, endereço casa o local", () => {
    const r = pedidoDoJson(
      {
        ehPedido: true,
        cliente: "ALVORADA ENGENHARIA E CONSTRUÇÕES S/A", // razão diferente do cadastro
        cnpjCliente: "12345678000190",
        obra: "Obra Centro",
        enderecoEntrega: "Rua das Palmeiras, 1500 - Centro",
        cidadeEntrega: "Curitiba",
        localCarga: "PEDREIRA SÃO JOÃO LTDA",
        material: "C.B.U.Q FAIXA C",
        quantidade: "480.000",
        unidade: "KG",
        inicio: "06/10/2026",
        prazo: "30/10/2026",
        observacao: "Entrega das 7h às 16h. Caminhão truck.",
        confidence: 0.9,
      },
      CATALOGO,
      { ...OPTS, origem: "PDF" },
    );
    expect(r.origem).toBe("PDF");
    expect(r.empresa).toMatchObject({ valor: "e1", confianca: "ALTA" });
    // "Obra Centro" é ambígua no catálogo todo, mas não dentro da Alvorada.
    expect(r.obra).toMatchObject({ valor: "o2", confianca: "ALTA" });
    expect(r.material).toMatchObject({ valor: "m4", confianca: "MEDIA" });
    expect(r.localCarga).toMatchObject({ valor: "l1", cidade: "Araucária", uf: "PR" });
    // Mesma rua e número em Araucária (l3) não pode casar: a cidade é Curitiba.
    expect(r.localDescarga).toMatchObject({ valor: "l2", confianca: "MEDIA", lido: "Rua das Palmeiras, 1500 - Centro — Curitiba" });
    expect(r.quantidade).toMatchObject({ valor: 480, confianca: "ALTA" });
    expect(r.unidade.valor).toBe("TONELADAS");
    expect(r.inicioEm.valor).toBe("2026-10-06");
    expect(r.prazoEm.valor).toBe("2026-10-30");
    expect(r.observacao.valor).toBe("Entrega das 7h às 16h. Caminhão truck.");
  });

  it("obra achada sem cliente lido: a empresa vem da obra, como MEDIA", () => {
    const r = pedidoDoJson({ obra: "Contorno Sul", quantidade: 20, unidade: "cargas", confidence: 0.8 }, CATALOGO, OPTS);
    expect(r.obra).toMatchObject({ valor: "o4", confianca: "ALTA" });
    expect(r.empresa).toMatchObject({ valor: "e2", nome: "Pavimentadora Sul", confianca: "MEDIA" });
    expect(r.quantidade.valor).toBe(20);
    expect(r.unidade.valor).toBe("VIAGENS");
  });

  it("local pelo nome da obra é dedução: no máximo MEDIA", () => {
    const r = pedidoDoJson({ obra: "Canteiro Jardim das Flores", confidence: 0.9 }, CATALOGO, OPTS);
    expect(r.localDescarga).toMatchObject({ valor: "l2", confianca: "MEDIA" });
  });

  it("nada casa: tudo vazio com o texto lido e aviso", () => {
    const r = pedidoDoJson(
      { cliente: "Fulano Terraplenagem", material: "Rachão", quantidade: 10, unidade: "sacos", confidence: 0.7 },
      CATALOGO,
      OPTS,
    );
    expect(r.empresa).toEqual({ lido: "Fulano Terraplenagem" });
    expect(r.material).toEqual({ lido: "Rachão" });
    expect(r.quantidade.valor).toBeUndefined();
    expect(r.avisos).toHaveLength(3);
  });

  it("prazo antes do início some; data absurda some; número sem unidade é BAIXA", () => {
    const r = pedidoDoJson(
      { inicio: "2026-10-20", prazo: "2026-10-10", quantidade: 15, confidence: 0.9 },
      CATALOGO,
      OPTS,
    );
    expect(r.inicioEm.valor).toBe("2026-10-20");
    expect(r.prazoEm.valor).toBeUndefined();
    expect(r.prazoEm.lido).toBe("2026-10-10");
    expect(r.quantidade).toMatchObject({ valor: 15, confianca: "BAIXA" });
    expect(r.unidade.valor).toBeUndefined();

    const velho = pedidoDoJson({ inicio: "1999-01-01" }, CATALOGO, OPTS);
    expect(velho.inicioEm).toEqual({ lido: "1999-01-01" });
  });

  it("quantidade fora do plausível some", () => {
    expect(pedidoDoJson({ quantidade: 0, unidade: "t" }, CATALOGO, OPTS).quantidade.valor).toBeUndefined();
    expect(pedidoDoJson({ quantidade: 5e9, unidade: "t" }, CATALOGO, OPTS).quantidade.valor).toBeUndefined();
  });

  it("leitura duvidosa rebaixa ALTA pra MEDIA e avisa", () => {
    const r = pedidoDoJson({ cliente: "Construtora Alvorada", confidence: 0.3 }, CATALOGO, OPTS);
    expect(r.empresa.confianca).toBe("MEDIA");
    expect(r.avisos.join(" ")).toMatch(/pouca certeza/);
  });

  it("lixo da IA não derruba: JSON vazio, array, null, strings 'null'", () => {
    for (const lixo of [null, [], "texto", {}, { cliente: "null", quantidade: "n/a", confidence: "alta" }]) {
      const r = pedidoDoJson(lixo, CATALOGO, OPTS);
      expect(r.empresa.valor).toBeUndefined();
      expect(r.quantidade.valor).toBeUndefined();
      expect(r.confianca).toBe(0);
    }
  });

  it("não é pedido: avisa", () => {
    const r = pedidoDoJson({ ehPedido: false, confidence: 0.1 }, CATALOGO, OPTS);
    expect(r.avisos[0]).toMatch(/não parece um pedido/);
  });
});

describe("catalogoPedidoParaPrompt", () => {
  it("formato nome|apelido, sem locais e com teto", () => {
    const s = catalogoPedidoParaPrompt(CATALOGO, 2);
    expect(s).toContain("Residencial Jardim das Flores|Jardim das Flores");
    expect(s).not.toContain("Pedreira");
    expect(s).not.toContain("CBUQ"); // 4º material, fora do teto de 2
  });
});

describe("arquivo", () => {
  it("tipo pelo conteúdo, não pelo nome", () => {
    expect(tipoDoArquivo(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toEqual({ tipo: "pdf" });
    expect(tipoDoArquivo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ tipo: "imagem", mime: "image/jpeg" });
    expect(tipoDoArquivo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toEqual({ tipo: "imagem", mime: "image/png" });
    expect(tipoDoArquivo(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toEqual({ tipo: "imagem", mime: "image/webp" });
    // .docx é um zip: "PK".
    expect(tipoDoArquivo(Buffer.from("PK\x03\x04aaaaaaaaaaaa"))).toBeNull();
    expect(tipoDoArquivo(Buffer.from("%PDF"))).toBeNull();
  });

  it("conta páginas sem confundir com /Pages", () => {
    const pdf = "%PDF-1.4\n1 0 obj <</Type /Pages /Count 2>>\n2 0 obj <</Type /Page>>\n3 0 obj <</Type/Page /Parent 1 0 R>>";
    expect(contarPaginasPdf(Buffer.from(pdf))).toBe(2);
  });
});
