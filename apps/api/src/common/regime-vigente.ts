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
  e: {
    cpf: string;
    motivo: string;
    /**
     * ⚠️ QUAL regime quem chama acha que está encerrando.
     *
     * Sem isto, encerrar é cego: quem desliga um funcionário solta a chave de
     * QUALQUER regime vivo daquele CPF — inclusive um contrato de PARCEIRO que
     * outro módulo abriu. Acontecia com funcionário legado (sem regime) que
     * depois ganhou alocação de obra: desligar o funcionário apagava o regime
     * de parceiro em silêncio, e ninguém tinha como descobrir, porque o
     * histórico fica carimbado com o motivo do desligamento.
     *
     * Vai no WHERE, não num `if` antes: o banco decide, então duas chamadas
     * simultâneas não conseguem encerrar o regime uma da outra.
     */
    regime?: RegimeTrabalho;
  },
): Promise<void> {
  const chave = soDigitos(e.cpf);
  if (chave.length !== 11) return;
  await tx.regimeVigente.updateMany({
    where: { chaveViva: chave, ...(e.regime ? { regime: e.regime } : {}) },
    data: { chaveViva: null, encerradoEm: new Date(), motivo: e.motivo },
  });
}

/**
 * A PERGUNTA ÚNICA: como esta pessoa é paga nesta empresa?
 *
 * ⚠️ Existe porque três critérios diferentes respondiam isso: esta tabela, a
 * existência de cadastro de funcionário ativo (o que o token olha) e a cópia
 * congelada em `AlocacaoObra.regime`. Três respostas pra uma pergunta é como
 * quatro furos conviveram sem ninguém ver — cada ponto perguntava pra um
 * lugar diferente e todos pareciam certos isolados.
 *
 * ⚠️ E o que ela NÃO responde: qual cadastro a pessoa tem. Motorista CLT da
 * própria transportadora tem os DOIS cadastros de propósito (lança viagem e
 * bate ponto no mesmo dia) — a exclusividade daqui é sobre PAGAMENTO, entre
 * obra/diária e folha. Confundir as duas coisas já trancou a porta do caso
 * mais comum de quem compra o módulo.
 *
 * `null` é resposta legítima e é a mais comum: motorista de frete comum nunca
 * teve regime declarado, porque a linha só nasce com alocação de obra ou
 * contratação. "Não sei" é melhor que chutar "parceiro" — o painel mostra a
 * diferença, e é ela que faz alguém declarar.
 */
export async function regimeDe(
  tx: Tx,
  cpf: string,
): Promise<{ regime: RegimeTrabalho; desde: Date } | null> {
  const chave = soDigitos(cpf);
  if (chave.length !== 11) return null;
  const r = await tx.regimeVigente.findFirst({
    where: { chaveViva: chave },
    select: { regime: true, iniciouEm: true },
  });
  return r ? { regime: r.regime, desde: r.iniciouEm } : null;
}

/**
 * Este CPF tem vínculo de emprego registrado vivo nesta empresa?
 *
 * ⚠️ Existe pra quem precisa RECUSAR antes de criar, e não tem regime próprio
 * pra abrir. O caso que a motivou: cadastrar um motorista parceiro com o CPF
 * de um funcionário registrado não passava por checagem nenhuma — a trava só
 * dispara quando alguém ABRE um regime, e o cadastro de motorista nunca abriu.
 */
export async function temVinculoDeEmprego(tx: Tx, cpf: string): Promise<boolean> {
  const vivo = await regimeVivo(tx, cpf);
  return vivo?.regime === "EMPREGADO";
}

/**
 * Os períodos em que este CPF esteve (ou está) registrado como empregado.
 *
 * ⚠️ Serve a quem paga: pagamento por produção — viagem, tonelada, km — não
 * pode alcançar dia em que a pessoa era empregada, e a pergunta certa é por
 * DATA, não "o que ela é hoje". Quem foi parceiro até março e foi registrado
 * em abril tem direito ao acerto de março, e não pode ter o de maio.
 *
 * `encerradoEm` nulo = ainda vigente, janela aberta à direita.
 */
export async function periodosDeEmprego(
  tx: Tx,
  cpf: string,
): Promise<{ inicio: Date; fim: Date | null }[]> {
  const chave = soDigitos(cpf);
  if (chave.length !== 11) return [];
  const linhas = await tx.regimeVigente.findMany({
    where: { cpf: chave, regime: "EMPREGADO" },
    select: { iniciouEm: true, encerradoEm: true },
  });
  return linhas.map((l) => ({ inicio: l.iniciouEm, fim: l.encerradoEm }));
}

/** A data cai dentro de algum período de emprego? */
export function dentroDeEmprego(
  periodos: { inicio: Date; fim: Date | null }[],
  data: Date,
): boolean {
  const t = data.getTime();
  return periodos.some(
    (p) => t >= p.inicio.getTime() && (p.fim === null || t <= p.fim.getTime()),
  );
}
