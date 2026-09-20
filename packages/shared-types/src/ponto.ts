import { z } from "zod";

/**
 * PONTO ELETRÔNICO — o que o aparelho e o servidor compartilham.
 *
 * ⚠️ Este módulo é de FUNCIONÁRIO REGISTRADO EM CARTEIRA, e é separado do
 * "mensal" (obra e diária) por decisão jurídica: lá o motorista é parceiro
 * autônomo, e somar controle de jornada a pagamento por diária e habitualidade
 * desenha os elementos de vínculo dentro do produto. A mesma pessoa não pode
 * estar nos dois, e quem garante isso é o banco (`RegimeVigente`), não a boa
 * vontade de quem cadastra.
 *
 * ⚠️ A REGRA QUE DECIDE TODO O RESTO: o botão grava UM INSTANTE E UMA PESSOA.
 * Não grava "entrada", não grava "almoço", não grava "saída". Tipo de
 * marcação, atraso e saldo são TRATAMENTO, feitos depois, em outra tabela.
 *
 * Isso resolve três coisas de uma vez. A lei (art. 82, IV da Portaria MTP
 * 671/2021 proíbe alterar o dado registrado pelo trabalhador — se o tipo
 * morasse no registro, errar o botão obrigaria a corrigir o original). O
 * público (o dedão não escolhe nada; é um alvo só). E a regra da casa de nunca
 * pré-selecionar opção pro motorista, que já acusou motorista uma vez.
 */

/**
 * A janela em que dois toques do mesmo dedo viram uma marcação só.
 *
 * Fixa no código, não na configuração: uma janela que o escritório regula e
 * que engole batida legítima em silêncio é restrição de registro com outro
 * nome. 60s cobre o toque nervoso com luva no sol, e nada além disso.
 *
 * ⚠️ A dedupe é comparação de INSTANTES no servidor, nunca `clientId`
 * derivado do horário. Derivar do horário tem três defeitos de uma vez:
 * bucket de 60s dá janela real de 0 a 60s (12:04:59 e 12:05:01 viram duas
 * marcações, 12:04:01 e 12:04:59 viram uma); relógio que recua por NTP produz
 * o mesmo id pra dois toques distintos, e a segunda marcação some com a tela
 * dizendo que está tudo certo; e amarrar o id ao `funcionarioId` deixa sem
 * botão quem ainda não baixou o próprio cadastro. O `clientId` é UUID do
 * aparelho, como todo o resto do outbox.
 */
export const JANELA_ANTI_DUPLICIDADE_SEG = 60;

