import { createHash, randomUUID } from "node:crypto";
import type { CteMontado } from "../../common/cte/montar";
import { assinarCte, type Certificado } from "../../common/cte/assinatura";
import { gerarXmlCte } from "../../common/cte/xml";
import { ClienteSefaz } from "../../common/cte/sefaz";
import { gerarCancelamento } from "../../common/cte/eventos";

/**
 * Os três níveis de emissão são o MESMO código com um interruptor.
 *
 *   SIMULADOR  nível 1 — local, sem certificado, sem custo. Prova que o
 *              documento fecha e que tudo DEPOIS da emissão funciona.
 *   GATEWAY    nível 2 — um provedor assina e fala com a SEFAZ por nós.
 *   SEFAZ      nível 3 sem intermediário — nós assinamos e falamos direto.
 *              Sem mensalidade de ninguém, em troca de sermos nós a acompanhar
 *              as notas técnicas.
 *
 * A interface existe pra que a troca não toque em nada do resto do sistema. Se
 * emitir por gateway exigisse um caminho diferente no serviço, todo o fluxo
 * testado no simulador teria que ser testado de novo — e é justamente isso que
 * o simulador existe pra evitar.
 */

export type RespostaEmissao =
  | {
      situacao: "AUTORIZADO";
      protocolo: string;
      autorizadoEm: Date;
      codigo: string;
      motivo: string;
      xml?: string | null;
      cru: unknown;
    }
  | {
      /** A SEFAZ (ou o simulador) recusou. Dá pra corrigir e emitir de novo. */
      situacao: "REJEITADO";
      codigo: string;
      motivo: string;
      cru: unknown;
    }
  | {
      /** Não chegou a ser avaliado: rede, gateway fora, credencial. Retentável. */
      situacao: "ERRO";
      motivo: string;
      cru: unknown;
    };

export type RespostaCancelamento =
  | { situacao: "CANCELADO"; protocolo: string; canceladoEm: Date; cru: unknown }
  | { situacao: "ERRO"; motivo: string; cru: unknown };

export interface EmissorCte {
  readonly nome: "SIMULADOR" | "GATEWAY" | "SEFAZ";
  emitir(cte: CteMontado, ambiente: 1 | 2): Promise<RespostaEmissao>;
  /**
   * `protocolo` é o da autorização que está sendo desfeita. Está na interface
   * porque quem fala direto com a SEFAZ precisa dele — e um gateway que não
   * precise simplesmente o ignora.
   */
  cancelar(
    chave: string,
    justificativa: string,
    ambiente: 1 | 2,
    protocolo?: string,
  ): Promise<RespostaCancelamento>;
}

// ---------------------------------------------------------------------------
// Nível 1 — simulador local
// ---------------------------------------------------------------------------

/**
 * O emissor que não fala com ninguém.
 *
 * Ele NÃO é um stub que devolve "ok" pra tudo: isso não provaria nada. Ele
 * refaz as duas conferências que a SEFAZ faz e que dependem só do documento —
 * o dígito da chave e a soma dos componentes — e rejeita com o mesmo formato de
 * código e motivo que a SEFAZ usaria. Assim a tela de rejeição é exercitada de
 * verdade antes de existir certificado.
 *
 * O que ele não prova, e é bom não se iludir: o XSD completo, as regras por UF,
 * o cadastro do emitente na SEFAZ e a validade do certificado. Pra isso só o
 * nível 3 serve.
 */
export class SimuladorCte implements EmissorCte {
  readonly nome = "SIMULADOR" as const;

