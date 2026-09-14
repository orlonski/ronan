import { request, type RequestOptions } from "node:https";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { Certificado } from "./assinatura";

/**
 * Falar direto com a SEFAZ.
 *
 * Duas coisas que só se descobrem tentando, e que derrubam quem não sabe:
 *
 * 1. **A cadeia é ICP-Brasil.** O certificado do servidor da SEFAZ é emitido
 *    sob a "Autoridade Certificadora Raiz Brasileira", que NÃO está em nenhum
 *    armazém de confiança de sistema operacional nem do Node. Sem entregar essa
 *    raiz, a conexão falha com "unable to get local issuer certificate" — e a
 *    saída fácil (desligar a verificação TLS) transformaria a integração fiscal
 *    num alvo de interceptação. A raiz vai versionada junto dos schemas.
 *
 * 2. **O certificado A1 é usado DUAS vezes.** Uma pra assinar o XML, outra no
 *    próprio handshake: a SEFAZ exige certificado de cliente e anuncia a lista
 *    de ACs que aceita. Sem apresentar o A1, o servidor derruba a conexão antes
 *    de responder qualquer coisa — nem o WSDL dá pra ler.
 *
 * O CT-e 4.00 é SOAP 1.2. O corpo vai dentro de `cteDadosMsg`, no namespace do
 * serviço chamado.
 */

/** A raiz da ICP-Brasil, versionada pelo mesmo motivo dos XSD: o site cai. */
const RAIZ_ICP = join(__dirname, "..", "..", "..", "schemas", "icp-brasil", "raiz-v10.pem");

export type Ambiente = 1 | 2;

export type Servico =
  | "CTeRecepcaoSincV4"
  | "CTeConsultaV4"
  | "CTeStatusServicoV4"
  | "CTeRecepcaoEventoV4";

/**
 * Os autorizadores.
 *
 * São OITO no país, não 27: MT, MS, MG, PR, RS e SP operam o próprio, e todo o
 * resto delega pra SVRS (18 estados) ou pra SVSP (3). Por isso atender o Brasil
 * inteiro é uma tabela pequena, e não 27 integrações.
 *
 * O caminho é um MOLDE e não uma concatenação: o Paraná serve em
 * `/cte4/CTeStatusServicoV4` e a SVRS em
 * `/ws/CTeStatusServicoV4/CTeStatusServicoV4.asmx`. Assumir um formato só
 * funciona até o segundo estado — que foi exatamente o que aconteceu aqui.
 */
type Autorizador = {
  nome: string;
  producao: string;
  homologacao: string;
  /** `{s}` é trocado pelo nome do serviço. */
  caminho: string;
};

const SVRS: Autorizador = {
  nome: "SVRS",
  producao: "https://cte.svrs.rs.gov.br",
  homologacao: "https://cte-homologacao.svrs.rs.gov.br",
  caminho: "/ws/{s}/{s}.asmx",
};

const PARANA: Autorizador = {
  nome: "SEFAZ-PR",
  producao: "https://cte.fazenda.pr.gov.br",
  homologacao: "https://homologacao.cte.fazenda.pr.gov.br",
  caminho: "/cte4/{s}",
};

/** As UFs que a SVRS atende — a própria RS mais as 18 que delegam a ela. */
const UFS_SVRS = "RS AC AL AM BA CE DF ES GO MA PA PB PI RJ RN RO SC SE TO".split(" ");

const AUTORIZADORES: Record<string, Autorizador> = {
  PR: PARANA,
  ...Object.fromEntries(UFS_SVRS.map((uf) => [uf, SVRS])),
};

/** Código IBGE da UF — vai no corpo das consultas e nos dois primeiros dígitos da chave. */
export const CODIGO_IBGE_UF: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27",
  SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41",
  SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

