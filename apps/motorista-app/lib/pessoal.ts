import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  CriarLancamentoPessoalInput,
  LancamentoPessoal,
  ResumoMesPessoal,
} from "@ronan/shared-types";
import { api } from "./api";
import { tokensIdentidade } from "./identidade";
import { subDoToken } from "./sessoes";

/**
 * O caderninho dele, no aparelho.
 *
 * Namespace por PESSOA, não por empresa — ao contrário de tudo o mais que o app
 * guarda (`lib/storage.ts` carimba por cadastro). Gasto do próprio bolso não
 * pode sumir quando ele troca de empresa nem quando sai de todas: é dele, e
 * continua aparecendo do mesmo jeito. Por isso fala com o AsyncStorage direto.
 *
 * Offline igual ao resto do app: escreve local primeiro, mostra na hora, e drena
 * quando houver rede. Quem lança um abastecimento está num posto, e posto é o
 * lugar onde o sinal costuma faltar.
 */

type Pendente = CriarLancamentoPessoalInput & { criadoEm: number };
export type ItemPessoal = LancamentoPessoal & { pendente?: boolean };

async function raiz(sufixo: string): Promise<string> {
  const tokens = await tokensIdentidade().catch(() => null);
  // `sub` do token da identidade = o id da pessoa. Sem token não há caderninho.
  return `ronan.eu.${subDoToken(tokens?.accessToken) ?? "anonimo"}.${sufixo}`;
}

async function ler<T>(sufixo: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(await raiz(sufixo));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function gravar(sufixo: string, valor: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(await raiz(sufixo), JSON.stringify(valor));
  } catch {
    /* disco cheio não pode derrubar o lançamento que ele acabou de fazer */
  }
}

// ---- Fila de envio ----

export function pendentes(): Promise<Pendente[]> {
  return ler<Pendente[]>("pendentes", []);
}

/**
 * Enfileira o lançamento e tenta mandar na hora.
 *
 * A tela não espera a rede: o item já entra no cache do mês e aparece na lista.
 * Se o envio falhar, ele fica na fila — e o `clientId` garante que uma segunda
 * tentativa não vire um gasto em dobro.
 */
export async function lancar(input: CriarLancamentoPessoalInput): Promise<void> {
  const fila = await pendentes();
  await gravar("pendentes", [...fila, { ...input, criadoEm: Date.now() }]);
  const mes = input.data.slice(0, 7);
  await cachePut(mes, [{ ...paraLocal(input), pendente: true }, ...(await cacheDoMes(mes))]);
  await drenar();
}

/** Manda o que está na fila. Silencioso: sem rede, fica pra próxima. */
export async function drenar(): Promise<void> {
  const fila = await pendentes();
  if (fila.length === 0) return;
  const sobraram: Pendente[] = [];
  for (const item of fila) {
    try {
      const { criadoEm: _ignorado, ...payload } = item;
      await api.criarLancamentoPessoal(payload);
    } catch (err) {
      // 4xx é dado que o motorista teria que corrigir — mas o formulário já
      // validou com o MESMO schema do backend, então 4xx aqui só pode ser item
      // corrompido no aparelho: descarta pra não travar a fila pra sempre.
      // Falha de rede (sem status) volta pra fila.
      const status = (err as { status?: number }).status;
      if (!status || status >= 500) sobraram.push(item);
    }
  }
  await gravar("pendentes", sobraram);
}

// ---- Cache do mês ----

export function cacheDoMes(mes: string): Promise<ItemPessoal[]> {
  return ler<ItemPessoal[]>(`mes.${mes}`, []);
}

export function cachePut(mes: string, itens: ItemPessoal[]): Promise<void> {
  return gravar(`mes.${mes}`, itens);
}

/** Um pendente vira item de lista sem ter ido ao servidor — id local até subir. */
function paraLocal(input: CriarLancamentoPessoalInput): LancamentoPessoal {
  return {
    id: `local:${input.clientId}`,
    clientId: input.clientId,
    tipo: input.tipo,
    data: input.data,
    valor: input.valor,
    litros: input.litros ?? null,
    odometro: input.odometro ?? null,
    descricao: input.descricao ?? null,
    criadoEm: new Date().toISOString(),
  };
}

/**
 * Lista do mês: o que ainda está na fila entra por cima do que veio do servidor
 * — some sozinho quando o envio confirma.
 */
export async function carregarMes(mes: string): Promise<ItemPessoal[]> {
  const daRede = await api.lancamentosPessoais(mes);
  const naFila = (await pendentes()).filter((p) => p.data.startsWith(mes));
  const idsNaRede = new Set(daRede.map((l) => l.clientId));
  const itens: ItemPessoal[] = [
    ...naFila
      .filter((p) => !idsNaRede.has(p.clientId))
      .map((p) => ({ ...paraLocal(p), pendente: true })),
    ...daRede,
  ];
  await cachePut(mes, itens);
  return itens;
}

export function carregarResumo(mes: string): Promise<ResumoMesPessoal> {
  return api.resumoPessoal(mes);
}

/** O mês corrente no fuso do motorista (o app roda no relógio do aparelho). */
export function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

/** Data de hoje em YYYY-MM-DD, pro formulário nascer preenchido. */
export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
