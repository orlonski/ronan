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

export async function conversasDosLeads(
  prisma: PrismaService,
  leads: LeadParaConversa[],
  prazos: PrazosFollowup,
  agora = new Date(),
): Promise<Map<string, ConversaDoLead>> {
  const mapa = new Map<string, ConversaDoLead>();
  const ids = leads.map((l) => l.id);
  if (ids.length === 0) return mapa;

  // `mensagens_lead` é o @@map do model — em SQL cru o nome do model não
  // existe, e o typecheck não pega isso: quebra em runtime.
  const ultimas = await prisma.$queryRaw<LinhaUltima[]>`
    SELECT DISTINCT ON ("leadId") "leadId", "direcao", "criadoEm"
    FROM "mensagens_lead"
    WHERE "leadId" = ANY(${ids})
    ORDER BY "leadId", "criadoEm" DESC
  `;
  // A última vez que ELE falou é o que abre a janela de 24h da Meta — por isso
  // vem separada da última mensagem qualquer.
  const entradas = await prisma.$queryRaw<LinhaEntrada[]>`
    SELECT DISTINCT ON ("leadId") "leadId", "criadoEm"
    FROM "mensagens_lead"
    WHERE "leadId" = ANY(${ids}) AND "direcao" = 'ENTRADA'
    ORDER BY "leadId", "criadoEm" DESC
  `;

  const porLeadUltima = new Map(ultimas.map((r) => [r.leadId, r]));
  const porLeadEntrada = new Map(entradas.map((r) => [r.leadId, r.criadoEm]));

  for (const lead of leads) {
    const ultima = porLeadUltima.get(lead.id) ?? null;
    const c: EstadoConversa = {
      ultimaDirecao: (ultima?.direcao as "ENTRADA" | "SAIDA" | undefined) ?? null,
      ultimaMensagemEm: ultima?.criadoEm ?? null,
      ultimaEntradaEm: porLeadEntrada.get(lead.id) ?? null,
      followupsEnviados: lead.followupsEnviados,
      ultimoFollowupEm: lead.ultimoFollowupEm,
      conversaEncerradaEm: lead.conversaEncerradaEm,
      sdrPausadoEm: lead.sdrPausadoEm,
      optOut: lead.optOut,
      status: lead.status,
    };
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