export function enderecoDoServico(uf: string, servico: Servico, ambiente: Ambiente): string {
  const a = AUTORIZADORES[uf.toUpperCase()];
  if (!a) {
    throw new Error(
      `Ainda não sei falar com o autorizador de ${uf.toUpperCase()}. ` +
        `Hoje o sistema fala com: ${Object.keys(AUTORIZADORES).sort().join(", ")}.`,
    );
  }
  const base = ambiente === 1 ? a.producao : a.homologacao;
  return base + a.caminho.replace(/\{s\}/g, servico);
}

/** Quem autoriza esta UF, pra tela poder dizer. */
export function autorizadorDaUf(uf: string): string | null {
  return AUTORIZADORES[uf.toUpperCase()]?.nome ?? null;
}

export type RespostaSefaz = {
  httpStatus: number;
  /** Pra onde foi. Muda por UF e ambiente, e erra-se com facilidade. */
  url: string;
  /** O envelope inteiro que saiu daqui. */
  enviado: string;
  /** A resposta CRUA, antes de qualquer interpretação. */
  bruto: string;
  /** O XML de dentro do envelope SOAP — sem a casca. */
  xml: string;
  /** Campos comuns a toda resposta da SEFAZ. */
  cStat: string | null;
  xMotivo: string | null;
};

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Os códigos da SEFAZ são numéricos mas significam categorias: "100" e "0100"
  // não são a mesma coisa, e converter pra número perderia zero à esquerda.
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
});

export class ClienteSefaz {
  constructor(
    private readonly cert: Certificado,
    private readonly pfx: Buffer,
    private readonly senha: string,
    /** Só pro teste apontar pra um servidor local com raiz própria. */
    private readonly caExtra?: Buffer[],
    /** Só pro teste: substitui o endereço do autorizador. */
    private readonly baseDeTeste?: string,
  ) {}

  /**
   * O POST.
   *
   * `node:https` e não `fetch`: o fetch do Node é undici e IGNORA a opção
   * `agent`, então o certificado de cliente simplesmente não seria apresentado
   * — e o sintoma seria a SEFAZ derrubando a conexão sem dizer por quê.
   */
  private postar(
    url: string,
    corpo: string,
    timeoutMs: number,
  ): Promise<{ status: number; texto: string }> {
    const u = new URL(url);
    const opcoes: RequestOptions = {
      method: "POST",
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        "content-type": "application/soap+xml; charset=utf-8",
        "content-length": Buffer.byteLength(corpo),
      },
      // O A1 no handshake. É isto que a SEFAZ exige antes de responder.
      pfx: this.pfx,
      passphrase: this.senha,
      // A raiz da ICP-Brasil ENTRA na lista de confiança, sem substituir as
      // outras — e `rejectUnauthorized` fica LIGADO, que é o ponto: desligar
      // resolveria o erro de cadeia e abriria a porta pra interceptação.
      ca: [...(this.caExtra ?? []), readFileSync(RAIZ_ICP)],
      rejectUnauthorized: true,
      timeout: timeoutMs,
    };

