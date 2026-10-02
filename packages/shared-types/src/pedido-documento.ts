import { z } from "zod";
import type { UnidadePedidoTipo } from "./pedido";

/**
 * Pedido lido de um documento (PDF da ordem de compra, foto, e-mail colado).
 *
 * A IA só SUGERE: a resposta preenche o formulário de novo pedido e quem
 * confere e salva é a pessoa. Por isso cada campo carrega o texto que foi lido
 * (`lido`) — é com ele que se confere, não com o que o sistema achou que era.
 */

/** Tetos da leitura. Ficam aqui pra tela e API dizerem o mesmo número. */
export const LIMITE_DOCUMENTO_PEDIDO = {
  /** 10 MB: ordem de compra escaneada passa folgado; mais que isso é livro. */
  bytes: 10 * 1024 * 1024,
  /** Pedido tem 1–3 páginas. 20 cobre anexo; acima disso a leitura fica cara e lenta à toa. */
  paginas: 20,
  /** E-mail colado com histórico inteiro de resposta cabe aqui. */
  caracteresTexto: 30_000,
} as const;

/** Texto colado vai como campo do multipart, junto ou no lugar do arquivo. */
export const ExtrairPedidoTextoInput = z.object({
  texto: z.string().trim().max(LIMITE_DOCUMENTO_PEDIDO.caracteresTexto).optional(),
});
export type ExtrairPedidoTextoInput = z.infer<typeof ExtrairPedidoTextoInput>;

/**
 * Quão firme é a sugestão de UM campo.
 * - ALTA: casou exato com o cadastro (nome, apelido, CNPJ) ou o número/data veio limpo.
 * - MEDIA: casou por parte do nome, ou foi deduzido (a empresa veio da obra).
 * - BAIXA: a IA leu, mas com dúvida.
 */
export const CONFIANCAS_CAMPO = ["ALTA", "MEDIA", "BAIXA"] as const;
export type ConfiancaCampo = (typeof CONFIANCAS_CAMPO)[number];

export type CampoLidoPedido<T> = {
  /** O valor pronto pro formulário. Ausente = não achei; o campo fica vazio. */
  valor?: T;
  /** O texto como estava no documento. */
  lido?: string;
  confianca?: ConfiancaCampo;
};

/** Campo que aponta pra um cadastro: `valor` é o id, `nome` o rótulo do cadastro. */
export type CampoCadastroLido = CampoLidoPedido<string> & {
  nome?: string;
  /** Cidade/UF do local, pra montar o rótulo do combobox. */
  cidade?: string | null;
  uf?: string | null;
};

export type ExtrairPedidoResult = {
  origem: "PDF" | "IMAGEM" | "TEXTO";
  /** Quem pediu (Empresa — o tomador que paga). */
  empresa: CampoCadastroLido;
  /** A obra (Cliente). */
  obra: CampoCadastroLido;
  material: CampoCadastroLido;
  localCarga: CampoCadastroLido;
  localDescarga: CampoCadastroLido;
  quantidade: CampoLidoPedido<number>;
  unidade: CampoLidoPedido<UnidadePedidoTipo>;
  /** AAAA-MM-DD */
  inicioEm: CampoLidoPedido<string>;
  /** AAAA-MM-DD */
  prazoEm: CampoLidoPedido<string>;
  observacao: CampoLidoPedido<string>;
  /** Quem mandou o pedido (nome/telefone). Vai junto da observação sugerida. */
  contato: CampoLidoPedido<string>;
  /** O que a pessoa precisa saber pra conferir (unidade que o sistema não mede, prazo trocado…). */
  avisos: string[];
  /** Confiança geral que a IA declarou sobre a leitura (0..1). */
  confianca: number;
};
