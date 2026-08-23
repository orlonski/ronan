import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { SessaoEmpresa } from "@ronan/shared-types";
import {
  KEYCHAIN_OPTS,
  KEY_LEGADA,
  KeychainLockedError,
  ehKeychainBloqueado,
  type Tokens,
} from "./keychain";

/**
 * As empresas em que este motorista está logado NESTE aparelho.
 *
 * O mesmo CPF pode ter cadastro em mais de uma empresa (carrega de dia pra uma,
 * de noite pra outra). Cada cadastro é um id de motorista diferente, com token
 * próprio, e NADA de um pode aparecer no outro — nem lançamento, nem catálogo,
 * nem pendente. Por isso a sessão ativa não é só "quem está logado": é o
 * namespace de tudo que o app guarda no aparelho (ver `db/database.ts`).
 *
 * O login devolve uma sessão por empresa de uma vez, então trocar de empresa não
 * pede senha e funciona offline.
 */
export type SessaoLocal = {
  motoristaId: string;
  contaId: string;
  contaNome: string;
  status: "PENDENTE_APROVACAO" | "APROVADO" | "REJEITADO";
};

type Estado = { ativa: string | null; lista: SessaoLocal[] };

const KEY_INDICE = "ronan.sessoes.v1";
/**
 * Quem era o dono dos dados guardados no prefixo antigo (global). Serve pra
 * decidir, na migração, se o cache/outbox que está lá é DESTE motorista — se não
 * for, ele é descartado em vez de adotado. Sem isso, quem logasse depois de
 * outro no mesmo aparelho herdaria os pendentes dele.
 */
const KEY_DONO_LEGADO = "ronan.dono-legado";

const chaveTokens = (motoristaId: string) => `ronan.motorista.tokens.${motoristaId}`;

let estado: Estado | null = null;
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const fn of ouvintes) fn();
}

export function assinarSessoes(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

async function carregar(): Promise<Estado> {
  if (estado) return estado;
  try {
    const raw = await AsyncStorage.getItem(KEY_INDICE);
    estado = raw ? (JSON.parse(raw) as Estado) : { ativa: null, lista: [] };
  } catch {
    estado = { ativa: null, lista: [] };
  }
  return estado;
}

async function gravar(novo: Estado): Promise<void> {
  estado = novo;
  await AsyncStorage.setItem(KEY_INDICE, JSON.stringify(novo)).catch(() => {});
  avisar();
}

/** Pré-carrega o índice no boot (deixa `sessaoAtivaSync` utilizável). */
export async function carregarSessoes(): Promise<void> {
  await carregar();
}

export async function listarSessoes(): Promise<SessaoLocal[]> {
  return (await carregar()).lista;
}

export async function sessaoAtiva(): Promise<SessaoLocal | null> {
  const e = await carregar();
  return e.lista.find((s) => s.motoristaId === e.ativa) ?? null;
}

/** Só depois de `carregarSessoes()`. Usado onde não dá pra esperar (render). */
export function sessaoAtivaSync(): SessaoLocal | null {
  if (!estado) return null;
  return estado.lista.find((s) => s.motoristaId === estado!.ativa) ?? null;
}

export function sessoesSync(): SessaoLocal[] {
  return estado?.lista ?? [];
}

export async function motoristaAtivoId(): Promise<string | null> {
  return (await carregar()).ativa;
}

/**
 * Se ele ainda não disse, NESTA abertura do app, pra qual empresa vai rodar.
 *
 * Vive só em memória de propósito: cada vez que o app abre do zero, quem roda
 * pra mais de uma empresa escolhe de novo. É o pedido do dia — de manhã pode ser
 * uma, à noite a outra — e evita passar o turno lançando na errada por inércia.
 * Com uma empresa só, nunca pergunta.
 */
let escolheuNestaAbertura = false;

export function precisaEscolherEmpresa(): boolean {
  return !escolheuNestaAbertura && (estado?.lista.length ?? 0) > 1;
}

export function marcarEmpresaEscolhida(): void {
  escolheuNestaAbertura = true;
  avisar();
}

/**
 * Guarda as sessões que o login devolveu e ativa uma delas.
 *
 * `ativarId` vem da escolha do motorista quando há mais de uma empresa; com uma
 * só, ativa direto (a tela nem aparece).
 */
export async function salvarSessoesDoLogin(
  sessoes: SessaoEmpresa[],
  ativarId?: string,
): Promise<void> {
  for (const s of sessoes) {
    await SecureStore.setItemAsync(
      chaveTokens(s.motoristaId),
      JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken }),
      KEYCHAIN_OPTS,
    );
  }
  const lista: SessaoLocal[] = sessoes.map((s) => ({
    motoristaId: s.motoristaId,
    contaId: s.contaId,
    contaNome: s.contaNome,
    status: s.status,
  }));
  const ativa = ativarId ?? lista[0]?.motoristaId ?? null;
  await gravar({ ativa, lista });
}

