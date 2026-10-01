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

/**
 * "Voltar a receber as perguntas" (depois de ter tocado em "Parar perguntas").
 * Mesma regra da tabela acima: a mensagem INTEIRA, normalizada, tem que ser uma
 * destas frases — nunca "contém". "voltar amanhã com a carga", "vou voltar pro
 * posto" e "não quero voltar" NÃO são pedido de voltar (conversa normal com o escritório).
 * Não é uma opção da pergunta (não grava na linha), por isso fica fora da `TABELA`.
 */
export const FRASES_VOLTAR: readonly string[] = [
  "voltar",
  "volta",
  "quero voltar",
  "pode voltar",
  "podem voltar",
  "retomar",
  "quero retomar",
  "pode retomar",
  "voltar a perguntar",
  "pode voltar a perguntar",
  "podem voltar a perguntar",
  "voltar a receber",
  "quero voltar a receber",
  "quero receber",
  "quero receber de novo",
  "quero receber as perguntas",
  "voltar a receber as perguntas",
  "voltar a receber essas perguntas",
  "pode voltar a enviar",
  "voltem a perguntar",
  "voltem a enviar",
];

const INDICE_VOLTAR = new Set(FRASES_VOLTAR);

/**
 * "Esse número não é do motorista": quem recebeu a pergunta avisa que é a pessoa errada.
 * Mesma regra de "parar"/"voltar": a mensagem INTEIRA, normalizada, tem que ser uma destas
 * frases — nunca "contém" nem similaridade. "não sou eu que dirijo hoje" ou "esse não é o meu
 * número de conta" ficam de fora (conversa normal). Tabela de DADOS: pra aceitar uma variação
 * nova, acrescente a frase aqui (já normalizada: minúscula, sem acento, sem pontuação).
 */
export const FRASES_NUMERO_ERRADO: readonly string[] = [
  "numero errado",
  "numero incorreto",
  "este numero esta errado",
  "esse numero esta errado",
  "esse numero ta errado",
  "numero errado aqui",
  "engano",
  "foi engano",
  "e engano",
  "deve ser engano",
  "acho que e engano",
  "mensagem enviada por engano",
  "voce errou o numero",
  "voces erraram o numero",
  "errou o numero",
  "erraram o numero",
  "nao sou eu",
  "nao sou ele",
  "nao sou essa pessoa",
  "nao sou a pessoa",
  "nao sou a pessoa certa",
  "nao sou motorista",
  "eu nao sou motorista",
  "nao conheco",
  "nao conheco essa pessoa",
  "nao conheco ninguem com esse nome",
  "nao conheco o motorista",
  "esse nao e meu numero",
  "esse nao e o meu numero",
  "este nao e meu numero",
  "este nao e o meu numero",
  "esse numero nao e dele",
  "esse numero nao e do motorista",
  "numero trocado",
];

const INDICE_NUMERO_ERRADO = new Set(FRASES_NUMERO_ERRADO.map(normalizarResposta));

/** O texto avisa que o número não é do motorista? Correspondência exata (normalizada), nunca vaga. */
export function ehNumeroErrado(texto: string | null | undefined): boolean {
  return !!texto && INDICE_NUMERO_ERRADO.has(normalizarResposta(texto));
}

/** Intenção lida de um texto livre: uma opção da pergunta, o pedido de voltar ou "número errado". */
export type IntencaoConferencia = OpcaoConferenciaDiaria | "VOLTAR" | "NUMERO_ERRADO";

export function interpretarIntencaoConferencia(texto: string | null | undefined): IntencaoConferencia {
  if (!texto) return "AMBIGUA";
  const n = normalizarResposta(texto);
  if (INDICE_VOLTAR.has(n)) return "VOLTAR";
  if (INDICE_NUMERO_ERRADO.has(n)) return "NUMERO_ERRADO";
  return INDICE.get(n) ?? "AMBIGUA";
}

/** O texto é o pedido de voltar a receber as perguntas? */
export function ehPedidoDeVoltar(texto: string | null | undefined): boolean {
  return interpretarIntencaoConferencia(texto) === "VOLTAR";
}

/** Texto livre → opção da pergunta. Vazio (áudio, foto, figurinha), "voltar" e qualquer outra coisa → AMBIGUA. */
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
/** Pra quem recebeu a pergunta no número errado. */
export const RESPOSTA_NUMERO_ERRADO = "Desculpe o engano! Vamos avisar a empresa para corrigir o cadastro.";
/** SEED (texto padrão), não regra: o que ele lê depois de pedir pra voltar. */
export const RESPOSTA_VOLTAR =
  "Pronto, voltamos a te perguntar quando você esquecer de lançar uma viagem. Se quiser parar de novo, é só tocar em Parar perguntas.";
/** Quando o que desligou foi a empresa (painel): não é decisão dele, e não prometemos nada. */
export const RESPOSTA_VOLTAR_EMPRESA_DESLIGOU =
  "Recebemos seu pedido, mas essa pergunta foi desligada pela sua empresa. Fale com ela se quiser voltar a receber.";

/** Os 8 últimos dígitos: como o resto do código casa telefone entre formatos (com/sem DDI e 9). */
export function sufixoTelefone(telefone: string): string {
  return telefone.replace(/\D/g, "").slice(-8);
}
