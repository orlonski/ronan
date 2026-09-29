/**
 * Alcance do WhatsApp de um número: "esse motorista recebe o que a gente manda?".
 *
 * Só a conferência diária lê isto. NUNCA bloqueia OTP, reset de senha nem aviso
 * de peso, e nunca mexe em `ativo`, `status`, `bloqueadoAte` ou `aceitaWhatsapp`.
 */

/**
 * Códigos de falha da Meta que dizem "o DESTINATÁRIO não é alcançável" — e não
 * "a gente errou".
 *
 * ⚠️ É conhecimento geral sobre a Cloud API, A CONFERIR na documentação de
 * códigos de erro antes de ligar em produção (a Meta muda e renomeia):
 *   131026 — mensagem não entregável (número sem WhatsApp, versão antiga do app,
 *            termos não aceitos…).
 *   131049 — a Meta escolheu não entregar (engajamento/qualidade do ecossistema).
 *
 * Lista de PERMISSÃO de propósito: código novo ou desconhecido NÃO conta. Falha
 * nossa — template reprovado (132001…), limite de envio (130429/131056), token
 * (190), pagamento (131042), janela de 24h (131047) — não pode fazer um
 * motorista parecer inalcançável.
 */
export const CODIGOS_DESTINATARIO_NAO_ALCANCAVEL: ReadonlySet<number> = new Set([131026, 131049]);

/** "131026" | "META_131026" | 131026 → 131026; qualquer outra coisa → null. */
export function codigoNumericoDeErro(codigo: string | number | null | undefined): number | null {
  if (codigo == null) return null;
  const m = /^(?:META_)?(\d{3,6})$/.exec(String(codigo).trim());
  return m ? Number(m[1]) : null;
}

/** Este código de falha indica destinatário não alcançável (e conta pro contador)? */
export function falhaEhDeAlcance(codigo: string | number | null | undefined): boolean {
  const n = codigoNumericoDeErro(codigo);
  return n != null && CODIGOS_DESTINATARIO_NAO_ALCANCAVEL.has(n);
}

/** Como o código de erro é gravado em `WhatsappMensagem.erroCodigo` — igual nos dois caminhos (síncrono e webhook). */
export function codigoDeErroParaGravar(codigo: string | number | null | undefined): string | null {
  if (codigo == null) return null;
  const n = codigoNumericoDeErro(codigo);
  return n != null ? String(n) : String(codigo);
}

export type MensagemParaAlcance = {
  statusEntrega: string | null;
  idExterno: string | null;
  criadoEm: Date;
};

const ENTREGUE = new Set(["delivered", "read"]);

/**
 * O detector do SILENCIOSO: as últimas `n` mensagens que a Meta ACEITOU, dentro
 * da janela, nenhuma entregue.
 *
 * - Só entra quem a Meta aceitou (`idExterno`): recusa síncrona é falha nossa
 *   ou de política, não sinal do aparelho.
 * - Mensagem com menos de `carenciaHoras` ainda pode estar a caminho e não conta.
 * - `depoisDe` (o "reverificar" e a última entrega) descarta o que veio antes.
 *
 * Recebe as mensagens da MAIS RECENTE pra mais antiga.
 */
export function numeroSilencioso(
  mensagens: readonly MensagemParaAlcance[],
  n: number,
  agora: Date,
  opts: { carenciaHoras?: number; depoisDe?: Date | null } = {},
): boolean {
  const carencia = (opts.carenciaHoras ?? 6) * 3_600_000;
  const validas = mensagens.filter(
    (m) =>
      m.idExterno != null &&
      agora.getTime() - m.criadoEm.getTime() >= carencia &&
      (!opts.depoisDe || m.criadoEm.getTime() > opts.depoisDe.getTime()),
  );
  const ultimas = validas.slice(0, n);
  if (ultimas.length < n) return false;
  return ultimas.every((m) => !m.statusEntrega || !ENTREGUE.has(m.statusEntrega));
}
