import { AsyncLocalStorage } from "node:async_hooks";

/**
 * De quem é o dado que está sendo lido/escrito AGORA.
 *
 * O sistema atende N empresas na mesma base. Em vez de cada service lembrar de
 * filtrar por conta — são ~810 chamadas ao Prisma em 83 services, e basta uma
 * esquecida pra uma empresa ver os dados da outra —, a conta viaja no contexto
 * da requisição e a trava em `trava-conta.ts` injeta o filtro sozinha.
 *
 * `contaId: null` NÃO significa "todas as contas": significa "ainda não sei de
 * quem é", e a trava recusa a consulta. Quem legitimamente atravessa contas
 * (login, boot, cron, fila do agente) tem que dizer isso em voz alta com
 * `comoSistema`.
 */
export type ContaStore = {
  /** Conta dona da requisição. `null` até o JwtStrategy resolver o usuário. */
  contaId: string | null;
  /**
   * `sistema` = a trava não filtra nada. É o modo do login (que procura o
   * usuário por e-mail/CPF antes de saber a conta), do boot, dos scripts e dos
   * crons que varrem contas. Todo uso é uma decisão explícita e localizada.
   */
  modo: "request" | "sistema";
};

const storage = new AsyncLocalStorage<ContaStore>();

/** O contexto atual, ou `undefined` fora de qualquer um (código de boot). */
export function contaAtual(): ContaStore | undefined {
  return storage.getStore();
}

/**
 * A conta atual, ou erro se não houver.
 *
 * Serve pros poucos lugares que precisam citar o `contaId` no código — os
 * `upsert` por chave composta (`contaId_slug`), que o Prisma exige montada à
 * mão. Em toda leitura/escrita comum quem preenche é a trava; se você está
 * chamando isto num `where` normal, provavelmente não precisa.
 */
export function contaIdAtual(): string {
  const store = storage.getStore();
  if (!store?.contaId) {
    throw new Error(
      "Nenhuma conta no contexto. Só dá pra montar chave composta por conta " +
        "dentro de comConta(...) ou de uma requisição autenticada.",
    );
  }
  return store.contaId;
}

/**
 * Abre um contexto novo pra duração de `fn`. Usado por quem roda fora de
 * requisição e sabe de qual conta se trata (cron por conta, fila, seed).
 *
 * Repare no `async () => await fn()` lá dentro: ele existe por causa de uma
 * armadilha que custou caro. As promises do Prisma são PREGUIÇOSAS — a consulta
 * só sai quando alguém dá `.then()` nela. Escrever `comConta(id, () =>
 * prisma.x.findMany())` criaria a promise dentro do contexto mas dispararia a
 * consulta FORA dele, quando o chamador fizesse `await` — e a trava veria um
 * contexto vazio. Fazendo o await aqui dentro, a consulta sai dentro do
 * contexto e nenhum chamador precisa saber disso.
 */
export async function comConta<T>(contaId: string, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ contaId, modo: "request" }, async () => await fn());
}

/**
 * Abre o contexto AINDA VAZIO, pro middleware. Até o `JwtStrategy` chamar
 * `definirConta`, toda consulta a dado de negócio é recusada pela trava.
 */
export function abrirContexto<T>(fn: () => T): T {
  return storage.run({ contaId: null, modo: "request" }, fn);
}

/**
 * Roda `fn` sem filtro de conta. Use com parcimônia e só onde atravessar contas
 * é o comportamento correto:
 *
 * - login (acha o usuário por e-mail/CPF, que é justamente o que revela a conta)
 * - `JwtStrategy` (a consulta que descobre a conta não pode depender dela)
 * - seed de permissões no boot, scripts de linha de comando
 * - `agente-main.ts`, que é outro processo e roda a fila da plataforma
 * - cron que precisa listar as contas ativas pra depois rodar em cada uma
 *
 * Não use pra "resolver" um erro de trava: se a trava reclamou dentro de uma
 * requisição, o certo quase sempre é o contexto estar faltando, não o filtro
 * sobrando.
 *
 * Faz o `await` internamente pelo mesmo motivo que `comConta` — ver o comentário
 * lá sobre as promises preguiçosas do Prisma.
 */
export async function comoSistema<T>(fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ contaId: null, modo: "sistema" }, async () => await fn());
}

/**
 * Preenche a conta do contexto que o middleware abriu vazio. Chamado pelo
 * `JwtStrategy` assim que o usuário (admin ou motorista) é resolvido.
 *
 * Silencioso fora de contexto: rota pública sem usuário não tem o que definir.
 */
export function definirConta(contaId: string): void {
  const store = storage.getStore();
  if (!store) return;
  store.contaId = contaId;
  store.modo = "request";
}