  async emitir(cte: CteMontado, ambiente: 1 | 2): Promise<RespostaEmissao> {
    if (ambiente === 1) {
      // Trava dura: o simulador jamais responde como produção. Um "AUTORIZADO"
      // de mentira com tpAmb=1 no banco viraria um CT-e que a empresa acha que
      // existe na SEFAZ — e a descoberta seria na fiscalização.
      return {
        situacao: "ERRO",
        motivo:
          "O simulador só opera em homologação. Para emitir de verdade, configure o gateway.",
        cru: { simulado: true },
      };
    }

    const soma = (cte.vPrest.Comp as { vComp: string }[]).reduce(
      (s, c) => s + Number(c.vComp),
      0,
    );
    if (Math.abs(soma - Number(cte.vPrest.vTPrest)) > 0.005) {
      return {
        situacao: "REJEITADO",
        codigo: "610",
        motivo: "Rejeicao: Valor da prestacao difere do somatorio dos componentes",
        cru: { simulado: true, soma },
      };
    }

    if (!/^\d{44}$/.test(cte.chave)) {
      return {
        situacao: "REJEITADO",
        codigo: "236",
        motivo: "Rejeicao: Chave de Acesso composta por digito invalido",
        cru: { simulado: true },
      };
    }

    // Protocolo com a cara do real (15 dígitos, começando pelo código da UF do
    // ambiente) e derivado da chave: reemitir o mesmo documento dá o mesmo
    // protocolo, o que torna o teste repetível.
    const protocolo =
      "9" +
      createHash("sha1")
        .update(cte.chave)
        .digest("hex")
        .replace(/\D/g, "")
        .padEnd(14, "0")
        .slice(0, 14);

    return {
      situacao: "AUTORIZADO",
      protocolo,
      autorizadoEm: new Date(),
      codigo: "100",
      motivo: "Autorizado o uso do CT-e (SIMULADO — sem valor fiscal)",
      xml: null,
      cru: { simulado: true, id: randomUUID() },
    };
  }

  async cancelar(chave: string): Promise<RespostaCancelamento> {
    return {
      situacao: "CANCELADO",
      protocolo: "9" + createHash("sha1").update("cancel" + chave).digest("hex").replace(/\D/g, "").padEnd(14, "0").slice(0, 14),
      canceladoEm: new Date(),
      cru: { simulado: true },
    };
  }
}

// ---------------------------------------------------------------------------
// Níveis 2 e 3 — gateway
// ---------------------------------------------------------------------------

export type ConfigGateway = {
  /** Base da API do provedor. */
  url: string;
  token: string;
  /** Quanto esperar antes de desistir. Emissão é síncrona na maioria. */
  timeoutMs?: number;
};

/**
 * O emissor por gateway.
 *
 * A decisão de não falar SOAP direto com as 27 SEFAZ continua de pé: seria
 * certificado por conta de cliente, contingência, notas técnicas trimestrais e
 * um leiaute em transição pela reforma tributária.
 *
 * O corpo enviado é o CT-e já montado — os provedores aceitam um JSON que
 * espelha os grupos do XML, que é exatamente o que `montarCte` produz. O que
 * varia entre eles é o envelope e o formato do retorno; por isso a leitura da
 * resposta abaixo é DEFENSIVA: procura os campos em vários nomes e, quando não
 * reconhece, devolve ERRO com o corpo cru em vez de inventar um "autorizado".
 *
 * Trocar de provedor mexe só aqui.
 */
export class GatewayCte implements EmissorCte {
  readonly nome = "GATEWAY" as const;

  constructor(private readonly cfg: ConfigGateway) {}

