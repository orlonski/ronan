import { formatCpf, isCpfValid } from "./cpf";

/**
 * Documento da empresa: muita transportadora pequena é MEI/autônomo e o que
 * ela tem é CPF, não CNPJ. Os helpers daqui tratam os dois no mesmo campo —
 * 11 dígitos é CPF, 14 é CNPJ.
 */

/** Tira pontos, barras, traços e espaços. Retorna só dígitos. */
export function documentoDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/** Formata 14 dígitos como CNPJ (12.345.678/0001-99). Se não tiver 14, volta como veio. */
export function formatCnpj(input: string): string {
  const d = documentoDigits(input);
  if (d.length !== 14) return input;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Formata pra exibir: 11 dígitos vira CPF, 14 vira CNPJ.
 * Qualquer outro tamanho volta como veio (dado velho não pode sumir da tela).
 */
export function formatDocumento(input: string | null | undefined): string {
  if (!input) return "";
  const d = documentoDigits(input);
  if (d.length === 11) return formatCpf(d);
  if (d.length === 14) return formatCnpj(d);
  return input;
}

/**
 * Máscara progressiva pra usar no onChange do campo: enquanto tem até 11
 * dígitos desenha de CPF, do 12º em diante vira CNPJ. Corta em 14 dígitos.
 */
export function maskDocumento(input: string): string {
  const d = documentoDigits(input).slice(0, 14);
  if (d.length <= 11) {
    // 123.456.789-01
    let out = d.slice(0, 3);
    if (d.length > 3) out += `.${d.slice(3, 6)}`;
    if (d.length > 6) out += `.${d.slice(6, 9)}`;
    if (d.length > 9) out += `-${d.slice(9, 11)}`;
    return out;
  }
  // 12.345.678/0001-99
  let out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}`;
  if (d.length > 12) out += `-${d.slice(12, 14)}`;
  return out;
}

/** Valida CNPJ pelos dois dígitos verificadores. Rejeita os falsos comuns (todos iguais). */
export function isCnpjValid(input: string): boolean {
  const cnpj = documentoDigits(input);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const dv = (base: string) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number.parseInt(base[i]!, 10) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  if (dv(cnpj.slice(0, 12)) !== Number.parseInt(cnpj[12]!, 10)) return false;
  if (dv(cnpj.slice(0, 13)) !== Number.parseInt(cnpj[13]!, 10)) return false;
  return true;
}

/** Aceita CPF ou CNPJ válido. Serve pro campo único de documento da empresa. */
export function isDocumentoValid(input: string): boolean {
  const d = documentoDigits(input);
  if (d.length === 11) return isCpfValid(d);
  if (d.length === 14) return isCnpjValid(d);
  return false;
}

/** Rótulo do que foi digitado, pra mensagem de erro/tela. */
export function tipoDocumento(input: string): "CPF" | "CNPJ" | null {
  const d = documentoDigits(input);
  if (d.length === 11) return "CPF";
  if (d.length === 14) return "CNPJ";
  return null;
}
