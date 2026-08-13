"use client";

import { useEffect, useState } from "react";
import { usePermissoes } from "@/lib/permissoes";

/**
 * A marca da empresa guardada no navegador, só pra desenhar o painel já certo.
 *
 * Sem isso, todo F5 mostrava a marca da plataforma por ~1 segundo até a chamada
 * de `/admin/users/me` responder — o cliente via a marca de OUTRO produto no
 * painel dele. Guardar aqui não é cache de dado: é lembrar qual logo desenhar,
 * pra não piscar a errada.
 *
 * Nada aqui é fonte de verdade. O `/me` continua mandando, e sobrescreve assim
 * que chega. E some no logout — senão o próximo a entrar no mesmo navegador
 * veria por um instante a marca da empresa anterior.
 */

const CHAVE = "movatruck.marca";

export type MarcaConta = {
  id: string;
  nome: string;
  logoUrl: string | null;
};

export function lerMarca(): MarcaConta | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const marca = JSON.parse(bruto) as MarcaConta;
    return marca && typeof marca.nome === "string" ? marca : null;
  } catch {
    return null;
  }
}

export function guardarMarca(marca: MarcaConta): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(marca));
  } catch {
    // Navegador sem storage (aba anônima com restrição) só perde o ganho do
    // primeiro paint — o painel segue funcionando.
  }
}

export function limparMarca(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
}

/**
 * A marca a desenhar AGORA: a que veio do `/me` quando já chegou, senão a última
 * conhecida deste navegador.
 *
 * `carregando` diz que ainda não há nenhuma das duas — é o primeiro acesso neste
 * navegador. Quem usa deve reservar o espaço nesse caso, em vez de desenhar um
 * palpite: piscar a marca errada é pior do que ela aparecer um instante depois.
 */
export function useMarcaConta(): { marca: MarcaConta | null; carregando: boolean } {
  const { conta, isLoading } = usePermissoes();
  // Lido no efeito, não no `useState`, pra não divergir do HTML do servidor
  // (que não tem localStorage) e causar erro de hidratação.
  const [lembrada, setLembrada] = useState<MarcaConta | null>(null);
  // `montado` existe porque `isLoading` NÃO cobre o primeiro instante: a consulta
  // ao `/me` só é habilitada quando o token da sessão chega, e antes disso o
  // React Query reporta "não está carregando". Sem esta marca, o primeiro
  // desenho caía no fallback e a marca errada piscava — que é justamente o que
  // este arquivo existe pra evitar.
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setLembrada(lerMarca());
    setMontado(true);
  }, []);

  useEffect(() => {
    if (!conta) return;
    const marca = { id: conta.id, nome: conta.nome, logoUrl: conta.logoUrl };
    guardarMarca(marca);
    setLembrada(marca);
  }, [conta]);

  const marca = conta
    ? { id: conta.id, nome: conta.nome, logoUrl: conta.logoUrl }
    : lembrada;

  return { marca, carregando: !marca && (!montado || isLoading) };
}
