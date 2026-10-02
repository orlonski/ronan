import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * O QUE ELE DISSE SER no cadastro: roda pra uma empresa ou trabalha por conta
 * própria. Guardado no aparelho.
 *
 * Existe porque "sem vínculo" não quer dizer "autônomo": quem escolheu
 * "trabalho pra uma empresa" e ainda não achou a sua também está sem vínculo, e o
 * app o chamava de autônomo — o que não é verdade. Só o que ele disse vale; sem
 * resposta (conta antiga, aparelho novo) o app NÃO rotula ninguém.
 *
 * Não é segredo nem regra de negócio — só decide texto e destaque na home. Por
 * isso fica no AsyncStorage e não no servidor.
 */
export type ComoTrabalha = "empresa" | "autonomo";

const KEY = "ronan.como-trabalha";

export async function lerComoTrabalha(): Promise<ComoTrabalha | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "empresa" || v === "autonomo" ? v : null;
  } catch {
    return null;
  }
}

export async function gravarComoTrabalha(v: ComoTrabalha): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, v);
  } catch {
    /* sem storage o app só não rotula — nunca rotula errado */
  }
}

export async function esquecerComoTrabalha(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* idem */
  }
}
