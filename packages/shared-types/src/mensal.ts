import { z } from "zod";

/**
 * O MENSAL: o caminhão fica à disposição de uma obra e se paga por DIÁRIA.
 *
 * Não confundir com o frete, que é pago por viagem, tonelada ou km. Aqui o
 * contrato compra o DIA do caminhão, e a pergunta do mês inteiro é uma só:
 * em quantos dias ele esteve lá.
 *
 * ⚠️ LÉXICO TRAVADO. Não existe ponto, jornada, falta, atraso, escala nem
 * expediente — nem em nome de campo, nem em rótulo de tela. O motorista é
 * PARCEIRO AUTÔNOMO, e o que se registra é a PRESENÇA DO CAMINHÃO NA OBRA num
 * dia, que é fato do contrato de transporte. Somar controle de jornada a
 * pagamento por diária, habitualidade e documento de NR é desenhar os
 * elementos do vínculo empregatício dentro do produto — e quem paga essa conta
 * é a transportadora, não nós.
 *
 * Pelo mesmo motivo não existe horário esperado em lugar nenhum: sem
 * horário-alvo não há atraso, sem atraso não há descumprimento, sem
 * descumprimento não há subordinação.
 */

/** Um dia, do jeito que o app e o painel falam: "2026-09-19". */
const Dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

/**
 * Quem marcou a presença. O escritório precisa distinguir: o registro do
 * motorista é a prova que vale contra a medição do contratante; o lançamento
 * do painel é correção, e correção exige motivo.
 */
export const ORIGENS_PRESENCA = ["APP", "PAINEL"] as const;
export const OrigemPresencaSchema = z.enum(ORIGENS_PRESENCA);
export type OrigemPresenca = z.infer<typeof OrigemPresencaSchema>;

export const ROTULO_ORIGEM_PRESENCA: Record<OrigemPresenca, string> = {
  APP: "Marcado pelo motorista",
  PAINEL: "Lançado no painel",
};

/**
 * Criar a alocação: é ela que permite o app não perguntar nada.
 *
 * Obra, veículo, contratante e valor ficam decididos aqui, então a tela do
 * motorista tem um botão e mais nada. Toda pergunta que o cadastro não
 * responder vira uma pergunta na tela dele — e é exatamente isso que este
 * público não consegue atravessar.
 */
export const CriarAlocacaoInput = z.object({
  /** A OBRA. É um Cliente — ele já carrega contratante, locais e preço. */
  clienteId: z.string().uuid("Diga em qual obra."),
  motoristaId: z.string().uuid("Diga qual motorista."),
  veiculoId: z.string().uuid("Diga qual caminhão."),
  inicio: Dia,
  /** Vazio = vigente sem data de término marcada. */
  fim: Dia.optional(),
  /**
   * A diária DESTA alocação, quando difere da régua da modalidade.
   *
   * Terceiro degrau de uma escada que já existe, e pelo mesmo motivo dos
   * outros dois: o mesmo motorista em duas obras tem duas diárias, e sem isto
   * o acerto nasce errado. Override é tudo-ou-nada, nunca campo a campo.
   */
  valorDiariaCentavos: z.number().int().min(0).optional(),
});
export type CriarAlocacaoInput = z.infer<typeof CriarAlocacaoInput>;

export const EditarAlocacaoInput = z.object({
  fim: Dia.optional(),
  valorDiariaCentavos: z.number().int().min(0).optional(),
});
export type EditarAlocacaoInput = z.infer<typeof EditarAlocacaoInput>;

/**
 * Encerrar exige motivo pelo mesmo princípio da alteração de km: o escritório
 * pode, mas fica escrito quem fez e por quê. Encerrar não apaga — os dias
 * registrados apontam pra alocação e o espelho de um mês fechado tem que
 * continuar legível daqui a um ano.
 */
export const EncerrarAlocacaoInput = z.object({
  motivo: z.string().trim().min(3, "Diga por que está encerrando."),
});
export type EncerrarAlocacaoInput = z.infer<typeof EncerrarAlocacaoInput>;

