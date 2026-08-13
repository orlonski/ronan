import AsyncStorage from "@react-native-async-storage/async-storage";
import { motoristaAtivoId } from "./sessoes";

/**
 * AsyncStorage AMARRADO À EMPRESA ATIVA.
 *
 * O motorista pode ter cadastro em mais de uma empresa no mesmo aparelho, e
 * NADA de uma pode aparecer na outra. Isso não vale só pro cache de telas: a
 * viagem em andamento, a fila de posições de GPS, os eventos de geofence, a
 * referência de km do trajeto — tudo é dado de UMA empresa e, guardado numa
 * chave global, apareceria (ou pior: seria ENVIADO) pela outra.
 *
 * Em vez de cada módulo lembrar de carimbar a chave, o carimbo mora aqui: quem
 * importa `storage` no lugar do `AsyncStorage` fica isolado sem mudar mais nada.
 * As chaves viram `ronan.@<motoristaId>.<chave-original>`.
 *
 * O `@` não é enfeite: é o que distingue chave JÁ namespaceada de chave antiga
 * na hora de migrar (`adotarChavesLegadas`).
 */

const PREFIXO = "ronan.";
const MARCA = "@";

/**
 * Chaves que NÃO pertencem a uma empresa e ficam fora do namespace:
 * — o índice de sessões e os tokens (são justamente quem diz qual é a empresa);
 * — marcadores de migração;
 * — a fila de erros, que é diagnóstico do app e existe até antes do login.
 *
 * O que o tutorial já viu fica fora do prefixo `ronan.` (chave `tutorial.seen.*`)
 * e nem passa por aqui — é preferência do aparelho, não dado de empresa.
 */
const GLOBAIS = [
  "ronan.sessoes.v1",
  "ronan.dono-legado",
  "ronan.keychain.migrado.v1",
  "ronan.motorista.tokens", // e as por-cadastro (cobertas pelo `.` do startsWith)
  "ronan.motorista.status",
  "ronan.errors-pendentes",
];

function ehGlobal(chave: string): boolean {
  return GLOBAIS.some((g) => chave === g || chave.startsWith(`${g}.`));
}

/** Chave lógica → chave real no disco, pro cadastro informado. */
export function chaveDoCadastro(motoristaId: string, chave: string): string {
  const resto = chave.startsWith(PREFIXO) ? chave.slice(PREFIXO.length) : chave;
  return `${PREFIXO}${MARCA}${motoristaId}.${resto}`;
}

async function real(chave: string): Promise<string> {
  if (ehGlobal(chave)) return chave;
  const id = await motoristaAtivoId();
  // Sem sessão (ainda não migrado, ou pré-login): fica na chave de sempre. É o
  // que mantém o app de quem acabou de atualizar achando os dados dele.
  return id ? chaveDoCadastro(id, chave) : chave;
}

/** Chave real → chave lógica, se for do cadastro ativo. `null` = de outro. */
function logica(chaveReal: string, id: string | null): string | null {
  if (ehGlobal(chaveReal)) return chaveReal;
  if (!chaveReal.startsWith(`${PREFIXO}${MARCA}`)) return chaveReal;
  if (!id) return null;
  const meu = `${PREFIXO}${MARCA}${id}.`;
  return chaveReal.startsWith(meu) ? PREFIXO + chaveReal.slice(meu.length) : null;
}

/**
 * Mesma cara do AsyncStorage — troque o import e pronto. `getAllKeys` devolve as
 * chaves LÓGICAS do cadastro ativo (as das outras empresas simplesmente não
 * existem daqui), pra que os `startsWith` que já existem continuem valendo.
 */
export const storage = {
  async getItem(chave: string): Promise<string | null> {
    return AsyncStorage.getItem(await real(chave));
  },
  async setItem(chave: string, valor: string): Promise<void> {
    return AsyncStorage.setItem(await real(chave), valor);
  },
  async removeItem(chave: string): Promise<void> {
    return AsyncStorage.removeItem(await real(chave));
  },
  async multiGet(chaves: readonly string[]): Promise<[string, string | null][]> {
    const reais = await Promise.all(chaves.map(real));
    const pares = await AsyncStorage.multiGet(reais);
    // Devolve na ordem pedida e com a chave lógica — quem chamou não conhece o
    // nome real.
    return pares.map((par, i) => [chaves[i]!, par[1] ?? null]);
  },
  async multiRemove(chaves: readonly string[]): Promise<void> {
    return AsyncStorage.multiRemove(await Promise.all(chaves.map(real)));
  },
  async getAllKeys(): Promise<string[]> {
    const [todas, id] = await Promise.all([AsyncStorage.getAllKeys(), motoristaAtivoId()]);
    return todas.map((k) => logica(k, id)).filter((k): k is string => k !== null);
  },
};

/**
 * Move pro namespace do cadastro tudo que ficou no formato antigo (global).
 *
 * ADOTA, não apaga: pode haver viagem em andamento e lançamento pendente aí
 * dentro, e perder o trabalho do motorista por causa de uma atualização é
 * inaceitável. Só roda com o dono confirmado — o `sub` do token que já estava no
 * aparelho.
 */
export async function adotarChavesLegadas(motoristaId: string): Promise<void> {
  for (const antiga of await chavesLegadas()) {
    const nova = chaveDoCadastro(motoristaId, antiga);
    try {
      const valor = await AsyncStorage.getItem(antiga);
      if (valor === null) continue;
      // Não sobrescreve o que o cadastro já tem (o dado dele vale mais).
      if ((await AsyncStorage.getItem(nova)) === null) {
        await AsyncStorage.setItem(nova, valor);
      }
      await AsyncStorage.removeItem(antiga);
    } catch {
      /* falhou: a chave antiga fica onde está e a próxima abertura retenta */
    }
  }
}

/**
 * Apaga o que ficou no formato antigo sem adotar.
 *
 * É o caminho de quando NÃO dá pra provar de quem são os dados (outro motorista
 * usou este aparelho antes). Deixá-los ali é que seria grave: o próximo login
 * enviaria o lançamento de um sob o token do outro.
 */
export async function descartarChavesLegadas(): Promise<void> {
  const antigas = await chavesLegadas();
  if (antigas.length > 0) await AsyncStorage.multiRemove(antigas).catch(() => {});
}

/** Chaves `ronan.*` que ainda não têm dono e não são globais. */
async function chavesLegadas(): Promise<string[]> {
  const todas = await AsyncStorage.getAllKeys();
  return todas.filter(
    (k) => k.startsWith(PREFIXO) && !k.startsWith(`${PREFIXO}${MARCA}`) && !ehGlobal(k),
  );
}
