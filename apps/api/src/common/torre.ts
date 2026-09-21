import { Prisma } from "@prisma/client";
import {
  dataHoraCurtaSaoPaulo,
  diaDaSemanaEmSaoPaulo,
  horaEmSaoPaulo,
  horaMinutoSaoPaulo,
} from "./timezone";

/**
 * O que está fora do esperado numa viagem em curso.
 *
 * A régua é a própria operação, não um número inventado: "atrasado" é comparado
 * com o tempo que a frota leva naquele mesmo par de locais. Inventar um limite
 * fixo (4 horas, digamos) geraria alerta em toda viagem longa e silêncio em toda
 * viagem curta — o pior dos dois mundos.
 *
 * ## Alarme falso é como se ensina o supervisor a ignorar a tela
 *
 * Esse princípio já estava escrito aqui e estava sendo aplicado só na escolha do
 * LIMIAR — nunca na frequência, na idade, no horário nem em quem recebe. O
 * resultado foi o previsto: uma viagem esquecida aberta virava alerta ALTA
 * eterno e enchia o sininho de todo mundo a cada 5 minutos. As três decisões que
 * consertam isso moram neste arquivo:
 *
 *  1. **Teto de idade.** Passado `viagemEsquecidaMin`, a viagem deixa de ser
 *     "parada" e passa a ser `VIAGEM_ESQUECIDA` — que é outro problema, com
 *     outra ação (fechar pelo painel) e sem urgência nenhuma. Não notifica.
 *  2. **Um problema por viagem.** Viagem esquecida não acumula ATRASO nem
 *     SEM_SINAL por cima: quem esqueceu a viagem aberta não precisa saber que
 *     ela também está "atrasada" há três dias.
 *  3. **Janela operacional.** Alerta às 3 da manhã não é informação, é despertador.
 *     A notificação espera o horário; o alerta em si nasce na hora.
 */

export type ViagemEmCurso = {
  id: string;
  motoristaId: string;
  motoristaNome: string;
  iniciadoEm: Date;
  localCargaNome: string | null;
  localDescargaNome: string | null;
  /** Último evento registrado, de qualquer tipo. */
  ultimoEventoEm: Date | null;
  /** Última posição de GPS recebida. */
  ultimaPosicaoEm: Date | null;
};

export type TipoAlerta = "ATRASO" | "PARADA_LONGA" | "SEM_SINAL" | "VIAGEM_ESQUECIDA";

export type AlertaDetectado = {
  tipo: TipoAlerta;
  severidade: "BAIXA" | "MEDIA" | "ALTA";
  viagemId: string;
  motoristaId: string;
  titulo: string;
  detalhe: string;
  dados: Prisma.InputJsonValue;
};

/**
 * Os números da régua, por conta.
 *
 * Eram sete constantes espalhadas por dois arquivos. Viraram um objeto porque
 * pedreira e obra não têm o mesmo relógio: 2h parado na fila de uma pedreira é
 * terça-feira, e numa entrega urbana é problema. Os defaults são exatamente os
 * valores antigos — ligar a configuração não muda o comportamento de ninguém.
 */
export type LimiaresTorre = {
  /** Sem evento por este tempo → PARADA_LONGA (MEDIA). */
  paradaLongaMin: number;
  /** Sem evento por este tempo → PARADA_LONGA vira ALTA (e só ALTA notifica). */
  paradaLongaAltaMin: number;
  /** Sem evento por este tempo → já não é parada, é viagem esquecida aberta. */
  viagemEsquecidaMin: number;
  /** Sem posição de GPS por este tempo → SEM_SINAL (só pra conta com tracking). */
  semSinalMin: number;
  /** Janela em que a notificação pode sair (hora de Brasília). */
  horaInicio: number;
  horaFim: number;
  /** Domingo notifica? Caminhão roda, mas nem toda operação tem quem atenda. */
  notificaDomingo: boolean;
};

export const LIMIARES_TORRE_PADRAO: LimiaresTorre = {
  paradaLongaMin: 120,
  paradaLongaAltaMin: 240,
  // 12h é onde "alguém precisa ligar agora" vira "alguém precisa arrumar o
  // cadastro". Acima disso o supervisor não descobre nada ligando.
  viagemEsquecidaMin: 720,
  semSinalMin: 180,
  // Mais larga que a do SDR (9–19): caminhão sai muito antes das 9.
  horaInicio: 6,
  horaFim: 20,
  notificaDomingo: true,
};

/**
 * Quanto tempo uma viagem pode levar antes de virar alerta.
 *
 * Sem histórico do par de locais, não gera alerta de atraso nenhum. É
 * deliberado: chutar um limite pra um trajeto que o sistema nunca viu produziria
 * alarme falso na primeira semana de uso, e alarme falso é como se ensina o
 * supervisor a ignorar a tela.
 */
