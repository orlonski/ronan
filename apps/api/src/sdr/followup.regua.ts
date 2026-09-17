import { GAP_NOVA_CONVERSA_MIN } from "../common/gap-conversa";

/**
 * O que fazer com uma conversa que parou — e, quase sempre, nada.
 *
 * Aritmética pura: sem Prisma, sem Nest, sem relógio próprio. Quem varre passa
 * o estado e o `agora`; aqui só se decide. É o mesmo desenho de
 * `common/assinatura-cobranca.ts`, e pelo mesmo motivo: régua de mandar
 * mensagem pra gente de fora tem que ser testável linha a linha, sem subir
 * nada.
 *
 * ## A janela de 24h manda em tudo
 *
 * Dentro de 24h da última mensagem DELE, sai texto livre. Fora dela, a Meta só
 * aceita template aprovado — e um "você chegou a ver o link?" é classificado
 * como marketing, que exige opt-in, custa por mensagem e é exatamente o tipo de
 * mensagem que gera bloqueio e derruba a qualidade do número. A Movatruck já
 * foi banida uma vez. Então: passou de 24h, não existe follow-up. Existe
 * encerramento e a conversa aparecendo na tela pra uma PESSOA decidir.
 */

/** Motivo pelo qual não se faz nada. Vai pro log e pra tela, nunca pro prospect. */
export type MotivoParado =
  | "sem-conversa"
  | "ele-falou-por-ultimo"
  | "opt-out"
  | "fora-do-funil"
  | "humano-assumiu"
  | "ja-encerrada"
  | "ainda-cedo"
  | "fora-do-horario"
  | "toques-esgotados"
  | "janela-da-meta-fechada";

export type AcaoFollowup =
  | { tipo: "NADA"; motivo: MotivoParado }
  /** `passo` é 1 pro primeiro toque, 2 pro segundo. */
  | { tipo: "FOLLOWUP"; passo: number }
  | { tipo: "ENCERRAR"; motivo: "sem-resposta" | "janela-da-meta-fechada" };

/** O estado da conversa, do jeito que a varredura consegue ler. */
export type EstadoConversa = {
  /** Quem falou por último e quando. `null` = nunca houve mensagem. */
  ultimaDirecao: "ENTRADA" | "SAIDA" | null;
  ultimaMensagemEm: Date | null;
  /** A última vez que ELE escreveu — é daqui que a janela da Meta conta. */
  ultimaEntradaEm: Date | null;
  followupsEnviados: number;
  ultimoFollowupEm: Date | null;
  conversaEncerradaEm: Date | null;
  sdrPausadoEm: Date | null;
  optOut: boolean;
  status: string;
};

export type PrazosFollowup = {
  followupHoras: number;
  followupMax: number;
  followupIntervaloHoras: number;
  encerrarAposHoras: number;
  horaInicio: number;
  horaFim: number;
};

/** A janela de atendimento da Meta, em horas. Não é configurável: é regra deles. */
export const JANELA_META_HORAS = 24;

/**
 * Margem de segurança da janela.
 *
 * Mandar às 23h59 do prazo é apostar que nada atrasou entre decidir e entregar.
 * Uma hora antes custa pouco e evita a mensagem recusada em silêncio — porque é
 * isso que acontece: o Chatwoot aceita e a Meta descarta depois, sem erro do
 * nosso lado.
 */
const MARGEM_JANELA_HORAS = 1;

/**
 * O funil de quem o robô não toca.
 *
 * `GANHOU` virou cliente e `PERDEU` é decisão comercial de gente. `QUALIFICADO`
 * e `PROPOSTA` já têm dono humano — cobrar por cima de quem está negociando é
 * atropelar o vendedor.
 */
const STATUS_INTOCAVEIS = new Set(["GANHOU", "PERDEU", "QUALIFICADO", "PROPOSTA"]);

const HORA = 3_600_000;

function horasEntre(antes: Date, agora: Date): number {
  return (agora.getTime() - antes.getTime()) / HORA;
}

/** A hora cheia em São Paulo. O container roda em UTC e `getHours()` mentiria. */
export function horaEmSaoPaulo(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(d),
  );
}

