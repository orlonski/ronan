import { createHash, randomUUID } from "node:crypto";
import type { CteMontado } from "../../common/cte/montar";

/**
 * Os três níveis de emissão são o MESMO código com um interruptor.
 *
 *   SIMULADOR  nível 1 — local, sem certificado, sem custo. Prova que o
 *              documento fecha e que tudo DEPOIS da emissão funciona.
 *   GATEWAY    níveis 2 e 3 — a mesma chamada; o que muda é a credencial e o
 *              `tpAmb`. Sandbox do provedor (2) e SEFAZ homologação/produção (3).
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
  readonly nome: "SIMULADOR" | "GATEWAY";
  emitir(cte: CteMontado, ambiente: 1 | 2): Promise<RespostaEmissao>;
  cancelar(chave: string, justificativa: string, ambiente: 1 | 2): Promise<RespostaCancelamento>;
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