/**
 * O toque. É o corpo mais curto do sistema, e isso é o projeto inteiro.
 *
 * Note o que NÃO vem aqui: obra, veículo, tipo de serviço, material, km,
 * local, hora. Tudo isso o servidor deriva da alocação. Se um dia alguém
 * precisar acrescentar um campo neste schema, a pergunta certa é se dá pra
 * derivar — porque campo aqui vira pergunta na tela dele.
 */
export const RegistrarPresencaInput = z.object({
  /**
   * O dia, resolvido NO APARELHO no instante do toque.
   *
   * Não é o servidor que decide: o outbox pode drenar horas depois, e um toque
   * às 23h50 que sobe 00h10 continua sendo o dia de ontem. A fronteira do dia
   * é a de São Paulo, nunca a do relógio do container (que roda em UTC).
   */
  data: Dia,
  /**
   * Chave determinística do outbox: `alocacao|data|CHEGADA`, sempre igual.
   *
   * Uuid novo a cada tentativa faria cinco toques com 4G ruim virarem cinco
   * dias. Com chave fixa, o aparelho deduplica e o banco deduplica.
   */
  clientId: z.string().trim().min(1).max(200),
  /**
   * Onde ele estava, se o aparelho soube dizer. É EVIDÊNCIA, nunca porteiro:
   * ausência de GPS não recusa o registro, e coordenada longe da obra não
   * acusa ninguém — no máximo marca pra conferência humana. Obra tem sinal
   * ruim, e recusar por isso puniria o motorista por um problema que não é
   * dele.
   */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  precisao: z.number().min(0).optional(),
});
export type RegistrarPresencaInput = z.infer<typeof RegistrarPresencaInput>;

/**
 * O escritório lançando no lugar do motorista. Exige motivo escrito porque é
 * exceção, e porque a prova que vale contra a medição do contratante é a que
 * veio do aparelho dele — confundir as duas é perder a discussão do dia 20.
 */
export const LancarPresencaPainelInput = z.object({
  alocacaoId: z.string().uuid(),
  data: Dia,
  motivo: z.string().trim().min(3, "Diga por que está lançando por ele."),
});
export type LancarPresencaPainelInput = z.infer<typeof LancarPresencaPainelInput>;

/** Apagar um dia lançado errado. Também exige motivo, e também fica auditado. */
export const RemoverPresencaInput = z.object({
  motivo: z.string().trim().min(3, "Diga por que está removendo o dia."),
});
export type RemoverPresencaInput = z.infer<typeof RemoverPresencaInput>;

/**
 * O combinado com UM contratante. Vários contratantes, vários combinados —
 * por isso é configuração e não constante.
 */
export const ConfigMensalInput = z.object({
  /** O dia em que a medição chega e a competência fecha. */
  diaCorte: z
    .number()
    .int()
    .min(1, "O corte cai entre os dias 1 e 31.")
    .max(31, "O corte cai entre os dias 1 e 31."),
  /**
   * Quais dias da semana o contrato espera o caminhão na obra (0 = domingo).
   *
   * É isto que transforma "o mês tem 30 dias" em "eram 26 diárias". Lista
   * vazia seria um contrato que não espera o caminhão em dia nenhum — o que
   * zeraria a divergência e faria o espelho sempre concordar com qualquer
   * medição.
   */
  diasEsperadosSemana: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Escolha pelo menos um dia da semana.")
    .max(7),
});
export type ConfigMensalInput = z.infer<typeof ConfigMensalInput>;

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
  /** Em que gaveta o arquivo cai (um `TipoDocumentoMotorista`). */
  tipo: z.string().trim().min(1, "Escolha a gaveta do arquivo."),
  /** Vazio = exigência da transportadora inteira, valendo pra qualquer obra. */
  empresaId: z.string().uuid().optional(),
  obrigatorio: z.boolean().default(true),
  ordem: z.number().int().min(0).default(0),
});
export type CriarDocumentoExigidoInput = z.infer<typeof CriarDocumentoExigidoInput>;
