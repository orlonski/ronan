import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { capacidadeNaConta, type AcessoAppDaConta, type CapacidadeApp } from "@ronan/shared-types";
import { assinarSessoes, sessaoAtivaSync } from "./sessoes";
import { assinarVinculoRegistrado, vinculoRegistradoSync } from "./vinculo-registrado";

/**
 * O ACESSO AO APP CALCULADO PELO SERVIDOR — guardado no aparelho.
 *
 * É o que a empresa configurou na tela "Acesso ao app" (perfil, regra,
 * exceção), já resolvido, uma entrada por empresa onde a pessoa tem vínculo.
 *
 * ⚠️ REGRA DE OURO DESTA FASE: a capacidade só TIRA, nunca PÕE. Cada item do
 * menu continua decidido do jeito de antes (as colunas do `/m/me`, o vínculo
 * de registrado, o dado que existe) E, por cima, precisa da capacidade. Sem
 * resposta do servidor pra esta empresa — primeiro boot sem sinal, cadastro
 * de minutos atrás — o app segue exatamente como antes. "Não sei" nunca vira
 * "não pode": sumir com a aba de ponto de quem precisa dela num canteiro sem
 * cobertura é o erro caro.
 *
 * Fica em `AsyncStorage` e não no Keychain: não é segredo, e Keychain falha
 * com o aparelho travado. Quem escreve é `api.meuPerfil()` e
 * `api.revalidarAcessos()` — e só eles.
 */

const KEY = "ronan.acessos-app";

/** `undefined` = ainda não leu do disco; `null` = leu e não há nada guardado. */
let _atual: AcessoAppDaConta[] | null | undefined = undefined;
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const fn of ouvintes) fn();
}

export function assinarAcessosApp(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

export function acessosAppSync(): AcessoAppDaConta[] | null | undefined {
  return _atual;
}

export async function carregarAcessosApp(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    _atual = raw ? (JSON.parse(raw) as AcessoAppDaConta[]) : null;
  } catch {
    _atual = null;
  }
  avisar();
}

/**
 * Grava o que o servidor respondeu. Resposta ausente (`undefined`, servidor
 * antigo) não apaga o que já se sabia.
 */
export async function guardarAcessosApp(v: AcessoAppDaConta[] | undefined): Promise<void> {
  if (!Array.isArray(v)) return;
  const mudou = JSON.stringify(_atual ?? null) !== JSON.stringify(v);
  _atual = v;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* fica só em memória até a próxima vez */
  }
  if (mudou) avisar();
}

/** Some no logout: o próximo a entrar neste aparelho não herda o acesso do anterior. */
export async function esquecerAcessosApp(): Promise<void> {
  _atual = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* já era */
  }
  avisar();
}

/** A decisão é pura e testada em `shared-types` (`capacidadeNaConta`). */
function capacidadeSync(chave: CapacidadeApp): boolean | undefined {
  return capacidadeNaConta(
    _atual,
    { sessao: sessaoAtivaSync()?.contaId ?? null, registrado: vinculoRegistradoSync()?.contaId ?? null },
    chave,
  );
}

function assinarTudo(fn: () => void): () => void {
  const a = assinarAcessosApp(fn);
  const b = assinarSessoes(fn);
  const c = assinarVinculoRegistrado(fn);
  return () => {
    a();
    b();
    c();
  };
}

/**
 * A capacidade na empresa ativa: `true`, `false`, ou `undefined` quando o app
 * ainda não sabe. Quase sempre o que se quer é `usePermite`.
 */
export function useCapacidade(chave: CapacidadeApp): boolean | undefined {
  return useSyncExternalStore(assinarTudo, () => capacidadeSync(chave), () => undefined);
}

/**
 * O item aparece se aparecia antes (`legado`) E a empresa não tirou a
 * capacidade. Sem resposta do servidor, vale o `legado` sozinho.
 */
export function usePermite(chave: CapacidadeApp, legado = true): boolean {
  const cap = useCapacidade(chave);
  return legado && cap !== false;
}
