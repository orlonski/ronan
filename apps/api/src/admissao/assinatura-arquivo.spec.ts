import { describe, expect, it } from "vitest";
import { detectarAssinaturaEmbutida, hashDoArquivo } from "./assinatura-arquivo";

const OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);

describe("reconhecer arquivo assinado", () => {
  it("aceita .p7s que realmente carrega o PKCS#7", () => {
    const b = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x00, 0x06, 0x09]), OID]);
    expect(detectarAssinaturaEmbutida(b, "application/pkcs7-signature", "doc.p7s")).toEqual({
      temAssinaturaEmbutida: true,
      formato: "PKCS7",
    });
  });

  it("recusa JPEG renomeado pra .p7s — é a primeira coisa que se tenta", () => {
    const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectarAssinaturaEmbutida(b, "image/jpeg", "cnh.p7s").temAssinaturaEmbutida).toBe(false);
  });

  it("aceita PDF com /ByteRange e subfiltro de assinatura", () => {
    const b = Buffer.from("%PDF-1.7\n/Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 100 200 300] /Contents <30>");
    expect(detectarAssinaturaEmbutida(b, "application/pdf", "contrato.pdf")).toEqual({
      temAssinaturaEmbutida: true,
      formato: "PDF_EMBUTIDA",
    });
  });

  it("PDF comum NÃO passa por assinado", () => {
    // O caso que o contratante que exige ICP não pode receber: a pessoa
    // escaneia, salva em PDF e acha que assinou.
    const b = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >>");
    expect(detectarAssinaturaEmbutida(b, "application/pdf", "contrato.pdf").temAssinaturaEmbutida).toBe(
      false,
    );
  });

  it("foto nunca é assinatura digital", () => {
    const b = Buffer.from([0xff, 0xd8, 0xff]);
    expect(detectarAssinaturaEmbutida(b, "image/jpeg", "foto.jpg").temAssinaturaEmbutida).toBe(false);
  });
});

describe("hash", () => {
  it("amarra a assinatura ao arquivo: mudou um byte, mudou o hash", () => {
    // É o que faz reenviar o documento DERRUBAR a assinatura em vez de deixar
    // ela apontando pro papel novo, que ninguém assinou.
    expect(hashDoArquivo(Buffer.from("a"))).not.toBe(hashDoArquivo(Buffer.from("b")));
    expect(hashDoArquivo(Buffer.from("a"))).toBe(hashDoArquivo(Buffer.from("a")));
    expect(hashDoArquivo(Buffer.from("a"))).toHaveLength(64);
  });
});
