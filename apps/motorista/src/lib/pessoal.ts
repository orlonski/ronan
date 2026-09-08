import type {
  CriarLancamentoPessoalInput,
  LancamentoPessoal,
  ResumoMesPessoal,
} from "@ronan/shared-types";
import { api } from "./api";
import { tokensIdentidade } from "./identidade";

/**
 * O caderninho dele, no aparelho.
 *
 * Namespace por PESSOA, não por empresa — ao contrário de tudo o mais que o app
 * guarda (`lib/sessoes.ts`). Gasto do próprio bolso não pode sumir quando ele
 * troca de empresa nem quando sai de todas: é dele, e continua aparecendo do
 * mesmo jeito. Por isso não passa pelo storage carimbado por cadastro.
 *
 * Offline igual ao resto do app: escreve local primeiro, mostra na hora, e
 * drena quando houver rede. Quem lança um abastecimento está num posto, e posto
 * é o lugar onde o sinal costuma faltar.
 */

type Pendente = CriarLancamentoPessoalInput & { criadoEm: number };

const raiz = (sufixo: string): string => {
  // `sub` do token da identidade = o id da pessoa. Sem token não há caderninho.
  const id = subDoToken(tokensIdentidade()?.accessToken) ?? "anonimo";
  return `ronan.eu.${id}.${sufixo}`;
};

function subDoToken(token?: string): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function ler<T>(chave: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function gravar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* cota cheia não pode derrubar o lançamento que ele acabou de fazer */
  }
}

// ---- Fila de envio ----

export function pendentes(): Pendente[] {
  return ler<Pendente[]>(raiz("pendentes"), []);
}

function guardarPendentes(lista: Pendente[]): void {
  gravar(raiz("pendentes"), lista);
}

/**
 * Enfileira o lançamento e tenta mandar na hora.
 *
 * A tela não espera a rede: o item já entra no cache do mês e aparece na lista.
 * Se o envio falhar, ele fica na fila — e o `clientId` garante que uma segunda
 * tentativa não vire um gasto em dobro.
 */
export async function lancar(input: CriarLancamentoPessoalInput): Promise<void> {
  guardarPendentes([...pendentes(), { ...input, criadoEm: Date.now() }]);
  cachePut(input.data.slice(0, 7), [
    { ...paraLocal(input), pendente: true },
    ...cacheDoMes(input.data.slice(0, 7)),
  ]);
  await drenar();
}

/** Manda o que está na fila. Silencioso: sem rede, fica pra próxima. */
export async function drenar(): Promise<void> {
  const fila = pendentes();
  if (fila.length === 0) return;
  const sobraram: Pendente[] = [];
  for (const item of fila) {
    try {
      const { criadoEm: _ignorado, ...payload } = item;
      await api.criarLancamentoPessoal(payload);
    } catch (err) {
      // 4xx é o motorista tendo que corrigir algo — mas aqui não há tela de
      // pendentes pra ele consertar, e o formulário já validou com o MESMO
      // schema do backend. Então 4xx só pode ser dado corrompido no aparelho:
      // descarta pra não travar a fila pra sempre. Falha de rede (sem status)
      // volta pra fila.
      const status = (err as { status?: number }).status;
      if (!status || status >= 500) sobraram.push(item);
    }
  }
  guardarPendentes(sobraram);
}

// ---- Cache do mês ----

type ItemLocal = LancamentoPessoal & { pendente?: boolean };

export function cacheDoMes(mes: string): ItemLocal[] {
  return ler<ItemLocal[]>(raiz(`mes.${mes}`), []);
}

export function cachePut(mes: string, itens: ItemLocal[]): void {
  gravar(raiz(`mes.${mes}`), itens);
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
 * Lista do mês: devolve o cache na hora e revalida por trás (cache-first, como
 * o resto do app). O que ainda está na fila é reposto por cima do que veio do
 * servidor — some sozinho quando o envio confirma.
 */
export async function carregarMes(mes: string): Promise<ItemLocal[]> {
  const daRede = await api.lancamentosPessoais(mes);
  const naFila = pendentes().filter((p) => p.data.startsWith(mes));
  const idsNaRede = new Set(daRede.map((l) => l.clientId));
  const itens: ItemLocal[] = [
    ...naFila.filter((p) => !idsNaRede.has(p.clientId)).map((p) => ({ ...paraLocal(p), pendente: true })),
    ...daRede,
  ];
  cachePut(mes, itens);
  return itens;
}

export async function carregarResumo(mes: string): Promise<ResumoMesPessoal> {
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
