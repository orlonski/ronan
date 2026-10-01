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
  tokensDe,
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

  await garantirSessao(motoristaId);
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

/**
 * Só vira a empresa ativa com token DELA guardado.
 *
 * Sem essa garantia, o app entraria na empresa nova sem conseguir falar com o
 * servidor por ela — e, pior, no aparelho onde o slot guardava o token de outro
 * cadastro (corrida antiga de renovação, ver `tokensDe`), a tela mostraria o
 * dado da empresa errada. Quando falta, pede um novo com a sessão atual, que
 * ainda é válida: é o mesmo caminho do cadastro aprovado depois do login.
 *
 * Sem internet e sem token guardado, a troca falha — e é o certo: melhor
 * continuar na empresa de agora do que abrir uma que não responde.
 */
async function garantirSessao(motoristaId: string): Promise<void> {
  const guardado = await tokensDe(motoristaId).catch(() => null);
  if (guardado?.accessToken) return;
  const sessao = await api.trocarEmpresa(motoristaId);
  await guardarSessao(sessao, false);
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
 * MESMO CPF que ainda tenha token válido pede um token pra este. Roda no boot,
 * antes de qualquer tela, e é best-effort — sem internet, as requests falham
 * como transitórias (`SessaoIndisponivelError`) e o reparo tenta de novo depois.
 */
export async function repararSessaoAtiva(): Promise<void> {
  const ativo = await motoristaAtivoId();
  if (!ativo) return;
  if ((await tokensDe(ativo).catch(() => null))?.accessToken) return;

  for (const s of await listarSessoes()) {
    if (s.motoristaId === ativo) continue;
    if (!(await tokensDe(s.motoristaId).catch(() => null))?.accessToken) continue;
    try {
      // Pede o token DESTA empresa falando pelo cadastro são, sem ativá-lo nem
      // por um instante: nada na tela chega a ver a empresa emprestada.
      await guardarSessao(await api.trocarEmpresa(ativo, s.motoristaId), false);
    } catch {
      /* sem sinal ou recusado: tenta de novo na próxima abertura */
    }
    return;
  }
}

/**
 * O toque num push de OUTRA empresa entra nela antes de abrir a tela.
 *
 * O push chega em todos os aparelhos da pessoa, com qualquer empresa ativa
 * (decisão de 01/10/2026). Sem esta troca, tocar no aviso da empresa B com a A
 * aberta levava pra uma tela que a sessão da A não enxerga — viagem 404, lista
 * vazia — e parecia que o aviso era mentira.
 *
 * ⚠️ Com viagem guiada ABERTA na empresa atual, NÃO troca: rastreio e eventos
 * estão amarrados à sessão que abriu a viagem, e trocar no meio a deixaria pela
 * metade. É o mesmo cuidado do seletor de empresa, só que aqui não há tela
 * pra ele confirmar — então quem decide é ele, depois, pelo seletor.
 */
export async function entrarNaEmpresaDoAviso(
  qc: QueryClient,
  paraCadastro: string | null,
): Promise<
  | { r: "mesma" }
  | { r: "trocou"; contaNome: string }
  | { r: "viagem-aberta"; contaNome: string }
  | { r: "falhou"; contaNome: string }
> {
  if (!paraCadastro || (await motoristaAtivoId()) === paraCadastro) return { r: "mesma" };
  const destino = (await listarSessoes()).find((s) => s.motoristaId === paraCadastro);
  // Aviso de cadastro que este aparelho não conhece (outra pessoa usou o
  // celular, cadastro excluído): fica onde está.
  if (!destino) return { r: "mesma" };
  const contaNome = destino.contaNome || "outra empresa";
  if ((await avaliarTroca()).viagemAberta) return { r: "viagem-aberta", contaNome };
  try {
    await trocarEmpresa(qc, paraCadastro);
    return { r: "trocou", contaNome };
  } catch {
    return { r: "falhou", contaNome };
  }
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
