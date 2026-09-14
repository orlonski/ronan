import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateXML } from "xmllint-wasm";

/**
 * Validação do XML contra os schemas OFICIAIS do CT-e 4.00.
 *
 * Os XSD vivem versionados em `apps/api/schemas/cte-400`, baixados do portal da
 * SVRS (pacote PL_CTe_400_NT2024.001). Estão no repositório de propósito: o
 * portal sai do ar — saiu, enquanto eu buscava — e um build que depende dele
 * quebra por motivo alheio. Schema fiscal é dado estável e versionado; baixar em
 * runtime seria trocar previsibilidade por nada.
 *
 * Isto é o que separa "o payload me parece certo" de "o leiaute está certo".
 * O XSD confere o que nenhuma regra escrita à mão cobre sem virar um segundo
 * schema: elemento obrigatório faltando, ordem trocada, tamanho estourado,
 * valor fora da enumeração, decimal com casas demais.
 *
 * É também o que torna a manutenção sustentável: quando a SEFAZ publica nota
 * técnica, o pacote novo entra aqui e a divergência aparece como erro de
 * validação com o campo apontado — em vez de rejeição em produção com um código
 * que alguém precisa ir procurar o que significa.
 */

/** O `xmllint-wasm` usa WASM — mesmo comportamento no Mac e no Alpine, sem node-gyp. */
const PASTA_PADRAO = join(__dirname, "..", "..", "..", "schemas", "cte-400");

export type ErroXsd = { mensagem: string; linha?: number };
export type ResultadoXsd = {
  ok: boolean;
  erros: ErroXsd[];
  /**
   * `false` = o documento ainda não estava assinado, então a conferência cobriu
   * o leiaute e NÃO a assinatura. Dizer isso é o que impede alguém de ler "XSD
   * ok" como "pronto pra SEFAZ".
   */
  assinaturaVerificada: boolean;
};

/**
 * Esqueleto de assinatura, usado SÓ para a conferência de leiaute.
 *
 * O schema exige `Signature` dentro de `CTe` — um CT-e sem assinatura não é um
 * CT-e válido, e é correto que o XSD recuse. Mas a assinatura é o último passo,
 * feita por quem tem o certificado, e a conferência precisa acontecer ANTES:
 * descobrir que faltava um campo depois de assinar e mandar é o ciclo caro que
 * tudo isto existe pra evitar.
 *
 * Então, para validar, encaixa-se este esqueleto — que satisfaz a estrutura que
 * a SEFAZ restringe (C14N e rsa-sha1 fixos, `KeyInfo` obrigatório) com valores
 * de enchimento. Ele NUNCA é transmitido: `gerarXmlCte` não o produz, e o
 * resultado acima diz em voz alta que a assinatura não foi conferida.
 */
function esqueletoAssinatura(chave: string): string {
  const vazio = "AA==";
  return (
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<SignedInfo>` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>` +
    `<Reference URI="#CTe${chave}">` +
    `<Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
    `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>` +
    `<DigestValue>${vazio}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>` +
    `<SignatureValue>${vazio}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${vazio}</X509Certificate></X509Data></KeyInfo>` +
    `</Signature>`
  );
}

type Arquivo = { fileName: string; contents: string };

let cache: { pasta: string; preload: Arquivo[]; raiz: string } | null = null;

/**
 * Carrega os 44 schemas uma vez.
 *
 * Todos entram no `preload` porque eles se importam entre si (o do CT-e importa
 * os tipos básicos, que importam o do modal, que importa a assinatura). Ler do
 * disco a cada validação seria I/O por documento emitido.
 */
function carregar(pasta = PASTA_PADRAO) {
  if (cache && cache.pasta === pasta) return cache;
  const preload = readdirSync(pasta)
    .filter((f) => f.endsWith(".xsd"))
    .map((f) => ({ fileName: f, contents: readFileSync(join(pasta, f), "utf8") }));
  const raiz = readFileSync(join(pasta, "cte_v4.00.xsd"), "utf8");
  cache = { pasta, preload, raiz };
  return cache;
}

function limparMensagem(m: unknown): string {
  // A mensagem do libxml vem com o namespace inteiro em toda tag, o que deixa a
  // linha ilegível pra quem só quer saber qual campo faltou.
  return String(m)
    .replace(/\{http:\/\/www\.portalfiscal\.inf\.br\/cte\}/g, "")
    .replace(/^Schemas validity error : /, "")
    .trim();
}

/**
 * O XML do modal rodoviário, validado à parte.
 *
 * No schema principal o `infModal` é um `xs:any processContents="skip"`: o
 * conteúdo do modal simplesmente NÃO é conferido ali. Validar só o documento
 * principal e declarar "passou no XSD" deixaria de fora justamente o grupo que
 * carrega o RNTRC — e a SEFAZ confere.
 */
async function validarModal(xml: string, pasta: string): Promise<ErroXsd[]> {
  const m = xml.match(/<rodo>[\s\S]*?<\/rodo>/);
  if (!m) return [];
  const { preload } = carregar(pasta);
  const schema = readFileSync(join(pasta, "cteModalRodoviario_v4.00.xsd"), "utf8");
  const solto = m[0].replace(
    "<rodo>",
    '<rodo xmlns="http://www.portalfiscal.inf.br/cte">',
  );
  const r = await validateXML({
    xml: [{ fileName: "rodo.xml", contents: `<?xml version="1.0" encoding="UTF-8"?>${solto}` }],
    schema: [schema],
    preload,
  });
  return r.valid
    ? []
    : r.errors.map((e) => ({ mensagem: `modal rodoviário: ${limparMensagem(e.message)}` }));
}

export async function validarContraXsd(
  xml: string,
  pasta = PASTA_PADRAO,
): Promise<ResultadoXsd> {
  const { preload, raiz } = carregar(pasta);

  const jaAssinado = xml.includes("<Signature");
  let paraValidar = xml;
  if (!jaAssinado) {
    const chave = xml.match(/Id="CTe(\d{44})"/)?.[1] ?? "";
    paraValidar = xml.replace("</CTe>", `${esqueletoAssinatura(chave)}</CTe>`);
  }

  const [r, errosModal] = await Promise.all([
    validateXML({
      xml: [{ fileName: "cte.xml", contents: paraValidar }],
      schema: [raiz],
      preload,
    }),
    validarModal(xml, pasta),
  ]);

  if (r.valid && errosModal.length === 0) {
    return { ok: true, erros: [], assinaturaVerificada: jaAssinado };
  }

  return {
    ok: false,
    assinaturaVerificada: jaAssinado,
    erros: [
      ...errosModal,
      ...(r.valid ? [] : r.errors).map((e) => ({
      // A mensagem do libxml vem com o prefixo do namespace em toda tag, o que
      // deixa a linha ilegível pra quem só quer saber qual campo faltou.
        mensagem: limparMensagem(e.message),
        linha: typeof e.loc?.lineNumber === "number" ? e.loc.lineNumber : undefined,
      })),
    ],
  };
}