/** Domingo não se cobra ninguém. Sábado passa — caminhão roda no sábado. */
export function diaDaSemanaEmSaoPaulo(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

export function dentroDaJanelaDeEnvio(agora: Date, p: PrazosFollowup): boolean {
  const hora = horaEmSaoPaulo(agora);
  return diaDaSemanaEmSaoPaulo(agora) !== 0 && hora >= p.horaInicio && hora < p.horaFim;
}

/**
 * A decisão.
 *
 * A ordem das cláusulas é a própria política: o que protege a pessoa vem antes
 * do que serve à venda, e nada aqui depende de um modelo lembrar de nada.
 */
export function acaoDoFollowup(
  c: EstadoConversa,
  p: PrazosFollowup,
  agora: Date,
): AcaoFollowup {
  // 1. Quem pediu pra sair, saiu. Antes de qualquer outra consideração.
  if (c.optOut) return { tipo: "NADA", motivo: "opt-out" };

  // 2. Virou cliente, foi perdido, ou já tem um vendedor cuidando.
  if (STATUS_INTOCAVEIS.has(c.status)) return { tipo: "NADA", motivo: "fora-do-funil" };

  // 3. Um humano assumiu: o robô não escreve por cima dele.
  if (c.sdrPausadoEm) return { tipo: "NADA", motivo: "humano-assumiu" };

  // 4. Assunto já encerrado — encerrar de novo seria escrever duas vezes.
  if (c.conversaEncerradaEm) return { tipo: "NADA", motivo: "ja-encerrada" };

  // 5. Nunca houve conversa: não há o que retomar.
  if (!c.ultimaMensagemEm || !c.ultimaDirecao) {
    return { tipo: "NADA", motivo: "sem-conversa" };
  }

  // 6. **A regra que vale mais que todas**: se o último a falar foi ELE, a
  //    conversa não está parada — está esperando resposta NOSSA. Cobrar quem
  //    está esperando é o pior erro possível do conjunto.
  if (c.ultimaDirecao === "ENTRADA") {
    return { tipo: "NADA", motivo: "ele-falou-por-ultimo" };
  }

  const silencio = horasEntre(c.ultimaMensagemEm, agora);

  // 7. Ainda é cedo. Tempo curto demais não é abandono, é a pessoa trabalhando.
  const desdeUltimoToque = c.ultimoFollowupEm ? horasEntre(c.ultimoFollowupEm, agora) : null;
  const prazoDaVez =
    c.followupsEnviados === 0 ? p.followupHoras : p.followupIntervaloHoras;
  const esperou = desdeUltimoToque ?? silencio;
  if (esperou < prazoDaVez) return { tipo: "NADA", motivo: "ainda-cedo" };

  // 8. A janela da Meta. Fora dela não existe follow-up — existe encerramento,
  //    que também não pode sair (é mensagem), então vira encerramento SILENCIOSO:
  //    o estado muda, a tela mostra, e nada é enviado.
  const desdeQueEleFalou = c.ultimaEntradaEm ? horasEntre(c.ultimaEntradaEm, agora) : Infinity;
  if (desdeQueEleFalou >= JANELA_META_HORAS - MARGEM_JANELA_HORAS) {
    return { tipo: "ENCERRAR", motivo: "janela-da-meta-fechada" };
  }

  // 9. Toques esgotados: passou o prazo total, encerra o assunto.
  if (c.followupsEnviados >= p.followupMax) {
    return silencio >= p.encerrarAposHoras
      ? { tipo: "ENCERRAR", motivo: "sem-resposta" }
      : { tipo: "NADA", motivo: "toques-esgotados" };
  }

  // 10. Horário de gente. Vale só pra QUEM VAI RECEBER mensagem — encerrar em
  //     silêncio (passo 8) pode acontecer a qualquer hora.
  if (!dentroDaJanelaDeEnvio(agora, p)) {
    return { tipo: "NADA", motivo: "fora-do-horario" };
  }

  return { tipo: "FOLLOWUP", passo: c.followupsEnviados + 1 };
}

/**
 * Como a tela chama esse estado, em português de gente.
 *
 * Mora aqui junto da régua porque é a MESMA classificação — dois lugares
 * decidindo o que é "parada" divergiriam no primeiro ajuste de prazo.
 */
export type EstadoVisivel = "ativa" | "aguardando-nos" | "parada" | "encerrada" | "com-humano";

export function estadoVisivel(c: EstadoConversa, p: PrazosFollowup, agora: Date): EstadoVisivel {
  if (c.conversaEncerradaEm) return "encerrada";
  if (c.sdrPausadoEm) return "com-humano";
  if (!c.ultimaMensagemEm || !c.ultimaDirecao) return "ativa";
  if (c.ultimaDirecao === "ENTRADA") {
    // Ele falou e ninguém respondeu. Passou do gap de retomada, isso não é
    // conversa em andamento: é alguém esperando.
    return horasEntre(c.ultimaMensagemEm, agora) * 60 >= GAP_NOVA_CONVERSA_MIN
      ? "aguardando-nos"
      : "ativa";
  }
  return horasEntre(c.ultimaMensagemEm, agora) >= p.followupHoras ? "parada" : "ativa";
}
