import { describe, expect, it } from "vitest";
import { calcularAchados, type Achado, type EntradaPlaca, type PassagemComFatos } from "./achados";
import { px, semOsrm } from "./cenario";
import { cortarTrechos, viagensInferidas, type PassagemFisica } from "./trechos";

/**
 * Uma passagem, um balde (04-qa B2), com cenários inventados que reproduzem
 * os casos da fatura de prova: vale parcial com a praça nos dois sentidos,
 * passagem fora do período, viagem em dois trechos, eixo que sobe e desce.
 */

const fatos = (p: PassagemFisica, extra: Partial<PassagemComFatos> = {}): PassagemComFatos => ({
  ...p,
  extratoId: "E1",
  dc: "D",
  foraDoPeriodo: false,
  cobradaEmOutraFatura: null,
  ...extra,
});

function placa(ps: PassagemComFatos[], extra: Partial<EntradaPlaca> = {}, eixos = 7): EntradaPlaca {
  const trechos = cortarTrechos(ps, eixos, semOsrm);
  return {
    placa: ps[0]!.placa,
    eixosCarregado: eixos,
    eixosComposicao: null,
    eixosSuspensosVazio: null,
    passagens: ps,
    linhasVale: ps.filter((p) => p.fonte === "VALE").flatMap((p) => [p, { ...p, id: `${p.id}c`, dc: "C" as const }]),
    trechos,
    viagens: viagensInferidas(trechos),
    valeNaoConfiavel: false,
    ...extra,
  };
}

const KMS = new Map([["BR364", [214400, 316550, 383100, 479100, 579100]]]);
const achar = (pls: EntradaPlaca[]) => calcularAchados({ placas: pls, ajustes: [], taxas: [], kmsConhecidos: KMS });

/** Nenhuma passagem em dois achados, e nenhum total soma a mesma duas vezes. */
function umBaldePorPassagem(as: Achado[]) {
  const vistos = new Map<string, string>();
  for (const a of as)
    for (const id of a.passagemIds) {
      expect(vistos.get(id), `passagem ${id} em ${vistos.get(id)} e ${a.tipo}`).toBeUndefined();
      vistos.set(id, a.tipo);
    }
}

