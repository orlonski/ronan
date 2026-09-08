import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  CriarLancamentoPessoalInput,
  CriarViagemPessoalInput,
  DocumentoPessoal,
  EditarLancamentoPessoalInput,
  EditarViagemPessoalInput,
  LancamentoPessoal,
  ResumoMesPessoal,
  ViagemPessoal,
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
type PendenteViagem = CriarViagemPessoalInput & { criadoEm: number };
/** O que o servidor recusou: fica guardado com o motivo, pra ele corrigir. */
type Falha<T> = T & { erro: string };
export type ItemPessoal = LancamentoPessoal & { pendente?: boolean; erro?: string };
export type ItemViagem = ViagemPessoal & { pendente?: boolean; erro?: string };

/** Alteração de item que JÁ subiu, esperando rede. */
type EdicaoPendente =
  | { alvo: "lancamento"; id: string; input: EditarLancamentoPessoalInput }
  | { alvo: "viagem"; id: string; input: EditarViagemPessoalInput };
type RemocaoPendente = { alvo: "lancamento" | "viagem"; id: string };

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
  // SEM `await`: o item já está na fila e já apareceu na lista. Esperar o POST
  // travava o botão "Salvando…" por 8s de timeout POR ITEM — e quem lança
  // abastecimento está num posto, que é onde o sinal falta.
  void drenar();
}

/** O que o servidor recusou e ele precisa corrigir (por tipo). */
export function falhados(): Promise<Falha<Pendente>[]> {
  return ler<Falha<Pendente>[]>("falhados", []);
}
export function viagensFalhadas(): Promise<Falha<PendenteViagem>[]> {
  return ler<Falha<PendenteViagem>[]>("viagens-falhadas", []);
}

/** Não deixa duas drenagens rodarem juntas e mandarem o mesmo item duas vezes. */
let drenando = false;

/** Manda o que está nas filas (fretes e gastos). Sem rede, fica pra próxima. */
export async function drenar(): Promise<void> {
  if (drenando) return;
  drenando = true;
  try {
    await drenarViagens();
    await drenarEdicoes();
    const fila = await pendentes();
    if (fila.length === 0) return;
    const sobraram: Pendente[] = [];
    const recusados: Falha<Pendente>[] = [];
    for (const item of fila) {
      try {
        const { criadoEm: _ignorado, ...payload } = item;
        await api.criarLancamentoPessoal(payload);
      } catch (err) {
        // Falha de rede (sem status) ou 5xx: volta pra fila, tenta de novo.
        // 4xx é o servidor dizendo que o dado não serve — e aqui o lançamento
        // do motorista NÃO se perde: sai da fila e vai pra "não subiu", com o
        // motivo, pra ele abrir e corrigir. Descartar em silêncio era apagar
        // dinheiro a receber sem ele nunca saber.
        const status = (err as { status?: number }).status;
        if (!status || status >= 500) sobraram.push(item);
        else recusados.push({ ...item, erro: (err as Error).message });
      }
    }
    await gravar("pendentes", sobraram);
    if (recusados.length) await gravar("falhados", [...(await falhados()), ...recusados]);
  } finally {
    drenando = false;
  }
}

async function drenarViagens(): Promise<void> {
  const fila = await viagensPendentes();
  if (fila.length === 0) return;
  const sobraram: PendenteViagem[] = [];
  const recusados: Falha<PendenteViagem>[] = [];
  for (const item of fila) {
    try {
      const { criadoEm: _ignorado, ...payload } = item;
      await api.criarViagemPessoal(payload);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (!status || status >= 500) sobraram.push(item);
      else recusados.push({ ...item, erro: (err as Error).message });
    }
  }
  await gravar("viagens-pendentes", sobraram);
  if (recusados.length) {
    await gravar("viagens-falhadas", [...(await viagensFalhadas()), ...recusados]);
  }
}

// ---- Correção e remoção do que já subiu ----

function edicoesPendentes(): Promise<EdicaoPendente[]> {
  return ler<EdicaoPendente[]>("edicoes", []);
}
function remocoesPendentes(): Promise<RemocaoPendente[]> {
  return ler<RemocaoPendente[]>("remocoes", []);
}

/**
 * Aplica correções e remoções feitas offline.
 *
 * PUT e DELETE são idempotentes por natureza, então reenviar não faz estrago —
 * é o que deixa a correção acontecer sem sinal e subir depois. 4xx aqui sai da
 * fila: o item já não existe (apagado noutro lugar) ou o dado foi recusado, e
 * insistir só travaria a fila.
 */
