import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import * as forge from "node-forge";
import { SignedXml } from "xml-crypto";

/**
 * A assinatura digital do CT-e.
 *
 * É ela que transforma um XML bem formado em documento fiscal: a SEFAZ refaz o
 * resumo (digest) do que foi assinado e confere contra o certificado. Qualquer
 * byte diferente do que foi assinado — inclusive um espaço a mais entre tags —
 * invalida tudo.
 *
 * Os parâmetros abaixo não são escolha nossa: o schema da SEFAZ os fixa. C14N e
 * rsa-sha1 estão `fixed=` no XSD, e `KeyInfo` é obrigatório (no xmldsig genérico
 * ele é opcional). Trocar qualquer um por algo mais moderno é rejeição.
 */

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

export type Certificado = {
  /** Chave privada em PEM. */
  chavePrivadaPem: string;
  /** Certificado do titular em PEM. */
  certificadoPem: string;
  /** CNPJ do titular, só dígitos — extraído do próprio certificado. */
  cnpj: string | null;
  titular: string;
  validoDe: Date;
  validoAte: Date;
};

/**
 * Abre um A1 (.pfx/.p12).
 *
 * O CNPJ sai do PRÓPRIO certificado, não de um campo digitado: é o que impede
 * emitir em nome de uma empresa com o certificado de outra. Ele vive numa
 * extensão do ICP-Brasil (otherName 2.16.76.1.3.3), e o fallback é o CN, que em
 * e-CNPJ costuma terminar com ":CNPJ".
 */
export function lerCertificado(pfx: Buffer, senha: string): Certificado {
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
  } catch {
    // Senha errada e arquivo corrompido chegam como a mesma exceção do forge.
    // Dizer "senha ou arquivo" é honesto; dizer só "senha" manda a pessoa
    // digitar de novo um arquivo que nunca ia funcionar.
    throw new Error("Não deu pra abrir o certificado: senha incorreta ou arquivo inválido.");
  }

  const bagsCert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const bagsChave =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? [];

  const cert = bagsCert.map((b) => b.cert).find((c): c is forge.pki.Certificate => Boolean(c));
  const chave = bagsChave.map((b) => b.key).find(Boolean);
  if (!cert || !chave) throw new Error("O arquivo não contém certificado e chave privada.");

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chave as forge.pki.PrivateKey),
    certificadoPem: forge.pki.certificateToPem(cert),
    cnpj: extrairCnpj(cert),
    titular: cert.subject.getField("CN")?.value ?? "(sem nome)",
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}

function extrairCnpj(cert: forge.pki.Certificate): string | null {
  // O CN de um e-CNPJ é "RAZAO SOCIAL:12345678000199".
  const cn = cert.subject.getField("CN")?.value as string | undefined;
  const doCn = cn?.match(/:(\d{14})\s*$/)?.[1];
  if (doCn) return doCn;

  // Fallback: a extensão subjectAltName do ICP-Brasil carrega o CNPJ dentro de
  // um otherName. Varremos os bytes procurando 14 dígitos seguidos porque a
  // estrutura varia entre autoridades certificadoras.
  const alt = cert.extensions.find((e) => e.name === "subjectAltName");
  const cru = JSON.stringify(alt?.altNames ?? alt?.value ?? "");
  return cru.match(/(?<!\d)(\d{14})(?!\d)/)?.[1] ?? null;
}

export type ResultadoAssinatura = { xml: string; assinadoEm: Date };

/**
 * Assina um documento fiscal do CT-e — o próprio CT-e ou um de seus eventos.
 *
 * A referência aponta pro `Id` do bloco assinável, não pro documento todo:
 * `infCte` no CT-e (`Id="CTe"+44`) e `infEvento` no evento (`Id="ID"+53`). É
 * esse trecho que a SEFAZ confere, e é por isso que o `Id` precisa estar
 * exatamente igual nos dois lugares.
 *
 * A `<Signature>` entra como irmã do bloco assinado.
 *
 * Um assinador só, e não dois: cancelamento, carta de correção e comprovante de
 * entrega usam a mesma criptografia com os mesmos parâmetros fixos — duplicar
 * daria duas chances de divergir num detalhe que só falha em produção.
 */
export function assinarCte(xml: string, cert: Certificado): ResultadoAssinatura {
  const id = xml.match(/Id="((?:CTe|ID)\d+)"/)?.[1];
  if (!id) throw new Error("O XML não tem o atributo Id do infCte — não há o que referenciar.");
  // O bloco a assinar decorre do prefixo do Id.
  const bloco = id.startsWith("CTe") ? "infCte" : "infEvento";

  const assinador = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });

  assinador.addReference({
    xpath: `//*[@Id='${id}']`,
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
    // Sem isto o xml-crypto inventaria um Id próprio no elemento; o Id tem que
    // ser o da chave, porque é ele que a SEFAZ usa pra achar o que foi assinado.
    uri: `#${id}`,
  });

  assinador.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${bloco}']`, action: "after" },
  });

  return { xml: assinador.getSignedXml(), assinadoEm: new Date() };
}

// ---------------------------------------------------------------------------
// Guarda do certificado
// ---------------------------------------------------------------------------

/**
 * O A1 é guardado cifrado, com chave que NÃO mora no banco.
 *
 * Isso importa porque backup de banco viaja: sem cifrar, um dump do Postgres
 * carregaria o poder de assinar documento fiscal em nome de cada transportadora
 * cliente. Com a chave em env, o dump sozinho não serve pra nada.
 *
 * AES-256-GCM porque ele autentica além de cifrar: byte trocado no banco vira
 * erro na abertura, e não uma chave privada silenciosamente corrompida.
 */
const ALGORITMO = "aes-256-gcm";

export function cifrar(dados: Buffer, chaveHex: string): Buffer {
  const chave = lerChave(chaveHex);
  const iv = randomBytes(12);
  const c = createCipheriv(ALGORITMO, chave, iv);
  const corpo = Buffer.concat([c.update(dados), c.final()]);
  // iv | tag | corpo — tudo num blob só, pra não haver três colunas que podem
  // sair de sincronia.
  return Buffer.concat([iv, c.getAuthTag(), corpo]);
}

export function decifrar(blob: Buffer, chaveHex: string): Buffer {
  const chave = lerChave(chaveHex);
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const d = createDecipheriv(ALGORITMO, chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

function lerChave(chaveHex: string): Buffer {
  const b = Buffer.from(chaveHex, "hex");
  if (b.length !== 32) {
    throw new Error(
      "CERTIFICADO_CHAVE precisa ser 32 bytes em hexadecimal (64 caracteres). " +
        "Gere com: openssl rand -hex 32",
    );
  }
  return b;
}
