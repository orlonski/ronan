import type { PrismaService } from "../prisma/prisma.service";
import {
  estadoVisivel,
  type EstadoConversa,
  type EstadoVisivel,
  type PrazosFollowup,
} from "../sdr/followup.regua";

/**
 * O estado da conversa de cada lead, pra tela poder mostrar quem está parado.
 *
 * Existe porque a informação estava invisível: `ultimoContato` é gravado em
 * quatro lugares do código e nunca foi lido por ninguém, e a transcrição do SDR
 * não tinha tela nenhuma — quem abria a ficha de um lead não via o que o robô
 * tinha falado com ele.
 *
 * **Uma consulta pra página inteira**, não uma por lead. `DISTINCT ON` é do
 * Postgres e resolve "a última linha de cada grupo" sem subquery correlacionada;
 * com 50 leads na tela, a alternativa seriam 100 idas ao banco.
 */

export type ConversaDoLead = {
  estado: EstadoVisivel;
  ultimaDirecao: "ENTRADA" | "SAIDA" | null;
  ultimaMensagemEm: Date | null;
  /** Horas de silêncio desde a última mensagem, pra tela não recalcular. */
  horasParada: number | null;
  followupsEnviados: number;
  encerradaEm: Date | null;
};

type LinhaUltima = { leadId: string; direcao: string; criadoEm: Date };
type LinhaEntrada = { leadId: string; criadoEm: Date };

/**
 * Quem escreveu pra Movatruck e o SDR NÃO atendeu.
 *
 * `MensagemLead` só existe quando o robô respondeu. Todas as conversas que
 * caíram na fila humana — desligado, sem cota, opt-out — não deixam linha
 * nenhuma lá, e eram justamente as que mais precisavam de olho: a pessoa
 * escreveu, ouviu "já chamei alguém da equipe" e ficou esperando.
 *
 * `InteracaoLead` de canal WHATSAPP é gravada SEMPRE que alguém escreve,
 * atendido ou não. É ela que fecha o buraco.
 */
const CANAL_WHATSAPP = "WHATSAPP";

/** Os campos do lead que o estado precisa — o resto da linha não interessa. */
export type LeadParaConversa = {
  id: string;
  optOut: boolean;
  status: string;
  followupsEnviados: number;
  ultimoFollowupEm: Date | null;
  conversaEncerradaEm: Date | null;
  sdrPausadoEm: Date | null;
};

/**
 * O estado bruto de cada conversa.
 *
 * Exportado porque o varredor do follow-up precisa exatamente disto — e duas
 * cópias montando "quem falou por último" divergiriam no primeiro ajuste: a
 * tela chamaria de parada uma conversa que o robô considera viva, e ninguém
 * entenderia por que a mensagem não saiu.
 */
export async function estadosDeConversa(
  prisma: PrismaService,
  leads: LeadParaConversa[],
): Promise<Map<string, EstadoConversa>> {
  const estados = new Map<string, EstadoConversa>();
  const ids = leads.map((l) => l.id);
  if (ids.length === 0) return estados;

  const escreveu = await prisma.interacaoLead.groupBy({
    by: ["leadId"],
    where: { leadId: { in: ids }, canal: CANAL_WHATSAPP },
    _max: { criadoEm: true },
  });
  const porLeadEscreveu = new Map(
    escreveu.map((r) => [r.leadId, r._max.criadoEm as Date | null]),
  );

  const ultimas = await prisma.$queryRaw<LinhaUltima[]>`
    SELECT DISTINCT ON ("leadId") "leadId", "direcao", "criadoEm"
    FROM "mensagens_lead"
    WHERE "leadId" = ANY(${ids})
    ORDER BY "leadId", "criadoEm" DESC
  `;
  const entradas = await prisma.$queryRaw<LinhaEntrada[]>`
    SELECT DISTINCT ON ("leadId") "leadId", "criadoEm"
    FROM "mensagens_lead"
    WHERE "leadId" = ANY(${ids}) AND "direcao" = 'ENTRADA'
    ORDER BY "leadId", "criadoEm" DESC
  `;
  const porLeadUltima = new Map(ultimas.map((r) => [r.leadId, r]));
  const porLeadEntrada = new Map(entradas.map((r) => [r.leadId, r.criadoEm]));

  for (const lead of leads) {
    const palavra = ultimaPalavra(
      porLeadUltima.get(lead.id) ?? null,
      porLeadEscreveu.get(lead.id) ?? null,
    );

    estados.set(lead.id, {
      ultimaDirecao: palavra.direcao,
      ultimaMensagemEm: palavra.em,
      ultimaEntradaEm: maisRecente(
        porLeadEntrada.get(lead.id) ?? null,
        porLeadEscreveu.get(lead.id) ?? null,
      ),
      followupsEnviados: lead.followupsEnviados,
      ultimoFollowupEm: lead.ultimoFollowupEm,
      conversaEncerradaEm: lead.conversaEncerradaEm,
      sdrPausadoEm: lead.sdrPausadoEm,
      optOut: lead.optOut,
      status: lead.status,
    });
  }
  return estados;
}

export async function conversasDosLeads(
  prisma: PrismaService,
  leads: LeadParaConversa[],
  prazos: PrazosFollowup,
  agora = new Date(),
): Promise<Map<string, ConversaDoLead>> {
  const mapa = new Map<string, ConversaDoLead>();
  const estados = await estadosDeConversa(prisma, leads);

  for (const lead of leads) {
    const c = estados.get(lead.id);
    if (!c) continue;
    mapa.set(lead.id, {
      estado: estadoVisivel(c, prazos, agora),
      ultimaDirecao: c.ultimaDirecao,
      ultimaMensagemEm: c.ultimaMensagemEm,
      horasParada: c.ultimaMensagemEm
        ? (agora.getTime() - c.ultimaMensagemEm.getTime()) / 3_600_000
        : null,
      followupsEnviados: lead.followupsEnviados,
      encerradaEm: lead.conversaEncerradaEm,
    });
  }
  return mapa;
}

/**
 * Quem deu a última palavra, juntando as duas fontes.
 *
 * `atendida` é o que o SDR trocou com ele (entrada e saída). `escreveuEm` é a
 * última vez que ele escreveu, tendo o robô atendido ou não. Quando a segunda é
 * mais recente, a última palavra foi DELE e ninguém respondeu — o caso que
 * ficava invisível, porque conversa que cai na fila humana não grava
 * `MensagemLead`.
 *
 * Aritmética pura pra poder ser testada sem banco: é a decisão de onde sai o
 * "esperando resposta" da tela.
 */
export function ultimaPalavra(
  atendida: { direcao: string; criadoEm: Date } | null,
  escreveuEm: Date | null,
): { direcao: "ENTRADA" | "SAIDA" | null; em: Date | null } {
  const semAtendimento =
    escreveuEm !== null &&
    (atendida === null || escreveuEm.getTime() > atendida.criadoEm.getTime());
  if (semAtendimento) return { direcao: "ENTRADA", em: escreveuEm };
  if (!atendida) return { direcao: null, em: null };
  return { direcao: atendida.direcao as "ENTRADA" | "SAIDA", em: atendida.criadoEm };
}

/** A mais recente das duas datas. `null` quando as duas faltam. */
function maisRecente(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
