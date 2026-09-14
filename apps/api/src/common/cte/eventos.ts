import { XMLBuilder } from "fast-xml-parser";
import { soDigitos } from "../chave-fiscal";
import { CODIGO_UF } from "./chave";

/**
 * Os eventos do CT-e.
 *
 * Um CT-e autorizado não se altera nem se apaga: o que existe depois dele são
 * EVENTOS, documentos próprios, assinados à parte, que se penduram na chave.
 * Três importam aqui:
 *
 *   110111  Cancelamento — desfaz, com prazo e justificativa
 *   110110  Carta de correção — conserta o que a lei deixa consertar
 *   110180  Comprovante de entrega — prova que a carga chegou
 *
 * O último é a maior alavanca escondida do sistema: ele exige data, hora,
 * geolocalização, quem recebeu e o hash da foto — e o Movatruck já grava os
 * cinco desde sempre, porque é o que o motorista faz na descarga. O CT-e vira
 * prova de entrega sem ninguém digitar nada.
 *
 * Todos compartilham o mesmo envelope (`TEvento`) e o mesmo endpoint, e o que
 * muda é o `detEvento` — que no schema é `xs:any processContents="skip"`, ou
 * seja, NÃO é validado pelo schema do envelope. Por isso cada um é validado
 * contra o schema próprio, como já se faz com o modal rodoviário.
 */

export const TIPO_EVENTO = {
  cancelamento: "110111",
  cartaCorrecao: "110110",
  comprovanteEntrega: "110180",
} as const;
export type TipoEvento = keyof typeof TIPO_EVENTO;

/** O texto do `descEvento` é fixo por tipo — a SEFAZ compara. */
const DESCRICAO: Record<TipoEvento, string> = {
  cancelamento: "Cancelamento",
  cartaCorrecao: "Carta de Correcao",
  comprovanteEntrega: "Comprovante de Entrega do CT-e",
};

const VERSAO = "4.00";

const construtor = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  suppressEmptyNode: true,
  format: false,
  processEntities: true,
});

export type BaseEvento = {
  /** Chave do CT-e a que o evento se pendura. */
  chave: string;
  cnpjEmitente: string;
  /** UF do órgão — normalmente a do emitente. */
  uf: string;
  ambiente: 1 | 2;
  /**
   * Ordem do evento do MESMO tipo nesta chave, começando em 1.
   *
   * Carta de correção pode ter várias, e cada uma SUBSTITUI a anterior — a
   * sequência é o que diz qual vale. Repetir o número é rejeição.
   */
  sequencia?: number;
  ocorridoEm?: Date;
};

export type Cancelamento = BaseEvento & {
  /** Protocolo da autorização que está sendo desfeita. */
  protocolo: string;
  justificativa: string;
};

export type Correcao = BaseEvento & {
  /** O que muda. `grupoAlterado` é o grupo do leiaute (ex.: "ide"). */
  correcoes: {
    grupoAlterado: string;
    campoAlterado: string;
    valorAlterado: string;
    /** Item dentro do grupo, quando ele se repete. 1 quando não se repete. */
    numeroItem?: number;
  }[];
};

export type ComprovanteEntrega = BaseEvento & {
  protocolo: string;
  entregueEm: Date;
  /** Documento de quem recebeu — CPF ou CNPJ. */
  documentoRecebedor: string;
  nomeRecebedor: string;
  latitude?: number | null;
  longitude?: number | null;
  /**
   * SHA-1 em base64 de (chave + CPF/CNPJ do recebedor + data/hora), como a
   * nota técnica define. Quem calcula é `hashDaEntrega` abaixo — a conta é
   * parte da regra, não detalhe de implementação.
   */
  hash: string;
  hashCalculadoEm: Date;
};

/**
 * O texto de condição de uso da carta de correção.
 *
 * Não é texto nosso pra melhorar: o XSD traz uma ENUMERAÇÃO com exatamente
 * duas strings aceitas, e qualquer outra é rejeitada. Esta saiu do próprio
 * schema, caractere a caractere.
 *
 * Eu havia escrito de memória "paragrafo 1o-A do art. 58-B" — que é a redação
 * da NF-e. Toda carta de correção teria sido recusada, com um texto que parece
 * certo em qualquer revisão humana.
 *
 * Das duas versões aceitas (com e sem acento), vai a SEM: atravessa qualquer
 * codificação sem virar caractere estranho no meio do caminho.
 */
const CONDICAO_USO =
  "A Carta de Correcao e disciplinada pelo Art. 58-B do CONVENIO/SINIEF 06/89:" +
  " Fica permitida a utilizacao de carta de correcao, para regularizacao de" +
  " erro ocorrido na emissao de documentos fiscais relativos a prestacao de" +
  " servico de transporte, desde que o erro nao esteja relacionado com: I - as" +
  " variaveis que determinam o valor do imposto tais como: base de calculo," +
  " aliquota, diferenca de preco, quantidade, valor da prestacao;II - a" +
  " correcao de dados cadastrais que implique mudanca do emitente, tomador," +
  " remetente ou do destinatario;III - a data de emissao ou de saida.";


