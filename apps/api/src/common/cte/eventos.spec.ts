import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assinarCte, lerCertificado, type Certificado } from "./assinatura";
import {
  gerarCancelamento,
  gerarCartaCorrecao,
  gerarComprovanteEntrega,
  hashDaEntrega,
} from "./eventos";
import { validarContraXsd } from "./xsd";

/**
 * Os três eventos, validados contra os schemas OFICIAIS — envelope e detalhe.
 *
 * O detalhe importa: no envelope o `detEvento` é `xs:any processContents=
 * "skip"`, então validar só o envelope diria "passou" sem ter olhado o que o
 * evento carrega. É a mesma armadilha do modal rodoviário.
 */

const CHAVE = "41260934238864000168570010000010421876543215";
const CNPJ = "34238864000168";
const QUANDO = new Date("2026-09-14T18:30:00.000Z");
let cert: Certificado;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "ev-"));
  const p = (n: string) => join(dir, n);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", p("k.pem"),
    "-out", p("c.pem"), "-days", "2", "-subj", `/CN=TRANSPORTES AURORA:${CNPJ}`], { stdio: "ignore" });
  execFileSync("openssl", ["pkcs12", "-export", "-out", p("c.pfx"), "-inkey", p("k.pem"),
    "-in", p("c.pem"), "-passout", "pass:t"], { stdio: "ignore" });
  cert = lerCertificado(readFileSync(p("c.pfx")), "t");
});

const base = { chave: CHAVE, cnpjEmitente: CNPJ, uf: "PR", ambiente: 2 as const, ocorridoEm: QUANDO };

async function validar(xml: string) {
  return validarContraXsd(xml, { mensagem: "evento" });
}

describe("cancelamento (110111)", () => {
  it("passa no envelope e no detalhe", async () => {
    const { xml } = gerarCancelamento({
      ...base,
      protocolo: "141260000012345",
      justificativa: "Carga recusada pela obra, frete nao realizado",
    });
    expect((await validar(xml)).erros.map((e) => e.mensagem)).toEqual([]);
  });

  it("justificativa curta é barrada aqui, não pela SEFAZ", async () => {
    // O evento de cancelamento é contado; gastar um pra descobrir que o texto
    // era curto é desperdício que dá pra evitar de graça.
    expect(() =>
      gerarCancelamento({ ...base, protocolo: "1", justificativa: "errado" }),
    ).toThrow(/ao menos 15/);
  });

  it("o Id é ID + tipo + chave + sequência", async () => {
    const { xml, id } = gerarCancelamento({
      ...base,
      protocolo: "141260000012345",
      justificativa: "Carga recusada pela obra, frete nao realizado",
    });
    expect(id).toBe(`ID110111${CHAVE}001`);
    // 2 + 6 + 44 + 3 = 55 caracteres, dos quais 53 dígitos — o padrão do XSD.
    expect(id.replace("ID", "")).toHaveLength(53);
    expect(xml).toContain(`Id="${id}"`);
  });

  it("assina como o CT-e — mesma canalização", async () => {
    const { xml } = gerarCancelamento({
      ...base,
      protocolo: "141260000012345",
      justificativa: "Carga recusada pela obra, frete nao realizado",
    });
    // O MESMO assinador do CT-e: ele deduz o bloco pelo prefixo do Id.
    const assinado = assinarCte(xml, cert).xml;
    expect(assinado).toContain("<X509Certificate>");
    expect(assinado).toContain(`URI="#ID110111${CHAVE}001"`);
    // E o documento assinado continua válido no schema.
    const r = await validar(assinado);
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
    expect(r.assinaturaVerificada).toBe(true);
  });
});

