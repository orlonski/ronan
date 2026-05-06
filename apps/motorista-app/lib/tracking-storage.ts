/**
 * Persistência local da viagem em andamento (AsyncStorage).
 * Sem sync com backend — só sincroniza quando motorista finalizar e
 * o form Nova Viagem mandar tudo no payload.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Ponto = {
  lat: number;
  lng: number;
  capturadoEm: string; // ISO
  velocidade?: number;
  precisao?: number;
};

export type ViagemEmAndamento = {
  id: string; // uuid local
  iniciadoEm: string; // ISO
  pontos: Ponto[];
};

const KEY = "ronan.viagem-em-andamento";

export async function getViagemAndamento(): Promise<ViagemEmAndamento | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ViagemEmAndamento;
  } catch {
    return null;
  }
}

export async function setViagemAndamento(v: ViagemEmAndamento): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(v));
}

export async function clearViagemAndamento(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/**
 * Append atômico de pontos. Lê → adiciona → escreve. Race ok porque o
 * task de location dispara em sequência, não paralelo.
 */
export async function appendPontos(novos: Ponto[]): Promise<void> {
  const cur = await getViagemAndamento();
  if (!cur) return; // tracking foi cancelado, descarta
  cur.pontos = [...cur.pontos, ...novos];
  await setViagemAndamento(cur);
}
