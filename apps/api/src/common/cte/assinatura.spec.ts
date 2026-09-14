import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assinarCte, cifrar, decifrar, lerCertificado, type Certificado } from "./assinatura";
import { montarCte, type EntradaCte, type Participante } from "./montar";
import { gerarXmlCte } from "./xml";
import { validarContraXsd } from "./xsd";

/**
 * A assinatura é provada de ponta a ponta com um certificado DE VERDADE —
 * gerado na hora, autoassinado. Não é o A1 do ICP-Brasil, e por isso não prova
 * credenciamento; prova tudo o mais: leitura do .pfx, extração do CNPJ, a
 * assinatura em si, e que o documento assinado continua válido no XSD oficial.
 *
 * Testar assinatura com mock não testa nada: o que pode dar errado é justamente
 * a criptografia e a canonicalização.
 */

const SENHA = "senha-de-teste";
const CNPJ = "34238864000168";
let cert: Certificado;
let pfx: Buffer;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "cte-cert-"));
  const key = join(dir, "k.pem");
  const crt = join(dir, "c.pem");
  const p12 = join(dir, "c.pfx");

  execFileSync("openssl", ["genrsa", "-out", key, "2048"], { stdio: "ignore" });
  execFileSync(
    "openssl",
    [
      "req", "-new", "-x509", "-key", key, "-out", crt, "-days", "2",
      // O CN de um e-CNPJ termina com ":CNPJ" — é de lá que o código o extrai.
      "-subj", `/C=BR/O=ICP-Brasil/CN=TRANSPORTES AURORA LTDA:${CNPJ}`,
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "openssl",
    ["pkcs12", "-export", "-out", p12, "-inkey", key, "-in", crt, "-passout", `pass:${SENHA}`],
    { stdio: "ignore" },
  );

  pfx = readFileSync(p12);
  cert = lerCertificado(pfx, SENHA);
});

const endereco = {
  logradouro: "Rodovia do Cafe",
  numero: "1200",
  bairro: "Uvaranas",
  codigoMunicipio: "4119905",
  municipio: "Ponta Grossa",
  cep: "84035000",
  uf: "PR",
};

function participante(over: Partial<Participante> = {}): Participante {
  return {
    cnpjCpf: "11222333000181",
    razaoSocial: "PEDREIRA NORTE LTDA",
    inscricaoEstadual: "9012345678",
    indicadorIe: "1",
    endereco,
    ...over,
  };
}

function entrada(): EntradaCte {
  return {
    emitente: { ...participante({ cnpjCpf: CNPJ, razaoSocial: "TRANSPORTES AURORA LTDA" }), crt: "3", rntrc: "12345678" },
    remetente: participante(),
    destinatario: participante({ cnpjCpf: "45997418000153", razaoSocial: "CONSTRUTORA OBRA CENTRO LTDA" }),
    papelTomador: "DESTINATARIO",
    inicioPrestacao: { codigo: "4119905", nome: "Ponta Grossa", uf: "PR" },
    fimPrestacao: { codigo: "4106902", nome: "Curitiba", uf: "PR" },
    carga: { produtoPredominante: "BRITA 1", toneladas: 28.5, valorCarga: 2100, documentoAvulso: "TK-1" },
    valores: { valorFrete: 1200, valorPedagio: 75 },
    config: {
      naturezaCfop: "353",
      naturezaOperacao: "PRESTACAO DE SERVICO DE TRANSPORTE",
      serie: 1,
      icms: { tipo: "00", aliquota: 12 },
    },
    numero: 1042,
    emitidoEm: new Date("2026-09-13T18:30:00.000Z"),
    ambiente: 2,
    codigoNumerico: 87654321,
  };
}

describe("lerCertificado", () => {
  it("abre o .pfx e tira o CNPJ do próprio certificado", () => {
    // Tirar o CNPJ de um campo digitado deixaria emitir em nome de uma empresa
    // com o certificado de outra.
    expect(cert.cnpj).toBe(CNPJ);
    expect(cert.titular).toContain("TRANSPORTES AURORA");
    expect(cert.validoAte.getTime()).toBeGreaterThan(Date.now());
  });

  it("senha errada não passa por válida", () => {
    expect(() => lerCertificado(pfx, "outra")).toThrow(/senha incorreta ou arquivo inválido/);
  });
});

