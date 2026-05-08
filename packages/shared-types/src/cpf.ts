/**
 * Tira pontos, traços e espaços. Retorna só dígitos.
 */
export function cpfDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Valida CPF pelos dígitos verificadores oficiais (Receita Federal).
 * Aceita com ou sem máscara — normaliza pra 11 dígitos antes.
 * Rejeita CPFs falsos comuns (todos dígitos iguais).
 */
export function isCpfValid(input: string): boolean {
  const cpf = cpfDigits(input);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  // Primeiro dígito verificador
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number.parseInt(cpf[i]!, 10) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== Number.parseInt(cpf[9]!, 10)) return false;

  // Segundo dígito verificador
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number.parseInt(cpf[i]!, 10) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  if (dv2 !== Number.parseInt(cpf[10]!, 10)) return false;

  return true;
}

/**
 * Formata 11 dígitos como CPF (123.456.789-00).
 * Se a entrada não tem 11 dígitos, retorna como veio.
 */
export function formatCpf(input: string): string {
  const cpf = cpfDigits(input);
  if (cpf.length !== 11) return input;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
