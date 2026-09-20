import { ConflictException } from "@nestjs/common";
import { Prisma, type RegimeTrabalho } from "@prisma/client";

/**
 * A TRAVA ENTRE OS DOIS MUNDOS: parceiro autônomo e empregado registrado.
 *
 * ⚠️ Este é o ÚNICO arquivo que os módulos `mensal` e `ponto` compartilham, e
 * é de propósito. Vocabulário neutro pra passar nos filtros de léxico dos
 * dois lados: aqui não se diz "diária" nem "jornada".
 *
 * O problema que ele resolve: o mensal paga por DIÁRIA a parceiro autônomo, e
 * o ponto controla JORNADA de empregado. A mesma pessoa nos dois, na mesma
 * empresa, no mesmo período, é o desenho dos elementos de vínculo dentro do
 * produto — e a conta cai na transportadora, não na gente. Documentação não
 * impede isso; constraint impede.
 *
 * ⚠️ Chaveado por CPF, não por id de cadastro: é o que o token do app carrega,
 * e é a chave que um perito usa. A mesma pessoa pode ter dois cadastros com
 * ids diferentes; ela não tem dois CPFs.
 *
 * ⚠️ `chaveViva` é o molde literal do `AlocacaoObra.vigenteDe`: vale o CPF
 * enquanto o regime está vivo e NULL depois. No Postgres dois NULLs não
 * colidem, então o banco garante UM regime vivo por pessoa sem proibir o
 * histórico — que `@@unique([contaId, cpf])` proibiria junto.
 *
 * ⚠️ E a armadilha que faria tudo isto nascer decorativo: a promise do Prisma
 * é PREGUIÇOSA e a trava multi-tenant vive num AsyncLocalStorage. O `await`
 * destas funções tem que acontecer DENTRO do `run` da conta — devolver a
 * promise pra fora carimba `__SEM_CONTA__` em silêncio, a unique nunca
 * dispara, e ninguém descobre até aparecer o primeiro processo.
 */

type Tx = Prisma.TransactionClient;

export function soDigitos(cpf: string): string {
  return (cpf ?? "").replace(/\D/g, "");
}

const NOME_REGIME: Record<RegimeTrabalho, string> = {
  PARCEIRO: "contrato de parceiro autônomo",
  EMPREGADO: "vínculo de emprego registrado",
};

/**
 * O 409 de quem tentou abrir o segundo regime.
 *
 * Diz QUAL regime já existe porque "não pode" sozinho manda a pessoa adivinhar
 * — e o caminho de saída (encerrar o anterior) só é óbvio se ela souber o que
 * encerrar.
 */
export function erroRegimeConflitante(vivo: RegimeTrabalho): ConflictException {
  return new ConflictException(
    `Este CPF já tem ${NOME_REGIME[vivo]} ativo nesta empresa. ` +
      `Encerre o anterior antes de continuar: a mesma pessoa não pode estar nas duas situações no mesmo período.`,
  );
}

/** O regime vivo desta pessoa nesta empresa, se houver. */
export async function regimeVivo(
  tx: Tx,
  cpf: string,
): Promise<{ id: string; regime: RegimeTrabalho } | null> {
  const chave = soDigitos(cpf);
  if (chave.length !== 11) return null;
  const r = await tx.regimeVigente.findFirst({
    where: { chaveViva: chave },
    select: { id: true, regime: true },
  });
  return r;
}

/**
 * Abre o regime. Lança 409 se já houver outro vivo pra este CPF.
 *
 * Idempotente pro MESMO regime: abrir "parceiro" duas vezes não é erro — a
 * segunda alocação da mesma pessoa é um caso legítimo do mensal, e é o índice
 * de lá que decide se ela pode.
 */
export async function abrirRegime(
  tx: Tx,
  e: { cpf: string; regime: RegimeTrabalho; inicio: Date; criadoPorId?: string | null },
): Promise<void> {
  const chave = soDigitos(e.cpf);
  // Cadastro sem CPF não entra na trava. Recusar aqui quebraria o mensal, que
  // já aceita motorista sem CPF — e a trava é sobre pessoa identificada.
  if (chave.length !== 11) return;

  const vivo = await regimeVivo(tx, chave);
  if (vivo) {
    if (vivo.regime === e.regime) return;
    throw erroRegimeConflitante(vivo.regime);
  }

  try {
    await tx.regimeVigente.create({
      data: {
        cpf: chave,
        regime: e.regime,
        iniciouEm: e.inicio,
        chaveViva: chave,
        criadoPorId: e.criadoPorId ?? null,
      },
    });
  } catch (err) {
    // Corrida: dois cadastros simultâneos do mesmo CPF. A constraint é a
    // autoridade, não o findFirst acima.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const agora = await regimeVivo(tx, chave);
      throw erroRegimeConflitante(agora?.regime ?? e.regime);
    }
    throw err;
  }
}

/**
 * Encerra o regime vivo. Não apaga: limpa a `chaveViva` e carimba a data.
 *
 * O histórico fica porque é ele que responde "essa pessoa foi parceira até
 * quando?" — pergunta que aparece exatamente quando alguém está discutindo
 * vínculo.
 */
export async function encerrarRegime(
  tx: Tx,
  e: { cpf: string; motivo: string },
): Promise<void> {
  const chave = soDigitos(e.cpf);
  if (chave.length !== 11) return;
  await tx.regimeVigente.updateMany({
    where: { chaveViva: chave },
    data: { chaveViva: null, encerradoEm: new Date(), motivo: e.motivo },
  });
}
