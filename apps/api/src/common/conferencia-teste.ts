import { JANELA_PERGUNTA_DE_TESTE_DIAS, ORIGEM_TESTE_PAINEL } from "@ronan/shared-types";
import { diasEsperadosAntesDeHoje, diasEntre, somarDias } from "./conferencia-diaria";
import type { Ymd } from "./ponto-jornada";

/**
 * Regras puras da PERGUNTA DE TESTE da conferência diária (pedida pelo painel,
 * fora do job).
 *
 * A linha de um teste carrega `snapshot.origem = "TESTE_PAINEL"`. Isso a tira de
 * tudo o que mede "quantas vezes perguntamos a este motorista": o intervalo mínimo
 * e o máximo por semana da empresa olham só as perguntas do JOB. Testar não pode
 * fazer o motorista deixar de ser perguntado de verdade nos dias seguintes.
 */

/** A linha é de um teste do painel? (snapshot de linha antiga ou lixo = não). */
export function ehPerguntaDeTeste(snapshot: unknown): boolean {
  return !!snapshot && typeof snapshot === "object" && (snapshot as { origem?: unknown }).origem === ORIGEM_TESTE_PAINEL;
}

/**
 * Sobre qual dia a pergunta de teste fala: o último dia ESPERADO antes de hoje
 * (dias da semana da regra da empresa, sem feriado nacional se ela ignora). Sem
 * configuração — ou sem nenhum dia esperado — vale "ontem".
 */
export function diaDaPerguntaDeTeste(
  hoje: Ymd,
  cfg: { diasConsiderados: number[]; ignorarFeriados: boolean } | null,
  feriados: ReadonlySet<Ymd> | null,
): Ymd {
  if (!cfg || cfg.diasConsiderados.length === 0) return somarDias(hoje, -1);
  const [ultimo] = diasEsperadosAntesDeHoje(hoje, 1, cfg.diasConsiderados, cfg.ignorarFeriados ? feriados : null);
  return ultimo ?? somarDias(hoje, -1);
}

/** "••••-1234": o suficiente pra conferir que é a pessoa certa, sem repetir o número inteiro. */
export function mascararTelefone(telefone: string): string {
  const d = telefone.replace(/\D/g, "");
  return d.length < 4 ? "••••" : `••••-${d.slice(-4)}`;
}

/**
 * O dia que o gestor escolheu no calendário serve pra uma pergunta de teste?
 * Fail-closed: formato inválido (inclusive data que não existe, como 31/02), hoje,
 * futuro e velho demais (janela) são recusados com a mensagem pra quem clicou.
 * Devolve `null` quando serve.
 */
export function motivoDiaDeTesteInvalido(dia: string, hoje: Ymd): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "Data inválida. Escolha um dia no calendário.";
  const [a, m, d] = dia.split("-").map(Number);
  const real = new Date(Date.UTC(a!, m! - 1, d!));
  if (real.getUTCFullYear() !== a || real.getUTCMonth() !== m! - 1 || real.getUTCDate() !== d) {
    return "Data inválida. Escolha um dia no calendário.";
  }
  if (dia >= hoje) return "Só dá pra perguntar sobre um dia que já passou. Hoje e os próximos dias ainda não fecharam.";
  if (diasEntre(dia, hoje) > JANELA_PERGUNTA_DE_TESTE_DIAS) {
    return `Esse dia é antigo demais. Dá pra perguntar até ${JANELA_PERGUNTA_DE_TESTE_DIAS} dias pra trás.`;
  }
  return null;
}
