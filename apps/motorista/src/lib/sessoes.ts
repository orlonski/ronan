import type { SessaoEmpresa } from "@ronan/shared-types";
import type { Tokens } from "./auth";

/**
 * As empresas em que este motorista está logado NESTE aparelho.
 *
 * O mesmo CPF pode ter cadastro em mais de uma empresa (carrega de dia pra uma,
 * de noite pra outra). Cada cadastro é um id de motorista diferente, com token
 * próprio, e NADA de um pode aparecer no outro — nem lançamento, nem catálogo,
 * nem pendente do outbox. Por isso a sessão ativa não é só "quem está logado":
 * é o dono de tudo que o app guarda aqui (ver `db/dexie.ts`).
 *
 * Espelha `lib/sessoes.ts` do app nativo, com localStorage (síncrono) no lugar
 * do SecureStore.
 */
export type SessaoLocal = {
  motoristaId: string;
  contaId: string;
  contaNome: string;
  status: "PENDENTE_APROVACAO" | "APROVADO" | "REJEITADO";
};

type Estado = { ativa: string | null; lista: SessaoLocal[] };

const KEY_INDICE = "ronan.sessoes.v1";
/** Chave de quando existia UMA sessão só — ainda lida como último recurso. */
export const KEY_LEGADA = "ronan.motorista.tokens";
/** Dono do cache/outbox gravado antes das sessões por empresa. */
const KEY_DONO_LEGADO = "ronan.dono-legado";

const chaveTokens = (motoristaId: string) => `${KEY_LEGADA}.${motoristaId}`;

const ouvintes = new Set<() => void>();

export function assinarSessoes(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

function avisar(): void {
  for (const fn of ouvintes) fn();
}

function ler(): Estado {
  try {
    const raw = localStorage.getItem(KEY_INDICE);
    return raw ? (JSON.parse(raw) as Estado) : { ativa: null, lista: [] };
  } catch {
    return { ativa: null, lista: [] };
  }
}

function gravar(e: Estado): void {
  try {
    localStorage.setItem(KEY_INDICE, JSON.stringify(e));
  } catch {
    /* modo privado / cota — a sessão em memória segue valendo nesta aba */
  }
  avisar();
}

export function listarSessoes(): SessaoLocal[] {
  return ler().lista;
}

export function sessaoAtiva(): SessaoLocal | null {
  const e = ler();
  return e.lista.find((s) => s.motoristaId === e.ativa) ?? null;
}

export function motoristaAtivoId(): string | null {
  return ler().ativa;
}

export function salvarSessoesDoLogin(sessoes: SessaoEmpresa[], ativarId?: string): void {
  for (const s of sessoes) {
    localStorage.setItem(
      chaveTokens(s.motoristaId),
      JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken }),
    );
  }
  const lista: SessaoLocal[] = sessoes.map((s) => ({
    motoristaId: s.motoristaId,
    contaId: s.contaId,
    contaNome: s.contaNome,
    status: s.status,
  }));
  gravar({ ativa: ativarId ?? lista[0]?.motoristaId ?? null, lista });
}

export function guardarSessao(s: SessaoEmpresa, ativar = true): void {
  localStorage.setItem(
    chaveTokens(s.motoristaId),
    JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken }),
  );
  const e = ler();
  const local: SessaoLocal = {
    motoristaId: s.motoristaId,
    contaId: s.contaId,
    contaNome: s.contaNome,
    status: s.status,
  };
  gravar({
    ativa: ativar ? s.motoristaId : e.ativa,
    lista: [...e.lista.filter((x) => x.motoristaId !== s.motoristaId), local],
  });
}

export function ativarSessao(motoristaId: string): void {
  const e = ler();
  if (!e.lista.some((s) => s.motoristaId === motoristaId)) return;
  gravar({ ...e, ativa: motoristaId });
}

/** Alinha nome da empresa e status com o que o servidor respondeu. */
export function sincronizarLista(cadastros: SessaoLocal[]): void {
  const e = ler();
  gravar({
    ...e,
    lista: e.lista.map((s) => {
      const novo = cadastros.find((c) => c.motoristaId === s.motoristaId);
      return novo ? { ...s, contaId: novo.contaId, contaNome: novo.contaNome, status: novo.status } : s;
    }),
  });
}

