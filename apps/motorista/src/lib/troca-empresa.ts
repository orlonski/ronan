import type { QueryClient } from "@tanstack/react-query";
import { pendentesDoCadastro, resolverPendentesSemDono } from "@/db/dexie";
import { api } from "./api";
import { setCadastroStatus } from "./cadastro-status";
import { drain } from "./sync";
import {
  ativarSessao,
  donoLegado,
  guardarSessao,
  limparDonoLegado,
  listarSessoes,
  migrarSessaoLegada,
  motoristaAtivoId,
  semSessaoLocal,
  sincronizarLista,
  tokensDe,
  type SessaoLocal,
} from "./sessoes";

/**
 * Troca a empresa pra qual o motorista está rodando agora.
 *
 * Não é só trocar o token: TUDO que a tela mostra passa a ser da outra empresa.
 * O cache em disco já é separado por cadastro (`db/dexie.ts`), mas o de memória
 * do React Query é um só e ficaria mostrando viagem da empresa anterior.
 */
export async function trocarEmpresa(qc: QueryClient, motoristaId: string): Promise<void> {
  if (motoristaAtivoId() === motoristaId) return;
  await garantirSessao(motoristaId);
  ativarSessao(motoristaId);
  // O status de aprovação é POR CADASTRO: aprovado numa empresa e em análise na
  // outra é situação normal. Sem trocar aqui, o AuthGate mostraria a tela errada.
  const nova = listarSessoes().find((s) => s.motoristaId === motoristaId);
  if (nova) setCadastroStatus(nova.status);
  qc.clear();
  // O pendente desta empresa estava parado enquanto ela não era a ativa.
  void drain().catch(() => {});
}

/**
 * Só vira a empresa ativa com token DELA guardado.
 *
 * Sem essa garantia, o app entraria na empresa nova sem conseguir falar com o
 * servidor por ela — e, no navegador onde o slot guardava o token de outro
 * cadastro (corrida antiga de renovação, ver `tokensDe`), a tela mostraria o
 * dado da empresa errada. Quando falta, pede um novo com a sessão atual, que
 * ainda é válida.
 *
 * Sem internet e sem token guardado, a troca falha — e é o certo: melhor
 * continuar na empresa de agora do que abrir uma que não responde.
 */
async function garantirSessao(motoristaId: string): Promise<void> {
  if (tokensDe(motoristaId)?.accessToken) return;
  guardarSessao(await api.trocarEmpresa(motoristaId), false);
}

/** Sessões + quantos lançamentos de cada uma estão esperando pra subir. */
export async function sessoesComPendentes(): Promise<
  Array<SessaoLocal & { pendentes: number }>
> {
  const saida: Array<SessaoLocal & { pendentes: number }> = [];
  for (const s of listarSessoes()) {
    saida.push({ ...s, pendentes: await pendentesDoCadastro(s.motoristaId) });
  }
  return saida;
}

/**
 * Boot: adota a sessão única antiga e resolve os pendentes que ficaram sem dono.
 * Ninguém é deslogado e nenhum lançamento é perdido — o que não puder ser
 * provado como dele é descartado, nunca enviado em nome de outro cadastro.
 */
export async function prepararSessoes(): Promise<void> {
  migrarSessaoLegada();
  const ativo = motoristaAtivoId();
  const dono = donoLegado();
  await resolverPendentesSemDono(dono && dono === ativo ? ativo : null);
  if (dono) limparDonoLegado();
}

/** Depois do login: mesma decisão, agora sabendo quem entrou. */
export async function resolverLegadoAposLogin(motoristaId: string): Promise<void> {
  const dono = donoLegado();
  await resolverPendentesSemDono(dono === motoristaId ? motoristaId : null);
  limparDonoLegado();
}

/**
 * Alinha a lista local com o servidor: nome da empresa, aprovação e cadastro
 * novo (ex.: aprovado numa segunda empresa depois do login). Best-effort.
 */
export async function atualizarCadastros(): Promise<void> {
  const cadastros = await api.listarCadastros();
  const locais: SessaoLocal[] = cadastros.map((c) => ({
    motoristaId: c.motoristaId,
    contaId: c.contaId,
    contaNome: c.contaNome,
    status: c.status,
  }));
  sincronizarLista(locais);

  for (const novo of semSessaoLocal(locais)) {
    try {
      guardarSessao(await api.trocarEmpresa(novo.motoristaId), false);
    } catch {
      /* sem sinal ou recusado: tenta de novo na próxima abertura */
    }
  }
}