    return new Promise((resolve, reject) => {
      const req = request(opcoes, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (d: Buffer) => partes.push(d));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString("utf8") }),
        );
      });
      req.on("timeout", () => req.destroy(new Error("A SEFAZ não respondeu a tempo.")));
      req.on("error", reject);
      req.end(corpo);
    });
  }

  /**
   * Envelopa e manda.
   *
   * `cteDadosMsg` é o invólucro que todo serviço do CT-e 4.00 espera; o que
   * muda entre eles é só o namespace, que é o do próprio serviço.
   */
  private async chamar(
    uf: string,
    servico: Servico,
    ambiente: Ambiente,
    corpoXml: string,
    timeoutMs = 30_000,
  ): Promise<RespostaSefaz> {
    const url = this.baseDeTeste
      ? `${this.baseDeTeste}/${servico}`
      : enderecoDoServico(uf, servico, ambiente);
    const ns = `http://www.portalfiscal.inf.br/cte/wsdl/${servico}`;
    const envelope =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Body><cteDadosMsg xmlns="${ns}">` +
      corpoXml.replace(/^<\?xml[^>]*\?>/, "") +
      `</cteDadosMsg></soap12:Body></soap12:Envelope>`;

    const res = await this.postar(url, envelope, timeoutMs);
    const interno = desembrulhar(res.texto);
    const obj = leitor.parse(interno) as Record<string, any>;
    const raiz = Object.values(obj)[0] ?? {};
    return {
      httpStatus: res.status,
      url,
      // O que foi MANDADO e o que veio CRU. Guardar só o miolo desembrulhado
      // funciona quando a resposta é SOAP — e some justamente quando não é, que
      // é quando se precisa dela: um 400 do IIS não tem `Body` nenhum, e o
      // desembrulhador devolvia string vazia. Diagnóstico que some no erro não
      // é diagnóstico.
      enviado: envelope,
      bruto: res.texto,
      xml: interno,
      cStat: raiz?.cStat ?? null,
      xMotivo: raiz?.xMotivo ?? null,
    };
  }

  /**
   * "A SEFAZ está no ar?"
   *
   * Vale muito mais do que parece: é a única chamada que NÃO precisa de
   * documento nenhum, então é com ela que se prova que certificado, cadeia,
   * credenciamento e rede estão todos de pé — antes de arriscar um CT-e e
   * queimar um número da série.
   */
  async statusDoServico(uf: string, ambiente: Ambiente): Promise<RespostaSefaz> {
    const cUF = CODIGO_IBGE_UF[uf.toUpperCase()];
    const corpo =
      `<consStatServCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">` +
      `<tpAmb>${ambiente}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ>` +
      `</consStatServCTe>`;
    return this.chamar(uf, "CTeStatusServicoV4", ambiente, corpo);
  }

  /** Manda o CT-e assinado. Síncrono no 4.00: a autorização vem na resposta. */
  async enviarCte(uf: string, ambiente: Ambiente, xmlAssinado: string): Promise<RespostaSefaz> {
    return this.chamar(uf, "CTeRecepcaoSincV4", ambiente, xmlAssinado, 60_000);
  }

  /**
   * Manda um evento (cancelamento, carta de correção, comprovante de entrega).
   *
   * Todos vão pelo MESMO endpoint e no mesmo envelope — o que os distingue é o
   * `tpEvento` lá dentro.
   */
  async enviarEvento(uf: string, ambiente: Ambiente, xmlAssinado: string): Promise<RespostaSefaz> {
    return this.chamar(uf, "CTeRecepcaoEventoV4", ambiente, xmlAssinado, 45_000);
  }

  /** Consulta a situação de um CT-e pela chave. */
  async consultarCte(uf: string, ambiente: Ambiente, chave: string): Promise<RespostaSefaz> {
    const corpo =
      `<consSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">` +
      `<tpAmb>${ambiente}</tpAmb><xServ>CONSULTAR</xServ><chCTe>${chave}</chCTe>` +
      `</consSitCTe>`;
    return this.chamar(uf, "CTeConsultaV4", ambiente, corpo);
  }
}

/**
 * Tira a casca do SOAP.
 *
 * A resposta vem com prefixos que variam por serviço e por estado, então o corte
 * é pelo `Body` sem depender de qual prefixo o servidor usou.
 */
export function desembrulhar(soap: string): string {
  const m = soap.match(/<(?:\w+:)?Body[^>]*>([\s\S]*)<\/(?:\w+:)?Body>/);
  const dentro = (m?.[1] ?? soap).trim();
  // Alguns serviços ainda embrulham numa tag de resultado antes do XML útil.
  const r = dentro.match(/<(?:\w+:)?\w*[Rr]esult\w*[^>]*>([\s\S]*)<\/(?:\w+:)?\w*[Rr]esult\w*>/);
  return (r?.[1] ?? dentro).trim();
}
