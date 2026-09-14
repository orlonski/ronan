import { XMLBuilder } from "fast-xml-parser";
import type { CteMontado } from "./montar";

/**
 * O XML do CT-e 4.00.
 *
 * Até aqui o sistema produzia uma estrutura em JSON que ESPELHAVA o XML. Isso
 * bastava pra falar com gateway, e não bastava pra saber se o documento está
 * certo: quem diz isso é o XSD, e XSD valida XML.
 *
 * ORDEM É PARTE DO CONTRATO. O leiaute é `xs:sequence`, então trocar `dest` de
 * lugar invalida o documento inteiro mesmo com todos os campos corretos. Por
 * isso a montagem abaixo é explícita e não depende da ordem das chaves do
 * objeto de entrada — e a ordem usada aqui foi extraída do próprio schema,
 * não da memória de ninguém:
 *
 *   infCte: ide, compl?, emit, rem?, exped?, receb?, dest?, vPrest, imp,
 *           [infCTeNorm | infCteComp], autXML*, infRespTec?
 *
 * Repare que `dest` vem DEPOIS de `exped` e `receb` — que é justamente onde a
 * intuição erra, porque remetente e destinatário são o par que se pensa junto.
 */

const NS = "http://www.portalfiscal.inf.br/cte";
export const VERSAO_LEIAUTE = "4.00";

const construtor = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  suppressEmptyNode: true,
  // Sem indentação: o XML assinado não pode ter espaço em branco entre as tags
  // (a assinatura cobre os bytes, e o canonicalizador não os remove). Gerar
  // bonito aqui e minificar depois seria uma etapa a mais pra errar.
  format: false,
  processEntities: true,
});

/** Remove chaves ausentes — tag vazia num campo opcional é rejeição, não omissão. */
function limpar<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(limpar) as unknown as T;
  if (obj === null || typeof obj !== "object") return obj;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") {
      const filho = limpar(v);
      // `{}` vira tag vazia; some.
      if (!Array.isArray(filho) && Object.keys(filho as object).length === 0) continue;
      saida[k] = filho;
      continue;
    }
    saida[k] = v;
  }
  return saida as T;
}

/**
 * Monta o `infCte` na ordem do schema.
 *
 * Só entra o que existe: os grupos opcionais somem quando não há dado, em vez
 * de virarem tag vazia.
 */
function infCte(cte: CteMontado): Record<string, unknown> {
  return limpar({
    "@versao": VERSAO_LEIAUTE,
    // O Id é literalmente "CTe" + os 44 dígitos. É por ele que a assinatura
    // referencia o que está assinando, então um erro aqui só aparece na SEFAZ.
    "@Id": `CTe${cte.chave}`,
    ide: cte.ide,
    emit: cte.emit,
    rem: cte.rem,
    exped: cte.exped,
    receb: cte.receb,
    dest: cte.dest,
    vPrest: cte.vPrest,
    imp: cte.imp,
    infCTeNorm: cte.infCTeNorm,
    infRespTec: cte.infRespTec,
  });
}

/**
 * O XML pronto pra assinar.
 *
 * Sem `<Signature>`: ela é acrescentada por quem tem o certificado — hoje o
 * gateway, amanhã a gente. O documento que sai daqui é o que vai ser assinado,
 * e é exatamente ele que o XSD valida.
 */
export function gerarXmlCte(cte: CteMontado): string {
  const corpo = construtor.build({
    CTe: {
      "@xmlns": NS,
      infCte: infCte(cte),
    },
  });
  return `<?xml version="1.0" encoding="UTF-8"?>${corpo}`;
}