async function drenarEdicoes(): Promise<void> {
  const edicoes = await edicoesPendentes();
  const sobraramEdicoes: EdicaoPendente[] = [];
  for (const e of edicoes) {
    try {
      if (e.alvo === "lancamento") await api.editarLancamentoPessoal(e.id, e.input);
      else await api.editarViagemPessoal(e.id, e.input);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (!status || status >= 500) sobraramEdicoes.push(e);
    }
  }
  if (edicoes.length) await gravar("edicoes", sobraramEdicoes);

  const remocoes = await remocoesPendentes();
  const sobraramRemocoes: RemocaoPendente[] = [];
  for (const r of remocoes) {
    try {
      if (r.alvo === "lancamento") await api.apagarLancamentoPessoal(r.id);
      else await api.apagarViagemPessoal(r.id);
    } catch (err) {
      const status = (err as { status?: number }).status;
      // 404 é sucesso disfarçado: já não existe, que é o que ele queria.
      if ((!status || status >= 500) && status !== 404) sobraramRemocoes.push(r);
    }
  }
  if (remocoes.length) await gravar("remocoes", sobraramRemocoes);
}

/**
 * Corrige um gasto — o que ainda não subiu, na própria fila; o que já subiu,
 * por uma edição enfileirada. Nos dois casos a lista muda na hora.
 */
export async function editarLancamento(
  item: ItemPessoal,
  input: EditarLancamentoPessoalInput,
): Promise<void> {
  const mesAntigo = item.data.slice(0, 7);
  if (item.id.startsWith("local:")) {
    const troca = <T extends { clientId: string }>(f: T[]) =>
      f.map((p) => (p.clientId === item.clientId ? { ...p, ...input } : p));
    await gravar("pendentes", troca(await pendentes()));
    await gravar("falhados", troca(await falhados()));
  } else {
    await gravar("edicoes", [
      ...(await edicoesPendentes()).filter((e) => !(e.alvo === "lancamento" && e.id === item.id)),
      { alvo: "lancamento", id: item.id, input },
    ]);
  }
  // A lista do mês tem que refletir agora: ele acabou de corrigir e vai olhar.
  await cachePut(
    mesAntigo,
    (await cacheDoMes(mesAntigo)).filter((i) => i.clientId !== item.clientId),
  );
  const mesNovo = input.data.slice(0, 7);
  await cachePut(mesNovo, [
    { ...item, ...input, litros: input.litros ?? null, odometro: input.odometro ?? null, descricao: input.descricao ?? null, pendente: true, erro: undefined },
    ...(await cacheDoMes(mesNovo)).filter((i) => i.clientId !== item.clientId),
  ]);
  void drenar();
}

/** Corrige um frete. Mesma mecânica do gasto. */
export async function editarViagemPessoal(
  item: ItemViagem,
  input: EditarViagemPessoalInput,
): Promise<void> {
  const mesAntigo = item.data.slice(0, 7);
  if (item.id.startsWith("local:")) {
    const troca = <T extends { clientId: string }>(f: T[]) =>
      f.map((p) => (p.clientId === item.clientId ? { ...p, ...input } : p));
    await gravar("viagens-pendentes", troca(await viagensPendentes()));
    await gravar("viagens-falhadas", troca(await viagensFalhadas()));
  } else {
    await gravar("edicoes", [
      ...(await edicoesPendentes()).filter((e) => !(e.alvo === "viagem" && e.id === item.id)),
      { alvo: "viagem", id: item.id, input },
    ]);
  }
  await gravar(
    `viagens.${mesAntigo}`,
    (await cacheViagens(mesAntigo)).filter((i) => i.clientId !== item.clientId),
  );
  const mesNovo = input.data.slice(0, 7);
  await gravar(`viagens.${mesNovo}`, [
    {
      ...item,
      ...input,
      carga: input.carga ?? null,
      km: input.km ?? null,
      peso: input.peso ?? null,
      valorRecebido: input.valorRecebido ?? null,
      observacao: input.observacao ?? null,
      pendente: true,
      erro: undefined,
    },
    ...(await cacheViagens(mesNovo)).filter((i) => i.clientId !== item.clientId),
  ]);
  void drenar();
}

/** Apaga um gasto. Some da lista na hora; o servidor acompanha quando der. */
export async function apagarLancamento(item: ItemPessoal): Promise<void> {
  if (item.id.startsWith("local:")) {
    await gravar("pendentes", (await pendentes()).filter((p) => p.clientId !== item.clientId));
    await gravar("falhados", (await falhados()).filter((p) => p.clientId !== item.clientId));
  } else {
    await gravar("remocoes", [
      ...(await remocoesPendentes()),
      { alvo: "lancamento", id: item.id },
    ]);
  }
  const mes = item.data.slice(0, 7);
  await cachePut(mes, (await cacheDoMes(mes)).filter((i) => i.clientId !== item.clientId));
  void drenar();
}

