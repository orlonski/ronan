/**
 * Persistência local do DESTINO de navegação escolhido durante uma viagem em
 * andamento. Sobrevive a sair/voltar da tela e a fechar/reabrir o app enquanto
 * a viagem está rolando. Amarrado ao `viagemId` (uuid local da viagem) — se a
 * viagem for outra, o destino salvo é ignorado/limpo.
 *
 * Limpo em Finalizar/Descartar (o caller chama clearNavDestino).
 */
// O `storage` é o AsyncStorage carimbado com a empresa ativa (lib/storage.ts):
// o destino guardado é o da viagem aberta numa empresa, e o motorista pode rodar pra mais
// de uma. Chave global aqui faria o dado de uma aparecer — ou ser ENVIADO —
// pela outra.
import { storage as AsyncStorage } from "@/lib/storage";
import type { Local, RotaNav } from "@/lib/queries";

const KEY = "ronan.viagem-nav-destino";

export type NavDestinoSalvo = {
  viagemId: string;
  destino: Local;
  /** Última rota calculada (pode estar levemente velha; o guia recalcula). */
  rota: RotaNav | null;
  /** Motorista tocou em "Iniciar viagem" (liga a voz). Sobrevive sair/voltar. */
  iniciada?: boolean;
};

export async function getNavDestino(): Promise<NavDestinoSalvo | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NavDestinoSalvo;
  } catch {
    return null;
  }
}

export async function setNavDestino(v: NavDestinoSalvo): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage cheio/indisponível: navegação segue só em memória */
  }
}

export async function clearNavDestino(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignora */
  }
}
