import { diaDaSemanaEmSaoPaulo, horaEmSaoPaulo } from "../common/timezone";

/**
 * Quando o robô entrega a conversa pra gente: o que ele diz, e quando o aviso
 * sobe de degrau.
 *
 * Aritmética pura, sem Nest e sem banco, como `followup.regua.ts`. Existe
 * porque "alguém da Movatruck vai te chamar em breve" foi dito dezenas de vezes
 * sem ninguém ser avisado — e porque, quando ninguém responde, a promessa
 * quebrada é nossa, não do lead. Aqui mora a régua; quem avisa é o serviço.
 */

export type HorarioAtendimento = {
  /** Hora cheia de abertura em São Paulo (8 = 08:00). */
  inicio: number;
  /** Hora cheia de fechamento (18 = até 17:59). */
  fim: number;
  /** Dias da semana abertos, no índice do `getDay()` (0 = domingo). */
  dias: readonly number[];
};

/** Aberto agora? */
export function dentroDoHorario(h: HorarioAtendimento, agora: Date = new Date()): boolean {
  const dia = diaDaSemanaEmSaoPaulo(agora);
  const hora = horaEmSaoPaulo(agora);
  return h.dias.includes(dia) && hora >= h.inicio && hora < h.fim;
}

/**
 * Quando abre de novo, dito como uma pessoa diria: "hoje a partir das 8h",
 * "amanhã a partir das 8h", "segunda a partir das 8h".
 */
export function proximaAbertura(h: HorarioAtendimento, agora: Date = new Date()): string {
  const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const hora = horaEmSaoPaulo(agora);
  const hoje = diaDaSemanaEmSaoPaulo(agora);
  const aPartir = `a partir das ${h.inicio}h`;
  if (h.dias.includes(hoje) && hora < h.inicio) return `hoje ${aPartir}`;
  for (let i = 1; i <= 7; i++) {
    const dia = (hoje + i) % 7;
    if (h.dias.includes(dia)) return `${i === 1 ? "amanhã" : DIAS[dia]} ${aPartir}`;
  }
  return aPartir;
}

/**
 * A frase que o prospect lê quando a conversa passa pra gente.
 *
 * Com NOME e PRAZO. Sem nome, a pessoa perguntou "QUEM VAI ME ATENDER" em caixa
 * alta; sem prazo, "em breve" virou quinze dias em conversas reais. Fora do
 * horário, a promessa é a de verdade — prometer "em instantes" às 22h é
 * garantir que ela seja quebrada.
 */
export function mensagemDeRepasse(
  atendente: string | null,
  h: HorarioAtendimento,
  agora: Date = new Date(),
): string {
  const quem = atendente?.trim() ? `O ${atendente.trim()}` : "Alguém da Movatruck";
  return dentroDoHorario(h, agora)
    ? `Certo! ${quem} vai falar com você por aqui em instantes.`
    : `Certo! ${quem} te responde por aqui ${proximaAbertura(h, agora)}.`;
}

/**
 * Já passou tempo demais sem ninguém responder?
 *
 * O relógio só anda dentro do horário: lead que escreveu às 23h não "espera
 * 9 horas" — espera desde as 8h. Sem isso, toda noite viraria escalonamento
 * às 8h01, e aviso que toca sempre é aviso que ninguém lê.
 */
export function deveEscalonar(
  alertadoEm: Date,
  minutos: number,
  h: HorarioAtendimento,
  agora: Date = new Date(),
): boolean {
  if (!dentroDoHorario(h, agora)) return false;
  // A abertura de HOJE, no fuso de SP. O container roda em UTC: a hora local
  // sai da diferença entre o relógio de SP e o instante.
  const horaAgora = horaEmSaoPaulo(agora);
  const minutosDesdeAbertura = (horaAgora - h.inicio) * 60 + agora.getUTCMinutes();
  const abertura = new Date(agora.getTime() - minutosDesdeAbertura * 60_000);
  const desde = alertadoEm > abertura ? alertadoEm : abertura;
  return agora.getTime() - desde.getTime() >= minutos * 60_000;
}