  private async chamar(caminho: string, corpo: unknown): Promise<{ ok: boolean; dados: any }> {
    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), this.cfg.timeoutMs ?? 30_000);
    try {
      const res = await fetch(`${this.cfg.url.replace(/\/$/, "")}${caminho}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.token}`,
        },
        body: JSON.stringify(corpo),
        signal: controle.signal,
      });
      const texto = await res.text();
      let dados: unknown;
      try {
        dados = texto ? JSON.parse(texto) : null;
      } catch {
        dados = { corpoNaoJson: texto.slice(0, 2000) };
      }
      return { ok: res.ok, dados };
    } finally {
      clearTimeout(limite);
    }
  }

  async emitir(cte: CteMontado, ambiente: 1 | 2): Promise<RespostaEmissao> {
    let r: { ok: boolean; dados: any };
    try {
      r = await this.chamar("/cte", { ambiente, cte });
    } catch (e) {
      // Rede, timeout, DNS: NÃO é rejeição. Marcar como rejeitado faria alguém
      // "corrigir" um documento que estava certo — e o número já foi gasto.
      return { situacao: "ERRO", motivo: (e as Error).message, cru: null };
    }

    const d = r.dados ?? {};
    const situacao = String(d.situacao ?? d.status ?? d.state ?? "").toLowerCase();
    const protocolo = d.protocolo ?? d.protocol ?? d.numero_protocolo ?? null;
    const codigo = String(d.codigo ?? d.status_sefaz ?? d.cStat ?? "");
    const motivo = String(d.mensagem ?? d.motivo ?? d.mensagem_sefaz ?? d.xMotivo ?? "");

    if (r.ok && (situacao.includes("autoriz") || codigo === "100") && protocolo) {
      return {
        situacao: "AUTORIZADO",
        protocolo: String(protocolo),
        autorizadoEm: d.autorizadoEm ? new Date(d.autorizadoEm) : new Date(),
        codigo: codigo || "100",
        motivo: motivo || "Autorizado o uso do CT-e",
        xml: d.xml ?? d.xml_autorizado ?? null,
        cru: d,
      };
    }

    // A SEFAZ avaliou e recusou: tem código de rejeição e motivo.
    if (codigo && codigo !== "100") {
      return { situacao: "REJEITADO", codigo, motivo: motivo || "Rejeitado sem motivo informado", cru: d };
    }

    // Não deu pra dizer o que aconteceu. Guardar o corpo cru e chamar de ERRO é
    // mais honesto que adivinhar — e mantém o documento retentável.
    return {
      situacao: "ERRO",
      motivo: motivo || `Resposta não reconhecida do gateway (HTTP ${r.ok ? 200 : "erro"}).`,
      cru: d,
    };
  }

  async cancelar(
    chave: string,
    justificativa: string,
    ambiente: 1 | 2,
  ): Promise<RespostaCancelamento> {
    try {
      const r = await this.chamar(`/cte/${chave}/cancelamento`, { ambiente, justificativa });
      const d = r.dados ?? {};
      const protocolo = d.protocolo ?? d.protocol ?? null;
      if (r.ok && protocolo) {
        return {
          situacao: "CANCELADO",
          protocolo: String(protocolo),
          canceladoEm: d.canceladoEm ? new Date(d.canceladoEm) : new Date(),
          cru: d,
        };
      }
      return {
        situacao: "ERRO",
        motivo: String(d.mensagem ?? d.motivo ?? "Cancelamento não confirmado."),
        cru: d,
      };
    } catch (e) {
      return { situacao: "ERRO", motivo: (e as Error).message, cru: null };
    }
  }
}

// ---------------------------------------------------------------------------
// Nível 3 sem intermediário — direto na SEFAZ
// ---------------------------------------------------------------------------

/**
 * Nós assinamos e nós falamos com a SEFAZ.
 *
 * Duas coisas que só se descobrem tentando, e que estão resolvidas no
 * `sefaz.ts`: a cadeia do servidor é ICP-Brasil (raiz que nenhum sistema
 * operacional traz) e o A1 é exigido no próprio handshake — sem ele a conexão
 * cai antes de qualquer resposta.
 *
 * O CT-e 4.00 é síncrono: a autorização vem na resposta da mesma chamada, o que
 * simplifica bastante em relação ao fluxo antigo de recibo e consulta.
 */
export class SefazDireto implements EmissorCte {
  readonly nome = "SEFAZ" as const;

  /**
   * O que guardar quando a SEFAZ responde — qualquer que seja a resposta.
   *
   * Inclui o envelope ENVIADO e o corpo CRU, e não só o miolo interpretado:
   * quando a resposta não é SOAP (um 400 do IIS, por exemplo), o miolo vem
   * vazio e o diagnóstico some exatamente onde ele fazia falta.
   */
  private diagnostico(r: {
    url: string;
    httpStatus: number;
    enviado: string;
    bruto: string;
    xml: string;
  }) {
    const corte = (t: string) => (t.length > 20_000 ? `${t.slice(0, 20_000)}…` : t);
    return {
      url: r.url,
      httpStatus: r.httpStatus,
      enviado: corte(r.enviado),
      resposta: corte(r.bruto),
    };
  }

  constructor(
    private readonly cert: Certificado,
    private readonly pfx: Buffer,
    private readonly senha: string,
    private readonly uf: string,
  ) {}

  private cliente() {
    return new ClienteSefaz(this.cert, this.pfx, this.senha);
  }