/** Dois instantes são o mesmo toque? Mesma função nos dois lados. */
export function mesmoToque(aISO: string, bISO: string): boolean {
  const a = Date.parse(aISO);
  const b = Date.parse(bISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < JANELA_ANTI_DUPLICIDADE_SEG * 1000;
}

/**
 * Por que o controle eletrônico desta empresa vale.
 *
 * ⚠️ Só existe UMA opção, e é de propósito. Virar REP-P (o programa
 * registrador do art. 75 da Portaria 671) exige gerar AFD e AEJ e ter
 * Atestado Técnico — nada disso existe aqui. Enquanto não existir, o que
 * temos é controle alternativo, que a Portaria admite quando previsto em
 * convenção ou acordo coletivo do cliente.
 *
 * Um enum com uma opção só parece constante chumbada, e é — mas a constante
 * declarada num campo obriga a empresa a dizer qual é o acordo dela, e é isso
 * que o auditor pergunta. Acrescentar `ATTR_MOVATRUCK` antes do atestado
 * existir seria oferecer na tela uma coisa que não temos.
 */
export const FUNDAMENTOS_CONTROLE_PONTO = ["ACORDO_COLETIVO"] as const;
export const FundamentoControlePontoSchema = z.enum(FUNDAMENTOS_CONTROLE_PONTO);
export type FundamentoControlePonto = z.infer<typeof FundamentoControlePontoSchema>;

const ISO = z.string().datetime({ offset: true });
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a data no formato AAAA-MM-DD.");

/**
 * O que o app manda ao bater o ponto.
 *
 * `agoraNoAparelho` é separado de `marcadoEm` e existe por um motivo: num app
 * offline-first o outbox drena horas depois, então `recebidoEm - marcadoEm` é
 * TEMPO DE FILA, não desvio de relógio. Comparar o relógio do aparelho no
 * momento do ENVIO com o do servidor é o que mede desvio de verdade — e sem
 * essa separação o alerta de relógio adulterado dispararia em toda marcação
 * de motorista, que é o mesmo que não existir.
 */
export const MarcacaoPontoInput = z.object({
  /** UUID gerado no aparelho. Idempotência do outbox. */
  clientId: z.string().min(8),
  /** O instante do TOQUE. É este que vale, e é o relógio do aparelho. */
  marcadoEm: ISO,
  /** "AAAA-MM-DD" em America/Sao_Paulo, resolvido NO APARELHO no toque. */
  dia: DIA,
  /** O relógio do aparelho no momento do ENVIO. Ver acima. */
  agoraNoAparelho: ISO.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  precisao: z.number().int().min(0).max(100000).optional(),
  appVersao: z.string().max(40).optional(),
  dispositivo: z.string().max(120).optional(),
});
export type MarcacaoPontoInput = z.infer<typeof MarcacaoPontoInput>;

export const TIPOS_CORRECAO_PONTO = ["INCLUSAO", "DESCONSIDERACAO", "ANOTACAO"] as const;
export const TipoCorrecaoPontoSchema = z.enum(TIPOS_CORRECAO_PONTO);
export type TipoCorrecaoPontoTipo = z.infer<typeof TipoCorrecaoPontoSchema>;

/**
 * Pedir correção. O motivo escrito é OBRIGATÓRIO, como na alteração de km.
 *
 * Mexer no registro de jornada de alguém sem justificativa escrita é a mesma
 * doutrina: não pode. E quem pede pelo app pede, não decide — a decisão é do
 * gestor, e fica com autor e data.
 */
export const CorrecaoPontoInput = z
  .object({
    clientId: z.string().min(8).optional(),
    dia: DIA,
    tipo: TipoCorrecaoPontoSchema,
    /** Obrigatório em DESCONSIDERACAO: qual marcação não deve contar. */
    marcacaoId: z.string().uuid().optional(),
    /** Obrigatório em INCLUSAO: que horas deveria ter sido registrado. */
    instantePretendido: ISO.optional(),
    motivoCodigo: z.string().min(1, "Escolha o motivo."),
    motivo: z.string().trim().min(3, "Escreva o que aconteceu."),
  })
  .refine((c) => c.tipo !== "INCLUSAO" || c.instantePretendido != null, {
    message: "Diga que horas deveria ter sido registrado.",
    path: ["instantePretendido"],
  })
  .refine((c) => c.tipo !== "DESCONSIDERACAO" || c.marcacaoId != null, {
    message: "Diga qual registro não deve contar.",
    path: ["marcacaoId"],
  });
export type CorrecaoPontoInput = z.infer<typeof CorrecaoPontoInput>;

/**
 * O comprovante do registro.
 *
 * ⚠️ O MESMO montador do recibo provisório (o que aparece no celular antes de
 * subir, sem número) e do definitivo. Dois montadores dariam dois documentos
 * pro mesmo ato — e é o comprovante, não a tela de aviso, que o auditor lê.
 *
 * ⚠️ Chama-se "NÚMERO DE REGISTRO", nunca NSR. NSR é vocabulário de REP, e o
 * número aqui é atribuído na ordem em que o servidor RECEBE: com outbox, dois
 * motoristas que bateram 07:00 e 07:05 podem receber 4210 e 4182 conforme
 * quem sincronizou primeiro. É identificador único, não sequência cronológica
 * — e chamar de NSR seria sugerir uma ordem que ele não tem, num documento
 * legal. O espelho ordena por `marcadoEm`, nunca por este número.
 */
export function montarComprovantePonto(d: {
  razaoSocial: string;
  cnpj: string;
  identificacaoRep: string;
  repVersao: string;
  nome: string;
  cpf: string;
  marcadoEmISO: string;
  numeroRegistro: number | null;
}): { titulo: string; linhas: { rotulo: string; valor: string }[]; texto: string } {
  const dt = new Date(d.marcadoEmISO);
  const br = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(dt);
  const [data, hora] = br.split(", ");

  const linhas = [
    { rotulo: "Empregador", valor: d.razaoSocial },
    { rotulo: "CNPJ", valor: formatarCnpj(d.cnpj) },
    { rotulo: "Trabalhador", valor: d.nome },
    { rotulo: "CPF", valor: formatarCpfPonto(d.cpf) },
    { rotulo: "Data", valor: data ?? "" },
    { rotulo: "Hora", valor: hora ?? "" },
    { rotulo: "Sistema", valor: `${d.identificacaoRep} ${d.repVersao}` },
    {
      rotulo: "Número de registro",
      // Provisório é honesto: o registro está no celular e ainda não subiu.
      // Inventar um número aqui daria dois números pro mesmo ato.
      valor: d.numeroRegistro == null ? "aguardando envio" : String(d.numeroRegistro),
    },
  ];

  return {
    titulo: "Comprovante de registro de ponto",
    linhas,
    texto: linhas.map((l) => `${l.rotulo}: ${l.valor}`).join("\n"),
  };
}

function formatarCnpj(v: string): string {
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatarCpfPonto(v: string): string {
  const d = v.replace(/\D/g, "");
  if (d.length !== 11) return v;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