/** Acrescenta/atualiza UMA sessão (troca de empresa pelo endpoint, cadastro novo). */
export async function guardarSessao(s: SessaoEmpresa, ativar = true): Promise<void> {
  await SecureStore.setItemAsync(
    chaveTokens(s.motoristaId),
    JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken }),
    KEYCHAIN_OPTS,
  );
  const e = await carregar();
  const local: SessaoLocal = {
    motoristaId: s.motoristaId,
    contaId: s.contaId,
    contaNome: s.contaNome,
    status: s.status,
  };
  const lista = [...e.lista.filter((x) => x.motoristaId !== s.motoristaId), local];
  await gravar({ ativa: ativar ? s.motoristaId : e.ativa, lista });
}

/** Troca a empresa ativa. Quem limpa o cache em memória é quem chama (troca-empresa). */
export async function ativarSessao(motoristaId: string): Promise<void> {
  const e = await carregar();
  if (!e.lista.some((s) => s.motoristaId === motoristaId)) return;
  await gravar({ ...e, ativa: motoristaId });
}

/**
 * Ajusta a lista local pelo que o servidor respondeu em `/m/auth/cadastros`:
 * nome da empresa (que a migração não tinha como saber) e status de aprovação.
 * Só mexe no que já tem token aqui — cadastro novo entra por `guardarSessao`.
 */
export async function sincronizarLista(cadastros: SessaoLocal[]): Promise<void> {
  const e = await carregar();
  const lista = e.lista.map((s) => {
    const novo = cadastros.find((c) => c.motoristaId === s.motoristaId);
    return novo ? { ...s, contaId: novo.contaId, contaNome: novo.contaNome, status: novo.status } : s;
  });
  await gravar({ ...e, lista });
}

/** Cadastros que o servidor conhece mas que ainda não têm sessão neste aparelho. */
export async function semSessaoLocal(cadastros: SessaoLocal[]): Promise<SessaoLocal[]> {
  const e = await carregar();
  const conhecidos = new Set(e.lista.map((s) => s.motoristaId));
  return cadastros.filter((c) => !conhecidos.has(c.motoristaId));
}

/**
 * O token deste cadastro — conferindo que ele é MESMO deste cadastro.
 *
 * O `sub` do JWT diz de quem o token é. Se o que está no slot for de outro
 * cadastro, o app estaria falando com a empresa errada achando que é esta: as
 * telas mostrariam o dado de uma sob o nome da outra. Aconteceu por uma corrida
 * na renovação (já fechada em `lib/api.ts`), mas o estrago fica gravado no
 * aparelho — então o slot ruim é descartado aqui, e quem precisar do token pede
 * outro em `/m/auth/trocar-empresa` (ver lib/troca-empresa.ts).
 */
export async function tokensDe(motoristaId: string): Promise<Tokens | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(chaveTokens(motoristaId), KEYCHAIN_OPTS);
  } catch (err) {
    if (ehKeychainBloqueado(err)) throw new KeychainLockedError(err);
    throw err;
  }
  if (!raw) return null;
  let tokens: Tokens;
  try {
    tokens = JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
  const dono = subDoToken(tokens.accessToken) ?? subDoToken(tokens.refreshToken);
  if (dono && dono !== motoristaId) {
    await SecureStore.deleteItemAsync(chaveTokens(motoristaId), KEYCHAIN_OPTS).catch(() => {});
    return null;
  }
  return tokens;
}

/**
 * Ele continua logado em ALGUMA empresa?
 *
 * O boot não pode decidir isso só pelo token do cadastro ativo: esse slot pode
 * ter sido descartado por guardar o token de outro cadastro (ver `tokensDe`), e
 * mandar pro login quem tem sessão sã em outra empresa seria cobrar senha por um
 * estrago que não é dele — o reparo (`repararSessaoAtiva`) repõe o que falta.
 */
