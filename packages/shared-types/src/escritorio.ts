import { z } from "zod";

// Escritório de Agentes: a foto do pipeline de conferência de ticket pro painel
// da plataforma. Leitura pura, derivada do que já está gravado.
//
// Dado pessoal: só o NOME CURTO do motorista que lançou a viagem ("João S."),
// por pedido do dono, pra a cena dizer quem chegou. Nada de CPF, placa, telefone,
// texto livre nem custo. O nome só sai pra quem tem `escritorio.ver` (chave de
// plataforma). Os ids são UUIDs opacos.

export const VereditoEscritorio = z.enum(["BATE", "DIVERGE", "INCERTO", "ILEGIVEL", "NAO_APLICAVEL"]);
export type VereditoEscritorio = z.infer<typeof VereditoEscritorio>;

export const EscritorioSnapshotSchema = z.object({
  geradoEm: z.string(),
  /** Nome (fantasia) da empresa cujos dados a cena mostra. Vem do tenant, nunca fixo. */
  empresa: z.string().max(120).optional(),
  /** true = o servidor estava sob pressão e devolveu o último cálculo bom. */
  desatualizado: z.boolean().default(false),
  robo: z.object({
    /** A conferência está ligada nesta conta? */
    ativo: z.boolean(),
    /** Sombra = grava o veredito e NÃO mexe na viagem. A cena tem que dizer. */
    modoSombra: z.boolean(),
  }),
  contagens: z.object({
    /** Jobs de conferência esperando ou em execução. */
    fila: z.number().int(),
    /** Viagens aprovadas (status OK) nas últimas 24h. */
    validadas24h: z.number().int(),
    /** Viagens em DIVERGENTE (devolvidas, esperando o motorista), dos últimos 180 dias. */
    devolvidas: z.number().int(),
    /** Viagens em AJUSTADA agora (o motorista corrigiu, voltam pra fila). */
    ajustadas: z.number().int(),
    /** Viagens em EM_CONFERENCIA agora (esperando alguém do escritório). */
    travadas: z.number().int(),
  }),
  /** Minutos desde que a travada mais antiga ficou parada. null = nenhuma. */
  travadaMaisAntigaMin: z.number().int().nullable(),
  /** Viagens que chegaram na API nos últimos minutos (alimenta a leg celular→torre→servidor). */
  chegadas: z.array(z.object({ id: z.string(), em: z.string(), motorista: z.string().max(40).optional() })).max(50),
  /** Conferências concluídas nos últimos minutos (alimenta a leitura e o carimbo). */
  veredictos: z
    .array(
      z.object({
        id: z.string(),
        viagemId: z.string(),
        em: z.string(),
        veredito: VereditoEscritorio,
        /** "NENHUMA" | "FILA_REVISAO" | "AVISOU_MOTORISTA" | null */
        acao: z.string().nullable(),
        /** Foi a 2ª leitura (escalou pro modelo forte)? Vira o "conferente" na cena. */
        segundaLeitura: z.boolean(),
      }),
    )
    .max(50),
});
export type EscritorioSnapshot = z.infer<typeof EscritorioSnapshotSchema>;
