"use client";

import { fetchApi } from "@/lib/client-api";
import { limparMarca } from "@/lib/marca-conta";

/** Prefixo dos filtros de tela salvos (ver `use-data-table-state`). */
const PREFIXO_FILTROS = "ronan.table-state.";

/**
 * Joga fora tudo que este navegador lembra da empresa anterior.
 *
 * A marca é óbvia (logo e nome). Os filtros de tela não são, e são o mais
 * traiçoeiro: eles guardam FKs por id — empresa, transportadora, motorista —, e
 * um id que não existe na empresa nova faz a lista abrir vazia. Quem vê isso
 * conclui "sumiram os dados", não "o filtro é de outra empresa".
 */
function esquecerEmpresaAnterior(): void {
  limparMarca();
  if (typeof window === "undefined") return;
  try {
    const chaves = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(PREFIXO_FILTROS),
    );
    for (const chave of chaves) window.localStorage.removeItem(chave);
  } catch {
    // Navegador sem storage: não havia o que limpar.
  }
}

/**
 * Entra numa empresa (`contaId`) ou volta pra casa (`null`).
 *
 * Termina com um recarregamento de página inteiro, de propósito. Trocar de
 * empresa muda TODO o conteúdo do painel, e sobra muito estado espalhado que um
 * `queryClient.clear()` não alcança: o SSE do sininho (aberto uma vez no shell),
 * os rótulos que os combobox de FK lembram em `useRef`, os grupos abertos do
 * menu. Um `location.assign` zera tudo isso de uma vez e ainda fecha a janela de
 * corrida das requisições que já estavam no ar quando a troca aconteceu — elas
 * morrem com a página, em vez de responderem com dado da empresa anterior e
 * caírem no cache sob a mesma chave.
 *
 * É uma ação rara e deliberada; um segundo de recarga é preço barato pela
 * garantia de que nada da empresa anterior sobreviveu na tela.
 */
export async function trocarConta(token: string | undefined, contaId: string | null) {
  await fetchApi<{ contaId: string; contaNome: string; assumida: boolean }>(
    "/admin/auth/conta-ativa",
    { method: "POST", token, body: JSON.stringify({ contaId }) },
  );

  // Só depois do backend confirmar: se a troca falhar (empresa desativada, por
  // exemplo), o painel continua exatamente como estava, com os filtros dele.
  esquecerEmpresaAnterior();

  // Volta pra home porque a rota atual pode apontar pra um registro da empresa
  // anterior (`/viagens/<id>`), que na nova daria "não encontrado".
  window.location.assign("/");
}
