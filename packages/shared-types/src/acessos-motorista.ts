import { z } from "zod";
import { CAPACIDADES_APP_CHAVES, type CapacidadeApp } from "./capacidades-app";

/**
 * OS ACESSOS DE UM MOTORISTA, como o painel mexe: uma lista de interruptores.
 *
 * Por baixo a empresa pode estar no espelho da ficha (colunas `pode*`) ou nas
 * regras (perfil + exceção). Quem escolhe o caminho é a API; a tela só liga e
 * desliga. Por isso a resposta já vem no formato do interruptor, e não no do
 * motor.
 */

/** Item da lista que não é capacidade do catálogo: o resumo do dia no WhatsApp. */
export const ITEM_RESUMO_DIARIO = "resumoDiario" as const;

/** Motivo gravado quando a empresa está nas regras e a mudança nasce do interruptor. */
export const MOTIVO_AJUSTE_FICHA = "Ajustado na ficha do motorista";
/** Motivo gravado quando o interruptor volta a valer o que o grupo já dava. */
export const MOTIVO_VOLTOU_AO_PADRAO = "Voltou ao que o grupo dele já dá";

export type ChaveItemAcessoMotorista = CapacidadeApp | typeof ITEM_RESUMO_DIARIO;

export const AjustarAcessosMotoristaInput = z.object({
  itens: z
    .array(
      z.object({
        chave: z.union([z.enum(CAPACIDADES_APP_CHAVES), z.literal(ITEM_RESUMO_DIARIO)]),
        ligado: z.boolean(),
      }),
    )
    .min(1)
    .max(40)
    .refine((l) => new Set(l.map((i) => i.chave)).size === l.length, {
      message: "Item repetido.",
    }),
});
export type AjustarAcessosMotoristaInput = z.infer<typeof AjustarAcessosMotoristaInput>;

export type ItemAcessoMotorista = {
  chave: ChaveItemAcessoMotorista;
  label: string;
  /** O que o motorista vê/faz no app, em uma frase. */
  efeito: string;
  ligado: boolean;
  /** Tem ajuste só dele (empresa nas regras). */
  ajustado: boolean;
  /** Rótulos dos itens que precisam estar ligados pra este funcionar. */
  precisaDe: string[];
  custa: boolean;
};

export type AcessosDoMotorista = {
  motoristaId: string;
  nome: string;
  fonte: "COLUNAS" | "REGRAS";
  /** Cadastro aprovado e ativo. Antes disso os acessos valem só quando aprovar. */
  aprovado: boolean;
  itens: ItemAcessoMotorista[];
  /** Quantos itens têm ajuste só dele. */
  ajustes: number;
  temTelefone: boolean;
  /** O que aparece no app dele hoje — alimenta "Ver o celular dele". */
  capacidadesNoApp: string[];
};
