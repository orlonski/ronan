import { ConflictException } from "@nestjs/common";

/**
 * O lançamento chegou apontando pra um cadastro que não existe mais.
 *
 * Acontece o tempo todo num app offline-first: o catálogo do celular é cópia
 * do que o servidor tinha na última sincronização, e o escritório continua
 * mexendo nos cadastros. Placa removida do motorista, material recém-criado
 * que foi excluído, cliente apagado — o id fica vivo no celular e morto aqui.
 *
 * Sem esta validação a FK estoura no Prisma (P2003) e o
 * `PrismaExceptionFilter` traduz pra uma frase única e genérica ("um dos itens
 * escolhidos não existe mais"), que serve pra qualquer campo e por isso não
 * ajuda ninguém: o motorista não descobre SE foi a placa ou o material, nem
 * QUE o caminho é editar o lançamento. Ele lê "tente de novo", tenta, falha, e
 * acaba em Excluir — perdendo a viagem. Dizer qual cadastro sumiu é o que
 * separa "dá pra consertar em 10 segundos" de "perdi o lançamento".
 *
 * 409 e não 400 de propósito: o payload do motorista está bem formado, o que
 * mudou foi o estado do servidor. Segue o precedente do abastecimento e do
 * auto-recovery de local. Pro app dá no mesmo (4xx = permanente, vai pra
 * pendentes com o texto), mas o log fica honesto.
 */

/** Campos de lançamento que apontam pra cadastro editável no painel. */
export type CampoCadastro =
  | "veiculoId"
  | "materialId"
  | "clienteId"
  | "empresaId"
  | "localId"
  | "viagemId"
  | "tipoServicoId";

/**
 * Texto padrão por campo. Fala o cadastro pelo nome que o motorista usa
 * ("placa", não "veículo"; "cliente", não "FK") e termina no que resolve.
 */
const MENSAGEM: Record<CampoCadastro, string> = {
  veiculoId:
    "A placa desse lançamento não está mais cadastrada. Toque em Editar e escolha outra placa.",
  materialId:
    "O material desse lançamento não existe mais. Toque em Editar e escolha outro material.",
  clienteId:
    "O cliente desse lançamento não existe mais. Toque em Editar e escolha outro cliente.",
  empresaId:
    "A empresa desse lançamento não existe mais. Toque em Editar e escolha outra empresa.",
  localId:
    "Um dos locais desse lançamento não existe mais. Toque em Editar e escolha outro local.",
  viagemId:
    "A viagem ligada a esse lançamento não está mais no servidor. Toque em Editar pra desvincular.",
  tipoServicoId:
    "O tipo de serviço desse lançamento não existe mais. Toque em Editar e escolha outro.",
};

export class ItemInexistenteException extends ConflictException {
  constructor(campo: CampoCadastro, detalhe?: string) {
    // `code` deixa o app reagir sem depender do texto; `campo` diz qual input
    // destacar na hora de editar. O `message` é o que aparece pro motorista
    // mesmo no app antigo, que só sabe mostrar `body.message`.
    super({ code: "ITEM_INEXISTENTE", campo, message: detalhe ?? MENSAGEM[campo] });
  }
}

/**
 * Confere que o cadastro existe antes de gravar, e reclama dizendo QUAL sumiu.
 *
 * Recebe a busca pronta (e não o id + delegate) porque cada chamada filtra do
 * seu jeito — id, id + ativo, lista de ids — e porque assim a consulta continua
 * passando pela trava de conta normalmente.
 */
export async function garantirCadastro(
  buscar: () => Promise<unknown | null | undefined>,
  campo: CampoCadastro,
  detalhe?: string,
): Promise<void> {
  const achado = await buscar();
  if (!achado) throw new ItemInexistenteException(campo, detalhe);
}