  async emitir(cte: CteMontado, ambiente: 1 | 2): Promise<RespostaEmissao> {
    let xmlAssinado: string;
    try {
      xmlAssinado = assinarCte(gerarXmlCte(cte), this.cert).xml;
    } catch (e) {
      // Falha de assinatura é problema NOSSO, não rejeição da SEFAZ: o
      // documento nem saiu daqui.
      return { situacao: "ERRO", motivo: `Não deu pra assinar: ${(e as Error).message}`, cru: null };
    }

    let r: Awaited<ReturnType<ClienteSefaz["enviarCte"]>>;
    try {
      r = await this.cliente().enviarCte(this.uf, ambiente, xmlAssinado);
    } catch (e) {
      // Rede, TLS, timeout: não é rejeição. Marcar como rejeitado faria alguém
      // "corrigir" um documento que estava certo.
      return { situacao: "ERRO", motivo: (e as Error).message, cru: null };
    }

    // 100 = autorizado. Qualquer outro código com motivo é rejeição avaliada.
    if (r.cStat === "100") {
      const prot = r.xml.match(/<nProt>(\d+)<\/nProt>/)?.[1] ?? "";
      const dh = r.xml.match(/<dhRecbto>([^<]+)<\/dhRecbto>/)?.[1];
      return {
        situacao: "AUTORIZADO",
        protocolo: prot,
        autorizadoEm: dh ? new Date(dh) : new Date(),
        codigo: r.cStat,
        motivo: r.xMotivo ?? "Autorizado o uso do CT-e",
        // Guardamos o XML ASSINADO: é ele que tem valor, e é o que precisa ser
        // arquivado pelos cinco anos que a legislação pede.
        xml: xmlAssinado,
        cru: this.diagnostico(r),
      };
    }

    if (r.cStat) {
      return {
        situacao: "REJEITADO",
        codigo: r.cStat,
        motivo: r.xMotivo ?? "Rejeitado sem motivo informado",
        cru: this.diagnostico(r),
      };
    }

    return {
      situacao: "ERRO",
      motivo: `A SEFAZ respondeu algo que não reconheço (HTTP ${r.httpStatus}).`,
      cru: this.diagnostico(r),
    };
  }

  /**
   * Cancela — que é um EVENTO (110111), não uma operação sobre o CT-e.
   *
   * Um CT-e autorizado não se apaga: o que existe é um documento novo, assinado
   * à parte, que se pendura na chave. Por isso ele precisa do PROTOCOLO da
   * autorização que está desfazendo, e não só da chave.
   */
  async cancelar(
    chave: string,
    justificativa: string,
    ambiente: 1 | 2,
    protocolo?: string,
  ): Promise<RespostaCancelamento> {
    if (!protocolo) {
      return {
        situacao: "ERRO",
        motivo: "Sem o protocolo da autorização não dá pra cancelar — é ele que a SEFAZ confere.",
        cru: null,
      };
    }

    let assinado: string;
    try {
      const { xml } = gerarCancelamento({
        chave,
        cnpjEmitente: this.cert.cnpj ?? "",
        uf: this.uf,
        ambiente,
        protocolo,
        justificativa,
      });
      assinado = assinarCte(xml, this.cert).xml;
    } catch (e) {
      return { situacao: "ERRO", motivo: (e as Error).message, cru: null };
    }

    try {
      const r = await this.cliente().enviarEvento(this.uf, ambiente, assinado);
      // 135 = evento vinculado e registrado. 134/136 também são aceitos em
      // alguns fluxos, mas só o 135 confirma o cancelamento do documento.
      if (r.cStat === "135") {
        return {
          situacao: "CANCELADO",
          protocolo: r.xml.match(/<nProt>(\d+)<\/nProt>/)?.[1] ?? "",
          canceladoEm: new Date(),
          cru: this.diagnostico(r),
        };
      }
      return {
        situacao: "ERRO",
        motivo: `${r.cStat ?? "?"} — ${r.xMotivo ?? "a SEFAZ não confirmou o cancelamento."}`,
        cru: this.diagnostico(r),
      };
    } catch (e) {
      return { situacao: "ERRO", motivo: (e as Error).message, cru: null };
    }
  }

  /** "A SEFAZ está no ar, e o meu certificado serve?" */
  async status(ambiente: 1 | 2) {
    return this.cliente().statusDoServico(this.uf, ambiente);
  }
}
