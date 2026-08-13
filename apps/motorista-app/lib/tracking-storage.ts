/**
 * Persistência local da viagem em andamento (AsyncStorage).
 * Sem sync com backend — só sincroniza quando motorista finalizar e
 * o form Nova Viagem mandar tudo no payload.
 */
// O `storage` é o AsyncStorage carimbado com a empresa ativa (lib/storage.ts):
// a viagem em andamento é de UMA empresa, e o motorista pode rodar pra mais
// de uma. Chave global aqui faria o dado de uma aparecer — ou ser ENVIADO —
// pela outra.
import { storage as AsyncStorage } from "@/lib/storage";

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
  /** Snapshot de config aplicada nessa viagem — task de background usa pra filtrar */
  config?: {
    accuracyMaxMetros: number;
    velocidadeMaxKmh: number;
  };
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
