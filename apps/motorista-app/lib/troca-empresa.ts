import type { QueryClient } from "@tanstack/react-query";
import { pendentesDoCadastro } from "@/db/database";
import { api } from "./api";
import { setCadastroStatus } from "./cadastro-status";
import { getLifecycleLocal } from "./lifecycle";
import { obterEEnviarPushToken } from "./notifications";
import { prefetchDadosBase } from "./queries";
import {
  ativarSessao,
  guardarSessao,
  listarSessoes,
  motoristaAtivoId,
  semSessaoLocal,
  sincronizarLista,
  type SessaoLocal,
} from "./sessoes";
import { drain } from "./sync";

/**
 * Troca a empresa pra qual o motorista está rodando agora.
 *
 * Não é só trocar o token: TUDO que a tela mostra passa a ser da outra empresa.
 * Por isso o cache em memória do React Query é zerado — o cache em disco já é
 * separado por cadastro (`db/database.ts`), mas o de memória é um só e ficaria
 * mostrando viagem da empresa anterior até revalidar.
 */
export async function trocarEmpresa(qc: QueryClient, motoristaId: string): Promise<void> {
  if ((await motoristaAtivoId()) === motoristaId) return;

  await ativarSessao(motoristaId);
  // O status de aprovação é POR CADASTRO: aprovado numa empresa e em análise na
  // outra é situação normal. Sem trocar aqui, o AuthGate mostraria a tela errada.
  const nova = (await listarSessoes()).find((s) => s.motoristaId === motoristaId);
  if (nova) setCadastroStatus(nova.status);
  qc.clear();

  // Push é por APARELHO: reregistrar aqui é o que tira o token do cadastro
  // anterior e faz o aviso da outra empresa parar de chegar durante este turno.
  void obterEEnviarPushToken().catch(() => {});
  void prefetchDadosBase(qc).catch(() => {});
  // O pendente desta empresa estava parado enquanto ela não era a ativa.
  void drain().catch(() => {});
}

/** O que ele perde de vista ao sair desta empresa agora. */
export type AvisoTroca = {
  /** Viagem guiada aberta (iniciada e não finalizada) na empresa atual. */
  viagemAberta: boolean;
  /** Lançamentos ainda não enviados da empresa atual. */
  pendentes: number;
};

/**
 * O que avisar ANTES de trocar. Viagem em andamento é o caso sério: o
 * rastreamento e os eventos estão amarrados à sessão que a abriu, e trocar no
 * meio deixa a viagem pela metade.
 */
export async function avaliarTroca(): Promise<AvisoTroca> {
  const atual = await motoristaAtivoId();
  const [lifecycle, pendentes] = await Promise.all([
    getLifecycleLocal().catch(() => null),
    atual ? pendentesDoCadastro(atual) : Promise.resolve(0),
  ]);
  return { viagemAberta: !!lifecycle, pendentes };
}

/** Sessões + quantos lançamentos de cada uma estão esperando pra subir. */
export async function sessoesComPendentes(): Promise<
  Array<SessaoLocal & { pendentes: number }>
> {
  const lista = await listarSessoes();
  const saida: Array<SessaoLocal & { pendentes: number }> = [];
  for (const s of lista) {
    saida.push({ ...s, pendentes: await pendentesDoCadastro(s.motoristaId) });
  }
  return saida;
}

/**
 * Alinha a lista local com o servidor: nome da empresa, aprovação saindo de
 * "em análise" e cadastro novo (ex.: ele se cadastrou numa segunda empresa e foi
 * aprovado depois do login). Best-effort — offline, fica como está.
 */
export async function atualizarCadastros(): Promise<void> {
  const cadastros = await api.listarCadastros();
  const locais: SessaoLocal[] = cadastros.map((c) => ({
    motoristaId: c.motoristaId,
    contaId: c.contaId,
    contaNome: c.contaNome,
    status: c.status,
  }));
  await sincronizarLista(locais);

  // Cadastro que o servidor conhece mas que ainda não tem token aqui: pega um
  // pelo endpoint de troca (sem senha, mesmo CPF) e guarda sem ativar.
  for (const novo of await semSessaoLocal(locais)) {
    try {
      const sessao = await api.trocarEmpresa(novo.motoristaId);
      await guardarSessao(sessao, false);
    } catch {
      /* sem sinal ou recusado: tenta de novo na próxima abertura */
    }
  }
}