/** Cadastros que o servidor conhece mas que ainda não têm sessão aqui. */
export function semSessaoLocal(cadastros: SessaoLocal[]): SessaoLocal[] {
  const conhecidos = new Set(ler().lista.map((s) => s.motoristaId));
  return cadastros.filter((c) => !conhecidos.has(c.motoristaId));
}

/**
 * O token deste cadastro — conferindo que ele é MESMO deste cadastro.
 *
 * O `sub` do JWT diz de quem o token é. Se o que está no slot for de outro
 * cadastro, o app estaria falando com a empresa errada achando que é esta: as
 * telas mostrariam o dado de uma sob o nome da outra. Aconteceu por uma corrida
 * na renovação (já fechada em `lib/api.ts`), mas o estrago fica gravado aqui —
 * então o slot ruim é descartado, e quem precisar do token pede outro em
 * `/m/auth/trocar-empresa` (ver lib/troca-empresa.ts).
 */
export function tokensDe(motoristaId: string): Tokens | null {
  const raw = localStorage.getItem(chaveTokens(motoristaId));
  if (!raw) return null;
  let tokens: Tokens;
  try {
    tokens = JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
  const dono = subDoToken(tokens.accessToken) ?? subDoToken(tokens.refreshToken);
  if (dono && dono !== motoristaId) {
    localStorage.removeItem(chaveTokens(motoristaId));
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
export function temAlgumaSessaoComToken(): boolean {
  return ler().lista.some((s) => !!tokensDe(s.motoristaId)?.accessToken);
}

export function salvarTokensDe(motoristaId: string, t: Tokens): void {
  localStorage.setItem(chaveTokens(motoristaId), JSON.stringify(t));
}

/** Sai de TODAS as empresas. */
export function esquecerTudo(): void {
  for (const s of ler().lista) localStorage.removeItem(chaveTokens(s.motoristaId));
  gravar({ ativa: null, lista: [] });
  localStorage.removeItem(KEY_DONO_LEGADO);
}

/**
 * Adota a sessão de quem já estava logado antes desta versão.
 *
 * Ninguém pode ser deslogado por causa da atualização: a chave antiga só é
 * removida DEPOIS que a nova está gravada, e se o token não puder ser
 * identificado nada é movido — `loadTokens` continua caindo nele.
 *
 * Síncrono de propósito: roda antes de qualquer render e antes do Dexie abrir,
 * que precisa saber o dono pra carimbar os pendentes que já estão lá.
 */
export function migrarSessaoLegada(): void {
  const e = ler();
  if (e.lista.length > 0) return;

  const raw = localStorage.getItem(KEY_LEGADA);
  if (!raw) return;
  let tokens: Tokens;
  try {
    tokens = JSON.parse(raw) as Tokens;
  } catch {
    return;
  }
  const motoristaId = subDoToken(tokens.accessToken) ?? subDoToken(tokens.refreshToken);
  if (!motoristaId) return;

  localStorage.setItem(chaveTokens(motoristaId), raw);
  // A empresa entra sem nome e é preenchida na primeira resposta do servidor
  // (`/m/auth/cadastros`) — offline não dá pra saber, e não vale travar por isso.
  gravar({
    ativa: motoristaId,
    lista: [{ motoristaId, contaId: "", contaNome: "", status: "APROVADO" }],
  });
  localStorage.setItem(KEY_DONO_LEGADO, motoristaId);
  localStorage.removeItem(KEY_LEGADA);
}

export function donoLegado(): string | null {
  return localStorage.getItem(KEY_DONO_LEGADO);
}

export function limparDonoLegado(): void {
  localStorage.removeItem(KEY_DONO_LEGADO);
}

/**
 * Se ele ainda não disse, NESTA abertura do app, pra qual empresa vai rodar.
 * Em memória de propósito: cada abertura pergunta de novo pra quem roda pra mais
 * de uma — de manhã pode ser uma, à noite a outra.
 */
let escolheuNestaAbertura = false;

export function precisaEscolherEmpresa(): boolean {
  return !escolheuNestaAbertura && listarSessoes().length > 1;
}

export function marcarEmpresaEscolhida(): void {
  escolheuNestaAbertura = true;
  avisar();
}

/** O `sub` de dentro do JWT. Sem verificar assinatura — quem valida é o servidor. */
function subDoToken(jwt: string | undefined): string | null {
  if (!jwt) return null;
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}