/** Apaga um frete. */
export async function apagarViagem(item: ItemViagem): Promise<void> {
  if (item.id.startsWith("local:")) {
    await gravar(
      "viagens-pendentes",
      (await viagensPendentes()).filter((p) => p.clientId !== item.clientId),
    );
    await gravar(
      "viagens-falhadas",
      (await viagensFalhadas()).filter((p) => p.clientId !== item.clientId),
    );
  } else {
    await gravar("remocoes", [...(await remocoesPendentes()), { alvo: "viagem", id: item.id }]);
  }
  const mes = item.data.slice(0, 7);
  await gravar(
    `viagens.${mes}`,
    (await cacheViagens(mes)).filter((i) => i.clientId !== item.clientId),
  );
  void drenar();
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
  const doMes = <T extends { data: string }>(l: T[]) => l.filter((p) => p.data.startsWith(mes));
  const naFila = doMes(await pendentes());
  const recusados = doMes(await falhados());
  const idsNaRede = new Set(daRede.map((l) => l.clientId));
  // Remoção que ainda não subiu já sumiu da tela dele: se voltasse aqui, ele
  // veria o item ressuscitar a cada refresh até a rede aparecer.
  const apagados = new Set(
    (await remocoesPendentes()).filter((r) => r.alvo === "lancamento").map((r) => r.id),
  );
  const itens: ItemPessoal[] = [
    ...recusados
      .filter((p) => !idsNaRede.has(p.clientId))
      .map((p) => ({ ...paraLocal(p), pendente: true, erro: p.erro })),
    ...naFila
      .filter((p) => !idsNaRede.has(p.clientId))
      .map((p) => ({ ...paraLocal(p), pendente: true })),
    ...daRede.filter((l) => !apagados.has(l.id)),
  ];
  await cachePut(mes, itens);
  return itens;
}

export function carregarResumo(mes: string): Promise<ResumoMesPessoal> {
  return api.resumoPessoal(mes);
}

// ---- A carteira dele ----
//
// Cache pela mesma mecânica do resto: lê local na hora, revalida em background.
// A tela era 100% online — e o documento vencido, que é o que faz ele perder
// carga, some justamente onde ele quer conferir: na estrada, sem sinal.

export function cacheDocumentos(): Promise<DocumentoPessoal[]> {
  return ler<DocumentoPessoal[]>("documentos", []);
}

export async function carregarDocumentos(): Promise<DocumentoPessoal[]> {
  const docs = await api.meusDocumentos();
  await gravar("documentos", docs);
  return docs;
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

// ---- Os fretes dele ----
//
// Mesma mecânica do caderninho (fila + cache por mês, namespace da pessoa): ele
// lança o frete no pátio, sem sinal, e sobe quando der.

export function viagensPendentes(): Promise<PendenteViagem[]> {
  return ler<PendenteViagem[]>("viagens-pendentes", []);
}

export async function lancarViagem(input: CriarViagemPessoalInput): Promise<void> {
  const fila = await viagensPendentes();
  await gravar("viagens-pendentes", [...fila, { ...input, criadoEm: Date.now() }]);
  const mes = input.data.slice(0, 7);
  await gravar(`viagens.${mes}`, [
    { ...viagemParaLocal(input), pendente: true },
    ...(await cacheViagens(mes)),
  ]);
  void drenar();
}

export function cacheViagens(mes: string): Promise<ItemViagem[]> {
  return ler<ItemViagem[]>(`viagens.${mes}`, []);
}

function viagemParaLocal(input: CriarViagemPessoalInput): ViagemPessoal {
  return {
    id: `local:${input.clientId}`,
    clientId: input.clientId,
    data: input.data,
    origem: input.origem,
    destino: input.destino,
    carga: input.carga ?? null,
    km: input.km ?? null,
    peso: input.peso ?? null,
    valorRecebido: input.valorRecebido ?? null,
    observacao: input.observacao ?? null,
    criadoEm: new Date().toISOString(),
  };
}

export async function carregarViagens(mes: string): Promise<ItemViagem[]> {
  const daRede = await api.viagensPessoais(mes);
  const doMes = <T extends { data: string }>(l: T[]) => l.filter((p) => p.data.startsWith(mes));
  const naFila = doMes(await viagensPendentes());
  const recusados = doMes(await viagensFalhadas());
  const idsNaRede = new Set(daRede.map((v) => v.clientId));
  const apagados = new Set(
    (await remocoesPendentes()).filter((r) => r.alvo === "viagem").map((r) => r.id),
  );
  const itens: ItemViagem[] = [
    ...recusados
      .filter((p) => !idsNaRede.has(p.clientId))
      .map((p) => ({ ...viagemParaLocal(p), pendente: true, erro: p.erro })),
    ...naFila
      .filter((p) => !idsNaRede.has(p.clientId))
      .map((p) => ({ ...viagemParaLocal(p), pendente: true })),
    ...daRede.filter((v) => !apagados.has(v.id)),
  ];
  await gravar(`viagens.${mes}`, itens);
  return itens;
}
