import {
  camposExigidosAusentes,
  type CamposDoTipo,
  type MarcaDespesa,
  type SinalRepetido,
  type SituacaoDespesaMotorista,
  type StatusDespesa,
} from "@ronan/shared-types";
import { lerChaveFiscal } from "./chave-fiscal";

/**
 * Regras puras do GASTO DE VIAGEM (módulo `despesas`). Sem Prisma, sem Nest:
 * é o que os testes cobrem e o que os services só orquestram.
 *
 * Doutrina (project_lancamento_nunca_recusado): o servidor NUNCA recusa um
 * gasto por causa da configuração do tipo. Faltou campo, tipo desativado,
 * valor acima do máximo, papel repetido — tudo vira MARCA pro escritório ver.
 */

/** Dia civil de São Paulo ("YYYY-MM-DD"). O Brasil não tem horário de verão desde 2019. */
export function diaSP(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Marcas que pedem o olho de alguém. `VIAGEM_NAO_ACHADA` não é ponto de
 * atenção de dinheiro: é só a viagem que ainda não subiu do celular, e some
 * sozinha quando ela chega.
 */
export const MARCAS_DE_ATENCAO: readonly MarcaDespesa[] = [
  "SEM_COMPROVANTE",
  "CAMPO_EXIGIDO_AUSENTE",
  "ACIMA_DO_MAXIMO",
  "POSSIVEL_REPETIDO",
  "TIPO_INATIVO",
];

export function temAtencao(marcas: readonly string[]): boolean {
  return marcas.some((m) => (MARCAS_DE_ATENCAO as readonly string[]).includes(m));
}

export type DadosDoLancamento = {
  valor: number;
  temFoto: boolean;
  semComprovanteMotivo?: string | null;
  descricao?: string | null;
  veiculoId?: string | null;
  litros?: number | null;
  odometro?: number | null;
  onde?: string | null;
};

/** As marcas que o lançamento ganha ao chegar (ou ao ser corrigido). */
export function marcasDoLancamento(args: {
  cfg: CamposDoTipo;
  tipoAtivo: boolean;
  devolveNoMaximo: number | null;
  dados: DadosDoLancamento;
  repetido: boolean;
  viagemNaoAchada: boolean;
}): MarcaDespesa[] {
  const m: MarcaDespesa[] = [];
  const { cfg, dados } = args;
  // Sem papel num tipo que pede (ou exige) foto: o escritório confere com o que
  // ele escreveu. Tipo que "não pede" foto não tem o que faltar.
  if (!dados.temFoto && cfg.foto !== "NAO_PEDE") m.push("SEM_COMPROVANTE");
  if (camposExigidosAusentes(cfg, dados).length > 0) m.push("CAMPO_EXIGIDO_AUSENTE");
  if (args.devolveNoMaximo != null && dados.valor > args.devolveNoMaximo) m.push("ACIMA_DO_MAXIMO");
  if (args.repetido) m.push("POSSIVEL_REPETIDO");
  if (!args.tipoAtivo) m.push("TIPO_INATIVO");
  if (args.viagemNaoAchada) m.push("VIAGEM_NAO_ACHADA");
  return m;
}

export const MOTIVO_POR_SUA_CONTA = "Por sua conta: a empresa não devolve este tipo de gasto.";

export type DecisaoInicial = {
  status: StatusDespesa;
  valorAprovado: number | null;
  motivo: string | null;
  automatico: boolean;
};

/**
 * Como o gasto NASCE, pela regra do tipo (decisão da empresa, uma vez, no
 * cadastro — não do motorista a cada lançamento):
 *
 * - tipo que não devolve → "Por sua conta" (nem entra na fila);
 * - "aprova sozinho até R$ X", valor ≤ X e nenhum ponto de atenção → APROVADA;
 * - o resto → com o escritório. "Aprova sozinho" vazio = confere tudo.
 */
export function decisaoInicial(args: {
  devolve: boolean;
  aprovaSozinhoAte: number | null;
  valor: number;
  marcas: readonly string[];
}): DecisaoInicial {
  if (!args.devolve) {
    return { status: "NAO_REEMBOLSADA", valorAprovado: null, motivo: MOTIVO_POR_SUA_CONTA, automatico: true };
  }
  if (args.aprovaSozinhoAte != null && args.valor <= args.aprovaSozinhoAte && !temAtencao(args.marcas)) {
    return { status: "APROVADA", valorAprovado: args.valor, motivo: null, automatico: true };
  }
  return { status: "COM_ESCRITORIO", valorAprovado: null, motivo: null, automatico: false };
}

/**
 * A chave fiscal que vale guardar: 44 dígitos com DV ok e modelo de cupom/nota
 * (NF-e 55 ou NFC-e 65). Qualquer outra coisa vira null — guardar chave
 * errada faria ela parecer conferida (ver chave-fiscal.ts).
 */
export function chaveDeComprovante(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  const r = lerChaveFiscal(entrada);
  if (!r.ok) return null;
  if (r.dados.modelo !== "55" && r.dados.modelo !== "65") return null;
  return r.dados.chave;
}

export type CandidatoRepetido = {
  id: string;
  motoristaId: string;
  tipoDespesaId: string;
  valor: number;
  data: Date;
  chaveFiscal: string | null;
  sha256s: string[];
};

/**
 * Este gasto parece o mesmo papel de outro já lançado? Três sinais, do mais
 * forte pro mais fraco. Marca, NUNCA recusa (o escritório decide).
 *
 * - MESMA_CHAVE: a chave de 44 dígitos é a mesma (de qualquer motorista da conta);
 * - MESMA_FOTO: o sha256 de uma foto bate (foto da galeria reaproveitada);
 * - PARECIDO: mesmo motorista + mesmo tipo + mesmo valor + mesmo dia de SP.
 */
export function detectarRepetido(
  novo: Omit<CandidatoRepetido, "id"> & { id?: string },
  candidatos: readonly CandidatoRepetido[],
): { despesaId: string; sinal: SinalRepetido } | null {
  const outros = candidatos.filter((c) => c.id !== novo.id);
  if (novo.chaveFiscal) {
    const c = outros.find((o) => o.chaveFiscal === novo.chaveFiscal);
    if (c) return { despesaId: c.id, sinal: "MESMA_CHAVE" };
  }
  if (novo.sha256s.length) {
    const c = outros.find((o) => o.sha256s.some((h) => novo.sha256s.includes(h)));
    if (c) return { despesaId: c.id, sinal: "MESMA_FOTO" };
  }
  const dia = diaSP(novo.data);
  const centavos = Math.round(novo.valor * 100);
  const c = outros.find(
    (o) =>
      o.motoristaId === novo.motoristaId &&
      o.tipoDespesaId === novo.tipoDespesaId &&
      Math.round(o.valor * 100) === centavos &&
      diaSP(o.data) === dia,
  );
  return c ? { despesaId: c.id, sinal: "PARECIDO" } : null;
}

/**
 * Onde o gasto está, na linguagem do motorista (Meus reembolsos).
 * Vermelho e "recusado" não existem aqui — ele é parceiro, não réu.
 */
export function situacaoParaMotorista(d: {
  status: StatusDespesa;
  valorInformado: number;
  valorAprovado: number | null;
  motivo: string | null;
  decididoAutomatico: boolean;
  acerto: { status: "ABERTO" | "FECHADO" | "PAGO" } | null;
  /** Dia em que ele era empregado registrado: o escritório paga fora do acerto. */
  foraDoAcerto: boolean;
}): { situacao: SituacaoDespesaMotorista; somaPraReceber: boolean } {
  if (d.status === "NAO_REEMBOLSADA") {
    const porSuaConta = d.decididoAutomatico && d.motivo === MOTIVO_POR_SUA_CONTA;
    return { situacao: porSuaConta ? "POR_SUA_CONTA" : "NAO_REEMBOLSADA", somaPraReceber: false };
  }
  if (d.status === "COM_ESCRITORIO") return { situacao: "COM_ESCRITORIO", somaPraReceber: true };
  // APROVADA
  if (d.acerto?.status === "PAGO") return { situacao: "PAGO", somaPraReceber: false };
  if (d.acerto?.status === "FECHADO") return { situacao: "NO_ACERTO", somaPraReceber: false };
  if (d.foraDoAcerto) return { situacao: "PAGO_FORA_DO_ACERTO", somaPraReceber: true };
  const outroValor =
    d.valorAprovado != null && Math.round(d.valorAprovado * 100) !== Math.round(d.valorInformado * 100);
  return { situacao: outroValor ? "APROVADA_OUTRO_VALOR" : "APROVADA", somaPraReceber: true };
}

/** O motorista ainda pode corrigir/apagar? Só antes de gente decidir e fora de acerto. */
export function editavelPeloMotorista(d: {
  status: StatusDespesa;
  decididoAutomatico: boolean;
  emAcerto: boolean;
}): boolean {
  if (d.emAcerto) return false;
  return d.status === "COM_ESCRITORIO" || d.decididoAutomatico;
}

/**
 * O que a decisão do escritório grava. Valor lançado nunca muda; aprovar
 * outro valor ou não reembolsar exigem motivo escrito (o motorista vai ler).
 */
export function validarDecisao(args: {
  acao: "APROVAR" | "NAO_REEMBOLSAR";
  valorInformado: number;
  valorAprovado?: number;
  motivo?: string | null;
}): { ok: true; valorAprovado: number | null; motivo: string | null } | { ok: false; erro: string } {
  const motivo = args.motivo?.trim() || null;
  if (args.acao === "NAO_REEMBOLSAR") {
    if (!motivo) return { ok: false, erro: "Escreva o motivo — o motorista vai ler." };
    return { ok: true, valorAprovado: null, motivo };
  }
  const valor = args.valorAprovado ?? args.valorInformado;
  const diferente = Math.round(valor * 100) !== Math.round(args.valorInformado * 100);
  if (diferente && !motivo) {
    return { ok: false, erro: "Aprovar outro valor exige o motivo — o motorista vai ler." };
  }
  return { ok: true, valorAprovado: valor, motivo: diferente ? motivo : null };
}