describe("carta de correção (110110)", () => {
  it("passa no envelope e no detalhe", async () => {
    const { xml } = gerarCartaCorrecao({
      ...base,
      correcoes: [
        { grupoAlterado: "ide", campoAlterado: "xMunFim", valorAlterado: "Curitiba" },
      ],
    });
    expect((await validar(xml)).erros.map((e) => e.mensagem)).toEqual([]);
  });

  it("leva a condição de uso literal — a SEFAZ compara o texto", async () => {
    const { xml } = gerarCartaCorrecao({
      ...base,
      correcoes: [{ grupoAlterado: "ide", campoAlterado: "xMunFim", valorAlterado: "Curitiba" }],
    });
    expect(xml).toContain("CONVENIO/SINIEF 06/89");
    expect(xml).toContain("nao esteja relacionado com");
  });

  it("aceita várias correções na mesma carta", async () => {
    const { xml } = gerarCartaCorrecao({
      ...base,
      correcoes: [
        { grupoAlterado: "ide", campoAlterado: "xMunFim", valorAlterado: "Curitiba" },
        { grupoAlterado: "infCarga", campoAlterado: "proPred", valorAlterado: "BRITA 1" },
      ],
    });
    expect((await validar(xml)).erros.map((e) => e.mensagem)).toEqual([]);
    expect(xml.match(/<infCorrecao>/g)).toHaveLength(2);
  });

  it("carta sem correção nenhuma não é carta", () => {
    expect(() => gerarCartaCorrecao({ ...base, correcoes: [] })).toThrow(/ao menos uma/);
  });

  it("a sequência distingue uma carta da seguinte", () => {
    // Cada carta SUBSTITUI a anterior, e é a sequência que diz qual vale.
    const a = gerarCartaCorrecao({ ...base, correcoes: [{ grupoAlterado: "ide", campoAlterado: "x", valorAlterado: "1" }] });
    const b = gerarCartaCorrecao({ ...base, sequencia: 2, correcoes: [{ grupoAlterado: "ide", campoAlterado: "x", valorAlterado: "2" }] });
    expect(a.id.endsWith("01")).toBe(true);
    expect(b.id.endsWith("02")).toBe(true);
  });
});

describe("comprovante de entrega (110180)", () => {
  const entrega = {
    ...base,
    protocolo: "141260000012345",
    entregueEm: QUANDO,
    documentoRecebedor: "111.444.777-35",
    nomeRecebedor: "JOAO DA SILVA",
    latitude: -25.4284,
    longitude: -49.2733,
    hash: hashDaEntrega({ chave: CHAVE, documentoRecebedor: "11144477735", entregueEm: QUANDO }),
    hashCalculadoEm: QUANDO,
  };

  it("passa no envelope e no detalhe", async () => {
    const { xml } = gerarComprovanteEntrega(entrega);
    expect((await validar(xml)).erros.map((e) => e.mensagem)).toEqual([]);
  });

  it("leva a geolocalização da descarga", async () => {
    const { xml } = gerarComprovanteEntrega(entrega);
    expect(xml).toContain("<latitude>-25.428400</latitude>");
    expect(xml).toContain("<longitude>-49.273300</longitude>");
  });

  it("sem coordenada, o campo SOME — não vai zero", async () => {
    // Zero seria dizer que a entrega foi no golfo da Guiné.
    const { xml } = gerarComprovanteEntrega({ ...entrega, latitude: null, longitude: null });
    expect(xml).not.toContain("<latitude>");
    expect((await validar(xml)).erros.map((e) => e.mensagem)).toEqual([]);
  });

  it("aceita CNPJ de quem recebeu, não só CPF", async () => {
    const { xml } = gerarComprovanteEntrega({ ...entrega, documentoRecebedor: "45997418000153" });
    expect((await validar(xml)).erros.map((e) => e.mensagem)).toEqual([]);
    expect(xml).toContain("<nDoc>45997418000153</nDoc>");
  });

  it("documento que não é CPF nem CNPJ é recusado", () => {
    expect(() => gerarComprovanteEntrega({ ...entrega, documentoRecebedor: "123" })).toThrow(
      /CPF ou um CNPJ/,
    );
  });
});

describe("hashDaEntrega", () => {
  it("é estável: mesma entrega, mesmo hash", () => {
    const a = hashDaEntrega({ chave: CHAVE, documentoRecebedor: "11144477735", entregueEm: QUANDO });
    const b = hashDaEntrega({ chave: CHAVE, documentoRecebedor: "111.444.777-35", entregueEm: QUANDO });
    expect(a).toBe(b);
  });

  it("muda se qualquer parte mudar", () => {
    const a = hashDaEntrega({ chave: CHAVE, documentoRecebedor: "11144477735", entregueEm: QUANDO });
    const b = hashDaEntrega({
      chave: CHAVE,
      documentoRecebedor: "11144477735",
      entregueEm: new Date(QUANDO.getTime() + 60_000),
    });
    expect(a).not.toBe(b);
  });

  it("sai em base64", () => {
    const h = hashDaEntrega({ chave: CHAVE, documentoRecebedor: "11144477735", entregueEm: QUANDO });
    expect(h).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