describe("achados da tag", () => {
  it("vale parcial + a praça nos dois sentidos em 2 min viram UM achado com duas explicações", () => {
    const vazio = fatos(px("AAA", "28/05 17:24", "JG", "NORTE", 4, 3240));
    const nN = fatos(px("AAA", "29/05 09:30", "NB", "NORTE", 7, 4690));
    const nS = fatos(px("AAA", "29/05 09:32", "NB", "SUL", 7, 4690));
    const vJ = fatos(px("AAA", "29/05 12:50", "JG", "SUL", 7, 5670, "VALE", "VP1"));
    const vS = fatos(px("AAA", "29/05 14:40", "SA", "SUL", 7, 4200, "VALE", "VP1"));
    const cv = fatos(px("AAA", "29/05 16:30", "CV", "SUL", 7, 4200));
    const volta = fatos(px("AAA", "29/05 19:40", "CV", "NORTE", 5, 3000));
    const as = achar([placa([vazio, nN, nS, vJ, vS, cv, volta])]);
    umBaldePorPassagem(as);

    // Campo Verde, depois da 1ª praça coberta pelo vale: provável.
    const parcial = as.find((a) => a.tipo === "VALE_PARCIAL")!;
    expect(parcial).toMatchObject({ caixa: "PODE_SER_SEU", valorCent: 4200, passagemIds: [cv.id] });

    // Nobres: antes do vale (conferir a origem) × leitura dupla — um achado só,
    // contado UMA vez, e a pessoa escolhe a explicação.
    const ex = as.find((a) => a.tipo === "EXPLICACOES_POSSIVEIS")!;
    expect(ex.caixa).toBe("PRA_CONTESTAR");
    expect(ex.valorCent).toBe(4690);
    expect(new Set(ex.passagemIds)).toEqual(new Set([nN.id, nS.id]));
    expect(ex.explicacoes).toHaveLength(2);

    // Viagem COM vale nunca entra em "carregado sem vale".
    expect(as.some((a) => a.tipo === "CARREGADO_SEM_VALE")).toBe(false);
  });

  it("carregado sem vale: UMA pergunta por viagem, mesmo com a viagem em dois trechos", () => {
    const ps = [
      fatos(px("BBB", "31/05 11:20", "ROS", "OESTE", 7, 7980)),
      fatos(px("BBB", "31/05 12:00", "JG", "SUL", 7, 5670)),
      fatos(px("BBB", "31/05 19:00", "SA", "SUL", 7, 4200)), // 7 h parado
      fatos(px("BBB", "31/05 20:10", "CV", "SUL", 7, 4200)),
    ];
    const as = achar([placa(ps)]);
    const c = as.filter((a) => a.tipo === "CARREGADO_SEM_VALE");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ caixa: "PODE_SER_SEU", valorCent: 7980 + 5670 + 4200 + 4200, ancoraId: ps[0]!.id });
  });

  it("passagem fora do período fica no balde do documento, não no 'até R$'", () => {
    const fora = fatos(px("BBB", "28/04 11:13", "JG", "SUL", 7, 5670), { foraDoPeriodo: true });
    const dentro = fatos(px("BBB", "02/05 09:03", "NB", "NORTE", 7, 4690));
    const as = achar([placa([fora, dentro])]);
    umBaldePorPassagem(as);
    expect(as.find((a) => a.passagemIds.includes(fora.id))!.tipo).toBe("FORA_DO_PERIODO");
    const c = as.filter((a) => a.tipo === "CARREGADO_SEM_VALE");
    expect(c).toHaveLength(1);
    expect(c[0]!.passagemIds).toEqual([dentro.id]);
  });

  it("cobrada em outra fatura vence o fora do período", () => {
    const p = fatos(px("BBB", "28/04 11:13", "JG", "SUL", 7, 5670), { foraDoPeriodo: true, cobradaEmOutraFatura: { numeroFatura: "123" } });
    const as = achar([placa([p])]);
    expect(as.map((a) => a.tipo)).toEqual(["COBRADA_EM_OUTRA_FATURA"]);
  });

  it("eixo que sobe e desce entre vazios: carregado curto OU eixo a mais — um achado só", () => {
    const ps = [
      fatos(px("AAA", "14/05 07:30", "ROO", "NORTE", 4, 3000)),
      fatos(px("AAA", "14/05 09:30", "CV", "NORTE", 4, 2400)),
      fatos(px("AAA", "14/05 10:25", "SA", "NORTE", 7, 4200)),
      fatos(px("AAA", "14/05 15:07", "JG", "NORTE", 4, 3240)),
    ];
    const as = achar([placa(ps)]);
    umBaldePorPassagem(as);
    const ex = as.find((a) => a.passagemIds.includes(ps[2]!.id))!;
    expect(ex.tipo).toBe("EXPLICACOES_POSSIVEIS");
    expect(ex.valorCent).toBe(4200);
  });

  it("praça pulada: com troca de eixo é 'carregou no caminho' (nada); sem troca, conversa sem valor", () => {
    const comTroca = [fatos(px("BBB", "18/05 09:51", "ROO", "NORTE", 3, 2250)), fatos(px("BBB", "18/05 18:33", "SA", "NORTE", 7, 4200))];
    expect(achar([placa(comTroca)]).some((a) => a.tipo === "PRACA_PULADA")).toBe(false);
    const semTroca = [fatos(px("BBB", "18/05 09:51", "ROO", "NORTE", 3, 2250)), fatos(px("BBB", "18/05 12:33", "SA", "NORTE", 3, 1800))];
    const pul = achar([placa(semTroca)]).find((a) => a.tipo === "PRACA_PULADA")!;
    expect(pul).toMatchObject({ caixa: "PRA_CONVERSAR", valorCent: null });
  });

  it("duplicidade no mesmo sentido em 30 min é pra contestar, com prazo de 90 dias", () => {
    const a = fatos(px("CCC", "10/05 10:00", "NB", "NORTE", 4, 2680));
    const b = fatos(px("CCC", "10/05 10:12", "NB", "NORTE", 4, 2680));
    const d = achar([placa([a, b], {}, 6)]).find((x) => x.tipo === "DUPLICIDADE")!;
    expect(d.caixa).toBe("PRA_CONTESTAR");
    expect(d.prazoEm).toBe(a.t + 90 * 86_400_000);
  });

  it("vale sem par é dito — mas não quando a leitura do vale daquela placa falhou", () => {
    const v = fatos(px("AAA", "11/05 19:04", "NB", "SUL", 7, 4690, "VALE", "VP9"));
    const pl = placa([v]);
    pl.linhasVale = [v]; // só o D
    expect(achar([pl]).some((a) => a.tipo === "VALE_SEM_PAR")).toBe(true);
    expect(achar([{ ...pl, valeNaoConfiavel: true }]).some((a) => a.tipo === "VALE_SEM_PAR")).toBe(false);
  });

  it("eixo acima do cadastro é 'a conferir' — mas dentro de viagem sem vale fica no balde da viagem (B2)", () => {
    const vazio = fatos(px("AAA", "20/05 08:00", "JG", "NORTE", 4, 3240));
    const nove = fatos(px("AAA", "21/05 09:00", "NB", "SUL", 9, 6030));
    const semVale = achar([placa([vazio, nove], { eixosComposicao: 7, eixosSuspensosVazio: 4 })]);
    umBaldePorPassagem(semVale);
    expect(semVale.find((a) => a.passagemIds.includes(nove.id))!.tipo).toBe("CARREGADO_SEM_VALE");
    // Vazio com eixo a mais: conversa, e só existe com o cadastro confirmado.
    expect(semVale.find((a) => a.tipo === "EIXO_VAZIO_A_MAIS")).toMatchObject({ caixa: "PRA_CONVERSAR", valorCent: 810 });
    expect(achar([placa([vazio, nove])]).some((a) => a.tipo === "EIXO_VAZIO_A_MAIS")).toBe(false);

    // Na viagem com vale, a passagem no sentido oposto ao vale não é do vale: aí o eixo aparece.
    const vale = fatos(px("AAA", "21/05 08:00", "JG", "SUL", 7, 5670, "VALE", "VP3"));
    const nove2 = fatos(px("AAA", "21/05 10:00", "NB", "NORTE", 9, 6030));
    const comVale = achar([placa([vazio, vale, nove2], { eixosComposicao: 7, eixosSuspensosVazio: 4 })]);
    expect(comVale.find((a) => a.tipo === "EIXO_ACIMA_DO_CADASTRO")).toMatchObject({ caixa: "PRA_CONTESTAR", valorCent: 1340 });
  });

  it("ajuste não detalhado e taxas que não são pedágio entram sem passagem", () => {
    const as = calcularAchados({
      placas: [],
      ajustes: [{ extratoId: "E1", placa: "BBB", diferencaCent: -6480, qtdResumo: 69, qtdDetalhe: 68 }],
      taxas: [{ extratoId: "E1", itens: [{ descricao: "PARCERIA SERVIÇOS DE SAUDE", valorCent: 2370, qtd: 3 }] }],
      kmsConhecidos: KMS,
    });
    expect(as.find((a) => a.tipo === "AJUSTE_NAO_DETALHADO")).toMatchObject({ valorCent: 6480, caixa: "PRA_CONTESTAR" });
    expect(as.find((a) => a.tipo === "AJUSTE_NAO_DETALHADO")!.explicacao).toMatch(/a seu favor/);
    expect(as.find((a) => a.tipo === "TAXAS_NAO_PEDAGIO")).toMatchObject({ valorCent: 2370, caixa: "PRA_CONVERSAR" });
  });

  it("invariante: num mês inteiro de duas placas, nenhuma passagem cai em dois baldes", () => {
    const a = [
      fatos(px("AAA", "01/06 10:00", "JG", "NORTE", 4, 3240)),
      fatos(px("AAA", "01/06 12:00", "NB", "NORTE", 4, 2680)),
      fatos(px("AAA", "03/06 09:00", "NB", "NORTE", 7, 4690)),
      fatos(px("AAA", "03/06 09:05", "NB", "NORTE", 7, 4690)),
      fatos(px("AAA", "05/06 14:00", "NB", "SUL", 4, 2680)),
      fatos(px("AAA", "05/06 14:10", "NB", "NORTE", 4, 2680)),
      fatos(px("AAA", "06/06 10:00", "JG", "SUL", 7, 5670, "VALE", "VP2")),
      fatos(px("AAA", "06/06 12:00", "SA", "SUL", 7, 4200)),
      fatos(px("AAA", "06/06 13:30", "CV", "SUL", 7, 4200)),
    ];
    const b = [
      fatos(px("BBB", "30/05 23:00", "JG", "SUL", 7, 5670), { foraDoPeriodo: true }),
      fatos(px("BBB", "02/06 09:03", "NB", "NORTE", 7, 4690)),
      fatos(px("BBB", "02/06 15:00", "NB", "SUL", 3, 2010)),
      fatos(px("BBB", "02/06 18:00", "NB", "SUL", 7, 4690)),
    ];
    const as = achar([placa(a), placa(b)]);
    umBaldePorPassagem(as);
    const total = as.reduce((s, x) => s + (x.valorCent ?? 0), 0);
    const passagens = [...a, ...b].reduce((s, x) => s + x.valorCent, 0);
    expect(total).toBeLessThanOrEqual(passagens);
  });
});
