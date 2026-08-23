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

/**
 * Repõe o token da empresa ativa quando ele falta — sem pedir senha.
 *
 * O slot pode estar vazio porque guardava o token de OUTRO cadastro e foi
 * descartado (ver `tokensDe`). Nesse estado o app fala com o servidor por
 * ninguém: sem reparo, a primeira request viraria "sessão acabou" e o motorista
 * seria deslogado por um estrago que não é dele.
 *
 * O caminho é o mesmo do cadastro aprovado depois do login: outro cadastro do
 * MESMO CPF que ainda tenha token válido pede um token pra este — falando por
 * ele, sem ativá-lo nem por um instante. Best-effort: sem internet, as requests
 * falham como transitórias e o reparo tenta de novo na próxima abertura.
 */
export async function repararSessaoAtiva(): Promise<void> {
  const ativo = motoristaAtivoId();
  if (!ativo || tokensDe(ativo)?.accessToken) return;

  for (const s of listarSessoes()) {
    if (s.motoristaId === ativo) continue;
    if (!tokensDe(s.motoristaId)?.accessToken) continue;
    try {
      guardarSessao(await api.trocarEmpresa(ativo, s.motoristaId), false);
    } catch {
      /* sem sinal ou recusado: tenta de novo na próxima abertura */
    }
    return;
  }
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
