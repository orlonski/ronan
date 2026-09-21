/**
 * A IDENTIDADE de um documento de motorista.
 *
 * ⚠️ Por que isto existe, e por que ninguém monta essa string na mão.
 *
 * Um arquivo de motorista mora numa GAVETA (`TipoDocumentoMotorista`, lista
 * fechada de 12) e pode atender uma EXIGÊNCIA (`DocumentoExigido`, catálogo
 * livre que a operação escreve copiando o que o contratante pede). Os dois
 * conceitos são diferentes e sempre foram — o comentário do `DocumentoExigido`
 * já dizia isso —, mas a unicidade estava na gaveta.
 *
 * O estrago era invisível: um contratante que pede 18 papéis não tem 18
 * gavetas. RG, CPF, CTPS e ficha de registro caem todos em
 * `REGISTRO_MOTORISTA`. Com o único em `(motoristaId, tipo)`, os quatro
 * dividiam UMA linha e UM objeto no MinIO. O motorista mandava o RG, depois o
 * CPF, e o RG evaporava — do banco e do storage. A tela marcava os quatro como
 * recebidos, porque ela perguntava pela gaveta. Ninguém via erro nenhum, e o
 * pacote só era desmentido na portaria da obra.
 *
 * A chave carrega a regra:
 * - `exig:<id>` — o arquivo atende aquela exigência, e só ela;
 * - `gaveta:<TIPO>` — anexo avulso do painel, que é como sempre funcionou pra
 *   quem não usa o módulo de admissão.
 *
 * Mesmo molde de `AlocacaoObra.vigenteDe` e `RegimeVigente.chaveViva`: uma
 * coluna que o banco sabe cobrar, em vez de uma regra que cada service lembra
 * de aplicar.
 */

/** O documento atende uma exigência do catálogo. */
export function chaveDaExigencia(exigenciaId: string): string {
  return `exig:${exigenciaId}`;
}

/** Anexo avulso, identificado pela gaveta — o caminho do painel. */
export function chaveDaGaveta(tipo: string): string {
  return `gaveta:${tipo}`;
}

/**
 * A chave de um documento, do jeito que ele vai ser gravado.
 *
 * Passar `exigenciaId` nulo é o caso legítimo do anexo avulso, não um
 * descuido: o painel guarda CNH de motorista que não está em obra nenhuma.
 */
export function chaveDocumento(e: { exigenciaId?: string | null; tipo: string }): string {
  return e.exigenciaId ? chaveDaExigencia(e.exigenciaId) : chaveDaGaveta(e.tipo);
}

/**
 * Pedaço seguro pra compor a key do objeto no MinIO.
 *
 * A key era determinística por gaveta (`.../<motorista>/<TIPO>.<ext>`), o que
 * fazia duas exigências da mesma gaveta se sobrescreverem no storage mesmo
 * depois de o banco passar a distingui-las. Aqui o `:` vira `-` porque chave
 * de objeto com dois-pontos é legal em S3 mas atrapalha ferramenta de linha de
 * comando, e nada mais muda: a string continua legível e única.
 */
export function chaveParaStorage(chave: string): string {
  return chave.replace(/[^a-zA-Z0-9_-]/g, "-");
}