export async function temAlgumaSessaoComToken(): Promise<boolean> {
  for (const s of (await carregar()).lista) {
    try {
      if ((await tokensDe(s.motoristaId))?.accessToken) return true;
    } catch {
      // Keychain travado: não dá pra provar que NÃO tem sessão — e deslogar por
      // dúvida é o pior desfecho. Trata como logado; a request cuida do resto.
      return true;
    }
  }
  return false;
}

export async function salvarTokensDe(motoristaId: string, t: Tokens): Promise<void> {
  await SecureStore.setItemAsync(chaveTokens(motoristaId), JSON.stringify(t), KEYCHAIN_OPTS);
}

/** Sai de TODAS as empresas (o botão "Sair" do perfil). */
export async function esquecerTudo(): Promise<void> {
  const e = await carregar();
  for (const s of e.lista) {
    await SecureStore.deleteItemAsync(chaveTokens(s.motoristaId), KEYCHAIN_OPTS).catch(() => {});
  }
  await gravar({ ativa: null, lista: [] });
  await AsyncStorage.removeItem(KEY_DONO_LEGADO).catch(() => {});
}

/**
 * Adota a sessão de quem já estava logado antes desta versão.
 *
 * REGRA DE OURO desta migração: ninguém pode ser deslogado. O token antigo mora
 * numa chave só (`ronan.motorista.tokens`); aqui ele vira a sessão ativa do
 * cadastro que o próprio token identifica, e a chave velha só é apagada DEPOIS
 * que a nova está gravada. Se qualquer passo falhar, a chave velha fica onde
 * está — `loadTokens` continua caindo nela e o app segue funcionando exatamente
 * como antes.
 */
export async function migrarSessaoLegada(): Promise<void> {
  const e = await carregar();
  if (e.lista.length > 0) return; // já migrado

  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY_LEGADA, KEYCHAIN_OPTS);
  } catch {
    return; // Keychain travado: tenta no próximo boot, sem mexer em nada.
  }
  if (!raw) return; // deslogado — nada a adotar

  let tokens: Tokens;
  try {
    tokens = JSON.parse(raw) as Tokens;
  } catch {
    return;
  }
  const motoristaId = subDoToken(tokens.accessToken) ?? subDoToken(tokens.refreshToken);
  if (!motoristaId) return; // não deu pra saber de quem é: fica no caminho antigo

  await SecureStore.setItemAsync(chaveTokens(motoristaId), raw, KEYCHAIN_OPTS);
  // A empresa entra como "—" e é preenchida na primeira resposta do servidor
  // (`/m/auth/cadastros`). Não dá pra saber offline, e não vale segurar a
  // migração por causa do rótulo.
  await gravar({
    ativa: motoristaId,
    lista: [{ motoristaId, contaId: "", contaNome: "", status: "APROVADO" }],
  });
  // Marca que o cache/outbox global é DESTE motorista, pro database.ts adotar.
  await AsyncStorage.setItem(KEY_DONO_LEGADO, motoristaId).catch(() => {});
  await SecureStore.deleteItemAsync(KEY_LEGADA, KEYCHAIN_OPTS).catch(() => {});
}

/** O `sub` (id do motorista) de dentro do JWT. Sem verificar assinatura — só pra
 * saber de quem é o token que já está no aparelho; quem valida é o servidor. */
function subDoToken(jwt: string | undefined): string | null {
  if (!jwt) return null;
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const obj = JSON.parse(base64UrlDecode(payload)) as { sub?: string };
    return obj.sub ?? null;
  } catch {
    return null;
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * base64url → texto, na mão. Roda no boot, antes de qualquer tela: depender de
 * `atob` global (que existe ou não conforme a versão do RN/Hermes) transformaria
 * uma ausência silenciosa em app que não abre. Payload de JWT é ASCII.
 */
function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  let saida = "";
  let buffer = 0;
  let bits = 0;
  for (const ch of b64) {
    if (ch === "=") break;
    const valor = B64.indexOf(ch);
    if (valor === -1) continue;
    buffer = (buffer << 6) | valor;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      saida += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return saida;
}

export async function donoLegado(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_DONO_LEGADO).catch(() => null);
}

export async function limparDonoLegado(): Promise<void> {
  await AsyncStorage.removeItem(KEY_DONO_LEGADO).catch(() => {});
}