export function limiteDeAtrasoMin(
  medianaMin: number | null,
  amostras: number,
): number | null {
  // Menos de 3 viagens no par não é histórico, é coincidência.
  if (medianaMin == null || amostras < 3) return null;
  // O dobro da mediana, com piso de 60 min: um trajeto de 20 minutos que leva 45
  // não é notícia; um de 20 que leva 2 horas é.
  return Math.max(60, Math.round(medianaMin * 2));
}

/**
 * A notificação pode sair agora?
 *
 * Só governa o SININHO. O alerta é sempre criado na hora — quem abre a torre às
 * 5h da manhã tem que ver o que aconteceu de madrugada. O que a janela evita é
 * acordar alguém por uma informação que só será útil às 7h.
 */
export function dentroDaJanelaDaTorre(agora: Date, l: LimiaresTorre): boolean {
  if (!l.notificaDomingo && diaDaSemanaEmSaoPaulo(agora) === 0) return false;
  const hora = horaEmSaoPaulo(agora);
  // Janela que vira a noite (ex.: 20h–6h) é intervalo aberto, não fechado.
  if (l.horaInicio <= l.horaFim) return hora >= l.horaInicio && hora < l.horaFim;
  return hora >= l.horaInicio || hora < l.horaFim;
}

function minutosDesde(d: Date, agora: Date): number {
  return Math.floor((agora.getTime() - d.getTime()) / 60_000);
}

