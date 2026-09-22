import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * A EMPRESA ONDE ELE É REGISTRADO EM CARTEIRA — guardada no aparelho.
 *
 * ⚠️ Existe porque o app decidia isso por ERRO DE REDE. `useEhFuncionario`
 * chamava `/m/ponto/hoje` e lia o 403 como "não é registrado" — então no
 * primeiro boot sem sinal a resposta era "não é", e a aba de registro de
 * jornada sumia justamente de quem precisa dela. Num app offline-first,
 * pergunta de quem-você-é não pode depender de ter sinal.
 *
 * Fica em `AsyncStorage` e não no Keychain de propósito: não é segredo, e
 * leitura de Keychain falha com o aparelho travado (ver `lib/keychain.ts`).
 * O pior caso aqui é o app não saber ainda — nunca o app achar que sabe.
 *
 * Quem escreve é `api.meuPerfil()`, e só ele. Espalhar a escrita por cada tela
 * que chama o perfil é como o conserto da miniatura ficou valendo pra uma das
 * duas portas de envio e não pra outra.
 */

export type VinculoRegistrado = {
  contaId: string;
  contaNome: string;
  /** Data de admissão, como o servidor mandou (ISO). */
  desde: string;
};

const KEY = "ronan.vinculo-registrado";

/**
 * `undefined` = ainda não leu do disco; `null` = leu e não é registrado.
 *
 * A distinção importa: renderizar com `null` antes de ler faria a tela do
 * autônomo aparecer por um instante pra quem é registrado — o mesmo defeito
 * que `useSemEmpresa` documenta.
 */
let _atual: VinculoRegistrado | null | undefined = undefined;
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const fn of ouvintes) fn();
}

export function assinarVinculoRegistrado(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

/** O que já se sabe, agora, sem esperar nada. */
export function vinculoRegistradoSync(): VinculoRegistrado | null | undefined {
  return _atual;
}

export async function carregarVinculoRegistrado(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    _atual = raw ? (JSON.parse(raw) as VinculoRegistrado) : null;
  } catch {
    // Storage indisponível: segue sem saber, que é melhor que fingir que sabe.
    _atual = null;
  }
  avisar();
}

/** Grava o que o servidor respondeu. Chamado só por `api.meuPerfil()`. */
export async function guardarVinculoRegistrado(
  v: VinculoRegistrado | null | undefined,
): Promise<void> {
  const novo = v ?? null;
  const mudou = JSON.stringify(_atual ?? null) !== JSON.stringify(novo);
  _atual = novo;
  try {
    if (novo) await AsyncStorage.setItem(KEY, JSON.stringify(novo));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* fica só em memória até a próxima vez */
  }
  if (mudou) avisar();
}

/**
 * Some no logout.
 *
 * ⚠️ Sem isto, o próximo a entrar neste aparelho herdaria o vínculo do
 * anterior — e veria a empresa de outra pessoa escrita na tela dele.
 */
export async function esquecerVinculoRegistrado(): Promise<void> {
  _atual = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* já era */
  }
  avisar();
}