function emIso(d: Date): string {
  const brasilia = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${brasilia.getUTCFullYear()}-${p(brasilia.getUTCMonth() + 1)}-${p(brasilia.getUTCDate())}` +
    `T${p(brasilia.getUTCHours())}:${p(brasilia.getUTCMinutes())}:${p(brasilia.getUTCSeconds())}-03:00`
  );
}

function envelope(
  base: BaseEvento,
  tipo: TipoEvento,
  detalhe: Record<string, unknown>,
): { xml: string; id: string } {
  const chave = soDigitos(base.chave);
  const sequencia = base.sequencia ?? 1;
  const codigo = TIPO_EVENTO[tipo];
  // O Id do evento é "ID" + tipo(6) + chave(44) + sequência(3) = 53 dígitos,
  // e o schema cobra o padrão exato. Três, não dois: a NF-e usa dois e é fácil
  // trazer o hábito de lá — o XSD do CT-e recusa na hora.
  const id = `ID${codigo}${chave}${String(sequencia).padStart(3, "0")}`;

  const corpo = construtor.build({
    eventoCTe: {
      "@xmlns": "http://www.portalfiscal.inf.br/cte",
      "@versao": VERSAO,
      infEvento: {
        "@Id": id,
        cOrgao: CODIGO_UF[base.uf.toUpperCase()],
        tpAmb: base.ambiente,
        CNPJ: soDigitos(base.cnpjEmitente),
        chCTe: chave,
        dhEvento: emIso(base.ocorridoEm ?? new Date()),
        tpEvento: codigo,
        nSeqEvento: sequencia,
        detEvento: { "@versaoEvento": VERSAO, ...detalhe },
      },
    },
  });
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>${corpo}`, id };
}

/**
 * Cancelamento.
 *
 * A justificativa tem mínimo de 15 caracteres por exigência da SEFAZ, e o
 * protocolo é o da autorização que está sendo desfeita — cancelar citando
 * protocolo de outro documento é rejeição.
 */
export function gerarCancelamento(e: Cancelamento) {
  const just = e.justificativa.trim();
  if (just.length < 15) {
    throw new Error("A justificativa do cancelamento precisa ter ao menos 15 letras.");
  }
  return envelope(e, "cancelamento", {
    evCancCTe: {
      descEvento: DESCRICAO.cancelamento,
      nProt: soDigitos(e.protocolo),
      xJust: just,
    },
  });
}

/**
 * Carta de correção.
 *
 * O que NÃO se corrige por carta está na própria condição de uso, e a SEFAZ
 * não confere: valor, imposto, quem são as partes e as datas. Corrigir isso
 * por carta é infração, ainda que o documento passe — por isso o texto vai
 * inteiro e literal no XML.
 */
export function gerarCartaCorrecao(e: Correcao) {
  if (e.correcoes.length === 0) throw new Error("Informe ao menos uma correção.");
  return envelope(e, "cartaCorrecao", {
    evCCeCTe: {
      descEvento: DESCRICAO.cartaCorrecao,
      infCorrecao: e.correcoes.map((c) => ({
        grupoAlterado: c.grupoAlterado,
        campoAlterado: c.campoAlterado,
        valorAlterado: c.valorAlterado,
        nroItemAlterado: c.numeroItem ?? 1,
      })),
      xCondUso: CONDICAO_USO,
    },
  });
}

/**
 * Comprovante de entrega.
 *
 * Os campos que ele pede o sistema já grava: `descargaLat`/`descargaLng` do
 * GPS do motorista, o instante da descarga, a foto do canhoto e — desde a fase
 * 0 — quem recebeu. Aqui eles viram documento fiscal.
 */
export function gerarComprovanteEntrega(e: ComprovanteEntrega) {
  const doc = soDigitos(e.documentoRecebedor);
  if (doc.length !== 11 && doc.length !== 14) {
    throw new Error("O documento de quem recebeu precisa ser um CPF ou um CNPJ.");
  }
  return envelope(e, "comprovanteEntrega", {
    evCECTe: {
      descEvento: DESCRICAO.comprovanteEntrega,
      nProt: soDigitos(e.protocolo),
      dhEntrega: emIso(e.entregueEm),
      nDoc: doc,
      xNome: e.nomeRecebedor,
      // Coordenada só entra se existir de verdade. Mandar zero seria dizer que
      // a entrega foi no golfo da Guiné.
      ...(e.latitude != null && e.longitude != null
        ? { latitude: e.latitude.toFixed(6), longitude: e.longitude.toFixed(6) }
        : {}),
      hashEntrega: e.hash,
      dhHashEntrega: emIso(e.hashCalculadoEm),
    },
  });
}

/**
 * O hash da entrega.
 *
 * SHA-1 de (chave + documento do recebedor + data/hora), em base64. A conta é
 * definida pela nota técnica e a SEFAZ a refaz do lado dela — por isso ela mora
 * aqui, testada, e não espalhada em quem chama.
 */
export function hashDaEntrega(args: {
  chave: string;
  documentoRecebedor: string;
  entregueEm: Date;
}): string {
  // Import local: o módulo é usado em teste puro e não deve arrastar node:crypto
  // pra quem só quer montar XML.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const base =
    soDigitos(args.chave) + soDigitos(args.documentoRecebedor) + emIso(args.entregueEm);
  return createHash("sha1").update(base, "utf8").digest("base64");
}

/** O schema próprio de cada evento — o do envelope não valida o `detEvento`. */
export const SCHEMA_DO_EVENTO: Record<TipoEvento, string> = {
  cancelamento: "evCancCTe_v4.00.xsd",
  cartaCorrecao: "evCCeCTe_v4.00.xsd",
  comprovanteEntrega: "evCECTe_v4.00.xsd",
};
