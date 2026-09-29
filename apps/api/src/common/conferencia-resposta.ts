import { BOTOES_CONFERENCIA_DIARIA, type OpcaoConferenciaDiaria } from "@ronan/shared-types";
import { diaDaSemanaYmd } from "./conferencia-diaria";
import type { Ymd } from "./ponto-jornada";

/**
 * A conversa da conferência diária — as partes PURAS (sem Prisma, sem relógio).
 *
 * Nada aqui usa IA, de propósito: a resposta muda o que o sistema faz com o
 * cadastro de uma pessoa (mesmo que só como SUGESTÃO), então ela tem que ser
 * previsível e testável em tabela. O que não bate com nada vira AMBIGUA e vai
 * pra um humano.
 */

const DIAS_CURTOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "sexta, 25/09" — o {{1}} do template e o texto do histórico. */
export function diaTextoConferencia(dia: Ymd): string {
  const [, m, d] = dia.split("-");
  return `${DIAS_CURTOS[diaDaSemanaYmd(dia)]}, ${d}/${m}`;
}

/** O texto que fica no histórico e que sairia se o template não existisse. Espelha o `textoAprovacao`. */
export function textoPerguntaConferencia(diaTexto: string): string {
  return [
    `No dia ${diaTexto}, você não teve viagens? Toque em uma das opções abaixo pra me avisar.`,
    "",
    ...BOTOES_CONFERENCIA_DIARIA.map((b, i) => `${i + 1}. ${b.rotulo}`),
  ].join("\n");
}

/** Minúsculas, sem acento, sem pontuação nas pontas, espaço único. */
export function normalizarResposta(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tabela do interpretador. Compara a mensagem INTEIRA (nunca "contém"): "não
 * tive tempo de ligar pro cliente" não é um "Não tive".
 *
 * Sobre "sim" e "não": a pergunta é "você NÃO teve viagens?" — dupla negativa.
 * A leitura literal é "sim" = confirmo que não tive, "não" = tive. É a leitura
 * adotada aqui e o custo do erro é pequeno (nenhuma das saídas muda cadastro),
 * mas se a operação achar que "não" quase sempre quer dizer "não tive", é só
 * mover a linha de uma opção pra outra.
 */
const TABELA: Record<Exclude<OpcaoConferenciaDiaria, "AMBIGUA">, readonly string[]> = {
  NAO_TIVE: [
    "1",
    "sim",
    "nao tive",
    "nao tive viagem",
    "nao tive viagens",
    "nao tive nenhuma",
    "nao tive nenhuma viagem",
    "nao houve",
  ],
  TIVE_NAO_LANCEI: [
    "2",
    "nao",
    "tive",
    "tive nao lancei",
    "tive mas nao lancei",
    "tive e nao lancei",
    "tive viagem",
    "tive viagens",
    "esqueci",
    "esqueci de lancar",
  ],
  SAI_DA_EMPRESA: [
    "3",
    "sai da empresa",
    "nao trabalho mais ai",
    "nao trabalho mais ai na empresa",
    "nao trabalho mais ai com voces",
  ],
  PARAR: [
    "4",
    "parar",
    "pare",
    "parar perguntas",
    "parar essas perguntas",
    "parar de perguntar",
    "nao quero mais",
    "nao quero mais receber",
    "nao quero receber",
    "stop",
  ],
};

const INDICE = new Map<string, Exclude<OpcaoConferenciaDiaria, "AMBIGUA">>();
for (const [opcao, frases] of Object.entries(TABELA)) {
  for (const f of frases) INDICE.set(f, opcao as Exclude<OpcaoConferenciaDiaria, "AMBIGUA">);
}

/** Texto livre → opção. Vazio (áudio, foto, figurinha) e qualquer outra coisa → AMBIGUA. */
export function interpretarRespostaConferencia(texto: string | null | undefined): OpcaoConferenciaDiaria {
  if (!texto) return "AMBIGUA";
  return INDICE.get(normalizarResposta(texto)) ?? "AMBIGUA";
}

/**
 * O resumo genérico das 20h deve ficar de fora?
 *
 * Quem recebeu a pergunta hoje já conversou com a gente sobre o dia — o resumo
 * "hoje você fez 0 viagens" logo depois seria ruído (ou pior: cobra de quem
 * acabou de dizer que não rodou). A EXCEÇÃO é pendência de peso ou divergência:
 * essa sai sempre, porque é dinheiro do próprio motorista parado.
 */
export function deveSuprimirResumo(o: {
  suprimirLigado: boolean;
  temPendencia: boolean;
  recebeuPerguntaHoje: boolean;
}): boolean {
  if (!o.suprimirLigado) return false;
  if (o.temPendencia) return false;
  return o.recebeuPerguntaHoje;
}

/** O que dizer ao motorista pra cada opção (fora o PARAR, que usa o texto da empresa). */
export const RESPOSTA_NAO_TIVE = "Anotado, obrigado por avisar!";
export const RESPOSTA_TIVE_NAO_LANCEI =
  "Abra o app e lance a viagem — viagem que não é lançada não entra no seu acerto.";
export const RESPOSTA_SAI_DA_EMPRESA = "Anotado. Seu gestor vai confirmar.";

/** Os 8 últimos dígitos: como o resto do código casa telefone entre formatos (com/sem DDI e 9). */
export function sufixoTelefone(telefone: string): string {
  return telefone.replace(/\D/g, "").slice(-8);
}
