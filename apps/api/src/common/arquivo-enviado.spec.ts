import { describe, expect, it } from "vitest";
import { checarArquivoEnviado, MIMES_DOCUMENTO, MIMES_IMAGEM } from "./arquivo-enviado";

/**
 * A regra de o-que-pode-entrar, que estava reescrita em oito lugares.
 *
 * ⚠️ Onde a regra não tem dono, ela falta: DOIS caminhos subiam arquivo sem
 * conferir tipo nenhum — o documento do frete pessoal e o anexo que o agente
 * baixa do WhatsApp.
 */

const foto = { mimetype: "image/jpeg", originalname: "cnh.jpg", size: 1_000 };

describe("o que entra", () => {
  it("foto e PDF passam como documento", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) {
      expect(() =>
        checarArquivoEnviado({ ...foto, mimetype: m }, { mimes: MIMES_DOCUMENTO, maxBytes: 1e9 }),
      ).not.toThrow();
    }
  });

  it("`image/jpg` passa, mesmo não existindo no padrão", () => {
    // Galeria de Android manda assim. Recusar seria recusar foto boa.
    expect(() =>
      checarArquivoEnviado({ ...foto, mimetype: "image/jpg" }, { mimes: MIMES_IMAGEM, maxBytes: 1e9 }),
    ).not.toThrow();
  });

  it("PDF NÃO passa onde só cabe foto", () => {
    expect(() =>
      checarArquivoEnviado(
        { ...foto, mimetype: "application/pdf" },
        { mimes: MIMES_IMAGEM, maxBytes: 1e9 },
      ),
    ).toThrow();
  });

  it("HTML não entra em lugar nenhum", () => {
    // O mime vira Content-Type quando a API serve de volta: aceitar text/html
    // é aceitar servir HTML de um endereço nosso.
    expect(() =>
      checarArquivoEnviado(
        { ...foto, mimetype: "text/html" },
        { mimes: MIMES_DOCUMENTO, maxBytes: 1e9 },
      ),
    ).toThrow();
  });

  it("arquivo ausente é recusado com a frase de ausência", () => {
    expect(() =>
      checarArquivoEnviado(undefined, { mimes: MIMES_DOCUMENTO, maxBytes: 1e9 }),
    ).toThrow(/Nenhum arquivo/i);
  });
});

describe("a exceção do documento assinado", () => {
  it(".p7s entra mesmo chegando como octet-stream", () => {
    // O assinador do gov.br entrega assim, e é JUSTAMENTE o arquivo assinado
    // que o contratante pediu.
    expect(() =>
      checarArquivoEnviado(
        { mimetype: "application/octet-stream", originalname: "contrato.p7s", size: 10 },
        { mimes: MIMES_DOCUMENTO, maxBytes: 1e9, extensoesTambem: [".p7s", ".p7m"] },
      ),
    ).not.toThrow();
  });

  it("mas octet-stream sem a extensão continua fora", () => {
    expect(() =>
      checarArquivoEnviado(
        { mimetype: "application/octet-stream", originalname: "coisa.bin", size: 10 },
        { mimes: MIMES_DOCUMENTO, maxBytes: 1e9, extensoesTambem: [".p7s", ".p7m"] },
      ),
    ).toThrow();
  });
});

describe("o teto", () => {
  it("recusa acima do limite dizendo o limite em MB", () => {
    expect(() =>
      checarArquivoEnviado({ ...foto, size: 26 * 1024 * 1024 }, { mimes: MIMES_DOCUMENTO, maxBytes: 25 * 1024 * 1024 }),
    ).toThrow(/25 MB/);
  });

  it("aceita exatamente no limite", () => {
    expect(() =>
      checarArquivoEnviado({ ...foto, size: 25 * 1024 * 1024 }, { mimes: MIMES_DOCUMENTO, maxBytes: 25 * 1024 * 1024 }),
    ).not.toThrow();
  });

  it("sem tamanho informado, não inventa checagem", () => {
    // Origem que não tem `size` (mídia do WhatsApp) passa o length do buffer;
    // quem não passa nada é explicitamente não checado.
    expect(() =>
      checarArquivoEnviado({ mimetype: "image/jpeg" }, { mimes: MIMES_IMAGEM, maxBytes: 1 }),
    ).not.toThrow();
  });
});