describe("assinarCte", () => {
  it("o documento ASSINADO continua válido no XSD oficial", async () => {
    // O teste que importa: a assinatura precisa caber no leiaute, não só existir.
    const xml = gerarXmlCte(montarCte(entrada()));
    const { xml: assinado } = assinarCte(xml, cert);
    const r = await validarContraXsd(assinado);
    expect(r.erros.map((e) => e.mensagem)).toEqual([]);
    // E agora a conferência COBRIU a assinatura — não foi o esqueleto.
    expect(r.assinaturaVerificada).toBe(true);
  });

  it("assina o infCte pelo Id da chave, e não o documento todo", () => {
    const xml = gerarXmlCte(montarCte(entrada()));
    const id = xml.match(/Id="(CTe\d{44})"/)![1];
    const { xml: assinado } = assinarCte(xml, cert);
    expect(assinado).toContain(`URI="#${id}"`);
  });

  it("usa exatamente os algoritmos que a SEFAZ fixa no schema", () => {
    // C14N e rsa-sha1 estão `fixed=` no XSD. Modernizar aqui é rejeição.
    const { xml } = assinarCte(gerarXmlCte(montarCte(entrada())), cert);
    expect(xml).toContain("http://www.w3.org/TR/2001/REC-xml-c14n-20010315");
    expect(xml).toContain("http://www.w3.org/2000/09/xmldsig#rsa-sha1");
    expect(xml).toContain("http://www.w3.org/2000/09/xmldsig#enveloped-signature");
  });

  it("leva o certificado junto — KeyInfo é obrigatório no CT-e", () => {
    const { xml } = assinarCte(gerarXmlCte(montarCte(entrada())), cert);
    expect(xml).toMatch(/<X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate>/);
  });

  it("a assinatura fica dentro do CTe, irmã do infCte", () => {
    const { xml } = assinarCte(gerarXmlCte(montarCte(entrada())), cert);
    expect(xml).toMatch(/<\/infCte><Signature/);
    expect(xml).toMatch(/<\/Signature><\/CTe>/);
  });

  it("mexer num byte depois de assinar quebra a validação da assinatura", async () => {
    // É a prova de que a assinatura cobre o conteúdo, e não é decoração.
    const { xml } = assinarCte(gerarXmlCte(montarCte(entrada())), cert);
    const adulterado = xml.replace("<vTPrest>1275.00</vTPrest>", "<vTPrest>1.00</vTPrest>");
    const { SignedXml } = await import("xml-crypto");
    const v = new SignedXml({ publicCert: cert.certificadoPem });
    v.loadSignature(adulterado.match(/<Signature[\s\S]*<\/Signature>/)![0]);
    expect(v.checkSignature(adulterado)).toBe(false);
  });

  it("XML sem Id não é assinado às cegas", () => {
    expect(() => assinarCte("<CTe><infCte/></CTe>", cert)).toThrow(/Id do infCte/);
  });
});

describe("guarda do certificado", () => {
  const CHAVE = "0".repeat(64);

  it("cifra e devolve o mesmo arquivo", () => {
    expect(decifrar(cifrar(pfx, CHAVE), CHAVE).equals(pfx)).toBe(true);
  });

  it("dois cifrados do mesmo arquivo são diferentes", () => {
    // IV aleatório: sem isso, dá pra saber que duas empresas usam o mesmo
    // certificado só olhando o banco.
    expect(cifrar(pfx, CHAVE).equals(cifrar(pfx, CHAVE))).toBe(false);
  });

  it("chave errada não abre", () => {
    expect(() => decifrar(cifrar(pfx, CHAVE), "1".repeat(64))).toThrow();
  });

  it("byte trocado no banco vira erro, não chave corrompida em silêncio", () => {
    const blob = cifrar(pfx, CHAVE);
    blob[blob.length - 1] ^= 0xff;
    expect(() => decifrar(blob, CHAVE)).toThrow();
  });

  it("chave de tamanho errado é recusada com instrução", () => {
    expect(() => cifrar(pfx, "abc")).toThrow(/openssl rand -hex 32/);
  });
});
