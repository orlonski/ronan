import { z } from "zod";

/**
 * Documentos que a empresa pede (admissão / coleta por link).
 *
 * Morava em `mensal.ts` junto com obra e diária; a obra saiu do sistema
 * (22/09/2026) e os documentos ficaram — ponto e registrados usam.
 */

/**
 * Uma exigência do contratante.
 *
 * `titulo` é texto livre de propósito: o sistema NÃO nomeia o documento. Quem
 * escreve é a operação, copiando o que o contratante pede. Chumbar nomes como
 * "NR" ou "ordem de serviço" faria a plataforma parecer emissora de documento
 * de segurança do trabalho — obrigação de empregador, e estes motoristas são
 * parceiros autônomos.
 */
export const CriarDocumentoExigidoInput = z.object({
  titulo: z.string().trim().min(2, "Diga como o contratante chama esse papel."),
  /**
   * Uma linha explicando o papel na língua do motorista.
   *
   * O app mostra isso embaixo do título. Sem ela, "certidão de estado civil" é
   * uma parede pra quem tem dificuldade de leitura — e o app NÃO pode inventar
   * a explicação, porque inventar nome de documento é exatamente o que o
   * título livre existe pra evitar.
   */
  ajuda: z.string().trim().max(200).optional(),
  /** Em que gaveta o arquivo cai (um `TipoDocumentoMotorista`). */
  tipo: z.string().trim().min(1, "Escolha a gaveta do arquivo."),
  /** Vazio = exigência da transportadora inteira, valendo pra qualquer obra. */
  empresaId: z.string().uuid().optional(),
  /**
   * DE QUEM se cobra este papel.
   *
   * `MENSAL` (padrão, nome histórico) = só de quem tem regime vigente na
   * empresa. `TODOS` = de toda a frota. O padrão é o silêncio: exigência que
   * nasce valendo pra todo mundo faz o motorista de frete comum abrir o app
   * com uma papelada que não é dele.
   */
  // `REGISTRADOS` = de quem é registrado em carteira (tenha ou não cadastro de
  // motorista); o arquivo mora no cadastro de funcionário.
  publico: z.enum(["MENSAL", "TODOS", "REGISTRADOS"]).default("MENSAL"),
  obrigatorio: z.boolean().default(true),
  ordem: z.number().int().min(0).default(0),
  /**
   * COMO este papel é assinado.
   *
   * ⚠️ Três estados, não dois booleanos. O par antigo não conseguia expressar
   * o caso mais comum da operação: o motorista assina NO PAPEL, reconhece
   * firma em cartório e devolve uma foto. Marcar "exige certificado" fazia o
   * sistema recusar essa foto; não marcar aceitava o contrato em branco.
   */
  comoAssinar: z.enum(["NAO", "NO_APP", "JA_ASSINADO"]).default("NAO"),
  /** Mantido por compatibilidade: `comoAssinar` é quem manda. */
  exigeAssinatura: z.boolean().default(false),
  /**
   * E a assinatura precisa ser ICP-Brasil?
   *
   * Configurável porque os contratantes divergem: alguns aceitam aceite
   * eletrônico com trilha de auditoria, outros só certificado digital. Chumbar
   * um dos dois no código deixaria metade dos clientes fora.
   */
  exigeIcpBrasil: z.boolean().default(false),
});
export type CriarDocumentoExigidoInput = z.infer<typeof CriarDocumentoExigidoInput>;

/**
 * Editar uma exigência que já existe.
 *
 * A GAVETA (`tipo`) fica de fora: mudá-la moveria o arquivo de lugar no
 * storage, e isso é criar outro documento, não editar este.
 */
export const EditarDocumentoExigidoInput = CriarDocumentoExigidoInput.omit({ tipo: true });
export type EditarDocumentoExigidoInput = z.infer<typeof EditarDocumentoExigidoInput>;

/**
 * O aceite eletrônico de um documento, na página pública de coleta.
 *
 * Nome e CPF são DIGITADOS por quem assina, não puxados do cadastro: o valor
 * probatório está em a pessoa declarar quem é, e o CPF conferir com o do
 * motorista é o que impede o dono do caminhão assinar no lugar dele.
 */
export const AssinarDocumentoInput = z.object({
  /**
   * QUAL papel está sendo assinado.
   *
   * ⚠️ `exigenciaId` é o caminho certo. O `tipo` (a gaveta) só identificava o
   * documento enquanto cada gaveta tinha um dono; com duas exigências caindo
   * na mesma (contrato de experiência e ficha de registro em
   * `REGISTRO_MOTORISTA`), assinar uma carimbava a outra — e a trilha inteira,
   * com nome, CPF e hash, passava a apontar pro papel errado. Segue aceito
   * enquanto for inequívoco, pra não quebrar página já aberta.
   */
  exigenciaId: z.string().uuid().optional(),
  tipo: z.string().trim().min(1).optional(),
  nome: z.string().trim().min(5, "Escreva seu nome completo."),
  cpf: z.string().trim().min(11, "Informe o CPF de quem está assinando."),
  /** O aceite tem que ser um ato: caixa desmarcada não assina nada. */
  aceito: z.literal(true, {
    errorMap: () => ({ message: "Marque que você leu e concorda para assinar." }),
  }),
});
export type AssinarDocumentoInput = z.infer<typeof AssinarDocumentoInput>;

/**
 * O aceite eletrônico DENTRO DO APP.
 *
 * Não tem `tipo` nem `exigenciaId`: o documento vem na rota, e quem assina vem
 * do token. O nome também não é digitado — no link ele é a única prova de que
 * alguém declarou ser quem é, mas no app a sessão já provou, e 25 letras num
 * teclado de celular dentro de um caminhão é a parede que faz a pessoa
 * desistir. O CPF continua sendo digitado: são 11 números que ele sabe de cor,
 * e é o que sobra do ato de declarar "sou eu".
 */
export const AssinarDocumentoAppInput = z.object({
  nome: z.string().trim().min(5),
  cpf: z.string().trim().min(11, "Confirme seu CPF para assinar."),
  /** O aceite tem que ser um ato. */
  aceito: z.literal(true, {
    errorMap: () => ({ message: "Confirme que você leu e concorda." }),
  }),
});
export type AssinarDocumentoAppInput = z.infer<typeof AssinarDocumentoAppInput>;

/**
 * O escritório devolvendo um documento.
 *
 * O motivo é OBRIGATÓRIO e vai inteiro pro app do motorista, no próprio item:
 * "mande de novo" sem dizer o que houve faz a pessoa repetir o mesmo erro — e,
 * no caso dela, dirigir de novo até o escritório pra descobrir.
 */
export const RecusarDocumentoInput = z.object({
  motivo: z
    .string()
    .trim()
    .min(3, "Escreva o que houve com o documento — é isso que ele vai ler no app."),
});
export type RecusarDocumentoInput = z.infer<typeof RecusarDocumentoInput>;
