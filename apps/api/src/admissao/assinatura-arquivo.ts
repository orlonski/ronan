import { createHash } from "node:crypto";

/**
 * O que dá pra afirmar sobre um arquivo assinado — e o que não dá.
 *
 * ⚠️ A LINHA QUE NÃO SE ATRAVESSA: este módulo RECONHECE que um arquivo
 * carrega uma assinatura digital embutida. Ele NÃO valida a cadeia do
 * certificado, não checa revogação e não diz que a assinatura é válida.
 *
 * Validar ICP-Brasil de verdade é conferir o certificado contra as raízes do
 * ITI, checar LCR/OCSP na data da assinatura e verificar o digest do
 * conteúdo. Fazer meia validação e escrever "assinado com ICP-Brasil" na tela
 * é pior que não ter nada: vira uma afirmação falsa dentro de um documento
 * que existe justamente pra sustentar uma cobrança. Enquanto a validação
 * completa não existir, o sistema guarda a EVIDÊNCIA (o arquivo, o hash,
 * quem enviou, quando, de onde) e diz na cara que a conferência jurídica é
 * feita no verificador oficial.
 *
 * O que ele resolve de fato: impedir que um JPEG da CNH passe por "documento
 * assinado digitalmente" quando o contratante exige ICP.
 */

export type DeteccaoAssinatura = {
  /** O arquivo carrega uma assinatura digital embutida? */
  temAssinaturaEmbutida: boolean;
  /** Em que forma ela veio, quando veio. */
  formato: "PKCS7" | "PDF_EMBUTIDA" | null;
};

/** SHA-256 do arquivo. É o que amarra a assinatura AO papel que foi assinado. */
export function hashDoArquivo(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

const MIMES_PKCS7 = new Set([
  "application/pkcs7-signature",
  "application/x-pkcs7-signature",
  "application/pkcs7-mime",
  "application/x-pkcs7-mime",
]);

/** OID 1.2.840.113549.1.7.2 (signedData) em DER — a impressão digital do PKCS#7. */
const OID_SIGNED_DATA = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);

export function detectarAssinaturaEmbutida(
  buffer: Buffer,
  mimetype: string,
  nomeArquivo: string,
): DeteccaoAssinatura {
  const nome = nomeArquivo.toLowerCase();

  // .p7s / .p7m — o destacado do gov.br e dos assinadores de desktop.
  if (MIMES_PKCS7.has(mimetype) || nome.endsWith(".p7s") || nome.endsWith(".p7m")) {
    // Confere o OID em vez de confiar na extensão: renomear um JPEG pra .p7s
    // é a primeira coisa que alguém tenta quando o upload é recusado.
    if (buffer.includes(OID_SIGNED_DATA)) {
      return { temAssinaturaEmbutida: true, formato: "PKCS7" };
    }
    return { temAssinaturaEmbutida: false, formato: null };
  }

  // PDF com assinatura embutida: o dicionário de assinatura tem /ByteRange e
  // /Contents, e o subfiltro diz qual padrão (Adobe PKCS#7 ou CAdES do ETSI).
  // Um PDF comum não tem /ByteRange.
  if (mimetype === "application/pdf" || nome.endsWith(".pdf")) {
    const texto = buffer.toString("latin1");
    const temByteRange = texto.includes("/ByteRange");
    const temSubFilter =
      texto.includes("/adbe.pkcs7") ||
      texto.includes("/ETSI.CAdES") ||
      texto.includes("adbe.pkcs7") ||
      texto.includes("ETSI.CAdES");
    if (temByteRange && temSubFilter) {
      return { temAssinaturaEmbutida: true, formato: "PDF_EMBUTIDA" };
    }
    return { temAssinaturaEmbutida: false, formato: null };
  }

  return { temAssinaturaEmbutida: false, formato: null };
}

/**
 * O texto que o painel mostra sobre uma assinatura ICP.
 *
 * Fica aqui, junto da regra, pra ninguém escrever "assinatura válida" numa
 * tela enquanto o código só sabe dizer "o arquivo vem assinado".
 */
export const AVISO_ICP =
  "Arquivo recebido com assinatura digital embutida. A validade jurídica da assinatura " +
  "é conferida no verificador oficial (validar.iti.gov.br) — o sistema guarda o arquivo, " +
  "o hash e quem enviou, mas não valida a cadeia do certificado.";