export function humanizarMin(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Avalia uma viagem em curso e devolve os alertas que ela dispara.
 *
 * Pode devolver mais de um: uma viagem pode estar atrasada E sem sinal, e são
 * problemas diferentes — juntar os dois numa linha só esconderia um deles. A
 * exceção é a viagem esquecida, que devolve um só: ali o problema é a casca
 * aberta, e os outros dois alertas seriam consequência dela.
 */
export function avaliarViagem(
  v: ViagemEmCurso,
  ctx: {
    limiteAtrasoMin: number | null;
    /** Injetável pro teste não depender do relógio. */
    agora?: Date;
    /** Se a conta usa GPS. Sem tracking ligado, "sem sinal" é ruído garantido. */
    temTracking: boolean;
    limiares?: LimiaresTorre;
  },
): AlertaDetectado[] {
  const agora = ctx.agora ?? new Date();
  const l = ctx.limiares ?? LIMIARES_TORRE_PADRAO;
  const alertas: AlertaDetectado[] = [];
  const emCursoMin = minutosDesde(v.iniciadoEm, agora);

  // Parada longa: sem NENHUM evento novo há muito tempo. Usa evento e não GPS
  // porque o motorista pode estar sem sinal numa pedreira e ainda assim rodando.
  const refEvento = v.ultimoEventoEm ?? v.iniciadoEm;
  const semEventoMin = minutosDesde(refEvento, agora);

  // O teto de idade vem ANTES de tudo: passado ele, a viagem sai da operação e
  // vira pendência de cadastro. O próprio cálculo da mediana já descartava
  // viagem de mais de 24h como lixo estatístico — faltava valer aqui, que é
  // onde se incomoda alguém.
  if (semEventoMin >= l.viagemEsquecidaMin) {
    return [
      {
        tipo: "VIAGEM_ESQUECIDA",
        // Nunca ALTA: não há nada pra fazer com urgência, e era exatamente esta
        // linha que enchia o sininho a cada 5 minutos por dias seguidos.
        severidade: "MEDIA",
        viagemId: v.id,
        motoristaId: v.motoristaId,
        titulo: `${v.motoristaNome} · viagem aberta há ${humanizarMin(emCursoMin)}`,
        detalhe:
          `Começou ${dataHoraCurtaSaoPaulo(v.iniciadoEm)}` +
          (v.ultimoEventoEm
            ? ` e a última etapa foi ${dataHoraCurtaSaoPaulo(v.ultimoEventoEm)}.`
            : " e não teve nenhuma etapa.") +
          " Provavelmente ficou aberta por engano no app — dá pra fechar pelo painel sem perder o que já tem.",
        dados: { emCursoMin, semEventoMin },
      },
    ];
  }

  if (ctx.limiteAtrasoMin != null && emCursoMin > ctx.limiteAtrasoMin) {
    const excedente = emCursoMin - ctx.limiteAtrasoMin;
    alertas.push({
      tipo: "ATRASO",
      // Passar do dobro do limite é outra conversa: já não é trânsito, é
      // problema. A severidade é o que ordena a fila da torre.
      severidade: excedente > ctx.limiteAtrasoMin ? "ALTA" : "MEDIA",
      viagemId: v.id,
      motoristaId: v.motoristaId,
      titulo: `${v.motoristaNome} · ${humanizarMin(emCursoMin)} de viagem`,
      detalhe:
        `O normal nesse trajeto é cerca de ${humanizarMin(Math.round(ctx.limiteAtrasoMin / 2))}` +
        (v.localDescargaNome ? ` até ${v.localDescargaNome}` : "") +
        ".",
      dados: { emCursoMin, limiteMin: ctx.limiteAtrasoMin },
    });
  }

  if (semEventoMin >= l.paradaLongaMin) {
    alertas.push({
      tipo: "PARADA_LONGA",
      severidade: semEventoMin >= l.paradaLongaAltaMin ? "ALTA" : "MEDIA",
      viagemId: v.id,
      motoristaId: v.motoristaId,
      // "sem registrar nada" punha o parceiro como sujeito de uma omissão — é
      // ficha de ocorrência de funcionário, e motorista aqui é parceiro
      // autônomo. Quem está sem novidade é a viagem.
      titulo: `${v.motoristaNome} · sem novidade há ${humanizarMin(semEventoMin)}`,
      detalhe: v.ultimoEventoEm
        ? `A última etapa foi às ${horaMinutoSaoPaulo(v.ultimoEventoEm)}. Pode ser fila, sinal ruim ou algo no caminho — vale um contato.`
        : `A viagem começou às ${horaMinutoSaoPaulo(v.iniciadoEm)} e ainda não teve nenhuma etapa.`,
      dados: { semEventoMin },
    });
  }

  // Sem sinal só faz sentido pra quem tem tracking ligado. Sem isso, seria um
  // alerta permanente pra frota inteira — e alerta permanente é decoração.
  if (ctx.temTracking && v.ultimaPosicaoEm) {
    const semGpsMin = minutosDesde(v.ultimaPosicaoEm, agora);
    if (semGpsMin >= l.semSinalMin) {
      alertas.push({
        tipo: "SEM_SINAL",
        severidade: "BAIXA",
        viagemId: v.id,
        motoristaId: v.motoristaId,
        titulo: `${v.motoristaNome} · sem posição há ${humanizarMin(semGpsMin)}`,
        detalhe: "Pode ser área sem cobertura, celular sem bateria ou app fechado.",
        dados: { semGpsMin },
      });
    }
  }

  return alertas;
}

/**
 * O que fazer com um alerta detectado, dado o que já está vivo no banco.
 *
 * Mora aqui, e não no service, porque é exatamente a regra que estava errada e
 * não tinha teste: o cron fazia `create` cego dentro de um try/catch, confiando
 * num índice único que não deduplicava (no Postgres, dois NULL não colidem).
 * Todo alerta ALTA virava notificação a cada 5 minutos, para sempre.
 *
 * E não bastava consertar o índice: com o `create` como única escrita, um
 * alerta que nascia MEDIA nunca viraria ALTA, e o caso que PIOROU deixaria de
 * avisar. Os dois lados da regra vivem nesta função.
 */
export function decidirAlerta(
  detectado: AlertaDetectado,
  vivo: { severidade: string } | null,
): { acao: "criar" | "atualizar"; notificar: boolean } {
  const grave = detectado.severidade === "ALTA";
  if (!vivo) return { acao: "criar", notificar: grave };
  // Só a PIORA volta a incomodar alguém. O mesmo problema, do mesmo tamanho,
  // não se anuncia doze vezes por hora — é assim que se ensina alguém a
  // ignorar notificação.
  return { acao: "atualizar", notificar: grave && vivo.severidade !== "ALTA" };
}

/** A mediana é mais honesta que a média aqui: uma viagem de 8h não desloca tudo. */
export function medianaMinutos(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 === 0 ? Math.round((ord[meio - 1]! + ord[meio]!) / 2) : ord[meio]!;
}

/**
 * Quanto uma ocorrência com duração vale de estadia.
 *
 * A cobrança é por hora cheia iniciada, que é como se cobra estadia no Brasil —
 * 61 minutos são 2 horas. Cobrar proporcional ao minuto parece mais justo e não
 * é o que está no contrato de ninguém.
 */
export function valorDaEstadia(args: {
  iniciouEm: Date;
  terminouEm: Date | null;
  valorHora: Prisma.Decimal | string | number | null | undefined;
  /** Horas que não se cobra (franquia combinada com o cliente). */
  franquiaHoras?: number;
  agora?: Date;
}): { horas: number; horasCobradas: number; valor: string } | null {
  if (args.valorHora == null) return null;
  const fim = args.terminouEm ?? args.agora ?? new Date();
  const minutos = Math.max(0, Math.floor((fim.getTime() - args.iniciouEm.getTime()) / 60_000));
  const horas = Math.ceil(minutos / 60);
  const franquia = args.franquiaHoras ?? 0;
  const cobradas = Math.max(0, horas - franquia);
  const valorHora =
    args.valorHora instanceof Prisma.Decimal
      ? args.valorHora
      : new Prisma.Decimal(args.valorHora);
  return {
    horas,
    horasCobradas: cobradas,
    valor: valorHora.mul(cobradas).toFixed(2),
  };
}
