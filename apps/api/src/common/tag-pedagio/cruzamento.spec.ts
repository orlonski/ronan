import { describe, expect, it } from "vitest";
import { em, px, rota, semOsrm } from "./cenario";
import { CONFIG_CRUZAMENTO_PADRAO, cruzar, pracasEsperadasSemPassagem, type ViagemParaCruzar } from "./cruzamento";
import { cortarTrechos, eixosDeCarregado, viagensInferidas, type PassagemFisica } from "./trechos";

/**
 * Os casos difíceis da prova (05-prova-cruzamento.md §2.4), refeitos com
 * placas, dias e horários INVENTADOS. O critério é o da prova: ZERO ligação
 * automática errada — o que não tem certeza vira sugestão com o motivo.
 */

const AUTO = { ...CONFIG_CRUZAMENTO_PADRAO, ligacaoAutomatica: true };
const trechosDe = (ps: PassagemFisica[], eixos = 7) => cortarTrechos(ps, eixos, semOsrm);
const ida = rota(["ROS", null], ["JG", "SUL"], ["SA", "SUL"], ["CV", "SUL"], ["ROO", "SUL"]);
const v = (id: string, placa: string, data: string | null, pracas: ViagemParaCruzar["pracas"], extra: Partial<ViagemParaCruzar> = {}): ViagemParaCruzar => ({
  id,
  placa,
  data,
  pracas,
  ...extra,
});

describe("trechos", () => {
  it("corta na troca de carga e na parada longa; não corta na meia-noite", () => {
    const ps = [
      px("AAA", "10/03 10:00", "NB", "NORTE", 4, 2680),
      px("AAA", "10/03 19:00", "JG", "SUL", 7, 5670), // carregou
      px("AAA", "10/03 21:20", "SA", "SUL", 7, 4200),
      px("AAA", "11/03 00:30", "CV", "SUL", 7, 4200), // parada longa (3 h p/ 66 km)
      px("AAA", "11/03 01:50", "ROO", "SUL", 7, 5250), // segue: atravessa a madrugada
    ];
    const ts = trechosDe(ps);
    expect(ts.map((t) => [t.estado, t.passagens.length, t.abriuPor])).toEqual([
      ["VAZIO", 1, "inicio"],
      ["CARREGADO", 2, "carregou"],
      ["CARREGADO", 2, "parada"],
    ]);
    // Dois trechos carregados seguidos, sem vazio, buraco < 8 h = UMA viagem.
    const vi = viagensInferidas(ts);
    expect(vi).toHaveLength(1);
    expect(vi[0]!.ancoraId).toBe(ps[1]!.id);
    expect(vi[0]!.valorTagCent).toBe(5670 + 4200 + 4200 + 5250);
  });

  it("eixos de carregado: a moda que se repete, nunca uma cobrança solta de 9 eixos", () => {
    const ps = [7, 7, 7, 7, 4, 4, 3, 9].map((e) => ({ eixos: e }));
    expect(eixosDeCarregado(ps)).toMatchObject({ eixos: 7, origem: "MODA" });
    expect(eixosDeCarregado(ps, 6)).toMatchObject({ eixos: 6, origem: "CADASTRO" });
  });
});

describe("cruzamento passagem × viagem", () => {
  it("viagem manual, mesmo dia, praças na ordem → liga sozinha (com a ligação automática ligada)", () => {
    const ts = trechosDe([
      px("AAA", "05/03 12:10", "JG", "SUL", 7, 5670),
      px("AAA", "05/03 14:30", "SA", "SUL", 7, 4200),
      px("AAA", "05/03 15:40", "CV", "SUL", 7, 4200),
    ]);
    const r = cruzar(ts, [v("V1", "AAA", "2027-03-05", ida)], AUTO).get(ts[0]!.ancoraId)!;
    expect(r).toMatchObject({ status: "AUTO", viagemId: "V1" });
    expect(r.candidatas[0]!.razao).toBe("3 de 3 praças da rota, na ordem, mesmo dia");
  });

  it("no 1º mês (padrão) o que ligaria sozinho vira sugestão destacada", () => {
    const ts = trechosDe([px("AAA", "05/03 12:10", "JG", "SUL", 7, 5670), px("AAA", "05/03 14:30", "SA", "SUL", 7, 4200)]);
    const r = cruzar(ts, [v("V1", "AAA", "2027-03-05", ida)]).get(ts[0]!.ancoraId)!;
    expect(r).toMatchObject({ status: "SUGESTAO", viagemId: "V1", ligariaSozinho: true, motivo: "o sistema ligaria sozinho" });
  });

  it("data de um dia de diferença NUNCA liga sozinha", () => {
    const ts = trechosDe([px("AAA", "05/03 17:00", "JG", "SUL", 7, 5670), px("AAA", "05/03 19:00", "SA", "SUL", 7, 4200)]);
    const r = cruzar(ts, [v("V1", "AAA", "2027-03-06", ida)], AUTO).get(ts[0]!.ancoraId)!;
    expect(r.status).toBe("SUGESTAO");
    expect(r.ligariaSozinho).toBe(false);
    expect(r.motivo).toMatch(/um dia de diferença/);
  });

  it("três viagens no dia, só duas por praça: as praças separam, não a hora", () => {
    const ps = [
      px("BBB", "17/04 14:10", "ROS", "OESTE", 7, 7980),
      px("BBB", "17/04 15:10", "JG", "SUL", 7, 5670),
      px("BBB", "17/04 17:15", "SA", "SUL", 7, 4200),
      px("BBB", "17/04 21:35", "CV", "SUL", 7, 4200), // 4 h parado
      px("BBB", "17/04 23:20", "ROO", "SUL", 7, 5250),
    ];
    const ts = trechosDe(ps);
    expect(ts).toHaveLength(2);
    const viagens = [
      v("URBANA", "BBB", "2027-04-17", []),
      v("V15", "BBB", "2027-04-17", rota(["ROS", null], ["JG", "SUL"], ["SA", "SUL"])),
      v("V16", "BBB", "2027-04-17", rota(["CV", "SUL"], ["ROO", "SUL"])),
    ];
    const res = cruzar(ts, viagens, AUTO);
    expect(res.get(ts[0]!.ancoraId)).toMatchObject({ status: "AUTO", viagemId: "V15" });
    expect(res.get(ts[1]!.ancoraId)).toMatchObject({ status: "AUTO", viagemId: "V16" });
  });

  it("praças na ordem contrária da rota = é a volta: a viagem nem é candidata", () => {
    const ts = trechosDe([px("AAA", "05/03 08:00", "CV", "NORTE", 7, 4200), px("AAA", "05/03 09:10", "SA", "NORTE", 7, 4200)]);
    const r = cruzar(ts, [v("V1", "AAA", "2027-03-05", ida)], AUTO).get(ts[0]!.ancoraId)!;
    expect(r.status).toBe("SOBRA");
  });

  it("lançamento duplicado: empate vira sugestão, nunca cara ou coroa", () => {
    const ts = trechosDe([px("BBB", "03/04 11:00", "NB", "NORTE", 7, 4690)]);
    const r = rota(["NB", "NORTE"]);
    const res = cruzar(ts, [v("V10", "BBB", "2027-04-03", r), v("V26", "BBB", "2027-04-03", r)], AUTO);
    expect(res.get(ts[0]!.ancoraId)!.status).toBe("SUGESTAO");
    expect(res.get(ts[0]!.ancoraId)!.motivo).toMatch(/empate/);
  });

  it("comboio: outro caminhão passou junto e não tem viagem → 'confira a placa'", () => {
    const tA = trechosDe([px("AAA", "03/04 09:01", "NB", "NORTE", 7, 4690)]);
    const tC = trechosDe([px("CCC", "03/04 09:00", "NB", "NORTE", 6, 4020)], 6);
    const res = cruzar([...tA, ...tC], [v("V27", "AAA", "2027-04-03", rota(["NB", "NORTE"]))], AUTO);
    expect(res.get(tA[0]!.ancoraId)).toMatchObject({ status: "SUGESTAO", viagemId: "V27" });
    expect(res.get(tA[0]!.ancoraId)!.motivo).toMatch(/comboio.*confira a placa/);
  });

  it("contiguidade: dois trechos com um vazio no meio não grudam na mesma viagem", () => {
    const ts = trechosDe([
      px("BBB", "02/04 09:03", "NB", "NORTE", 7, 4690),
      px("BBB", "03/04 07:38", "NB", "SUL", 3, 2010),
      px("BBB", "03/04 11:19", "NB", "NORTE", 7, 4690),
    ]);
    const guiada = v("VG", "BBB", null, rota(["NB", "NORTE"]), { ini: em("02/04 08:00"), fim: em("03/04 12:00") });
    const res = cruzar(ts, [guiada], AUTO);
    const carregados = ts.filter((t) => t.estado === "CARREGADO").map((t) => res.get(t.ancoraId)!);
    expect(carregados.filter((r) => r.status === "AUTO")).toHaveLength(0);
    expect(carregados.every((r) => r.status === "SUGESTAO")).toBe(true);
  });

  it("madrugada seguinte liga (lançada no dia 10, passou dia 11 às 05h)", () => {
    const ts = trechosDe([px("CCC", "11/04 05:07", "NB", "SUL", 6, 4020), px("CCC", "11/04 06:20", "JG", "SUL", 6, 4860)], 6);
    const r = cruzar(ts, [v("V23", "CCC", "2027-04-10", rota(["NB", "SUL"], ["JG", "SUL"]))], AUTO).get(ts[0]!.ancoraId)!;
    expect(r).toMatchObject({ status: "AUTO", viagemId: "V23" });
  });

  it("só trecho carregado vira viagem; o vazio depois vira RETORNO dela", () => {
    const ps = [
      px("BBB", "19/04 12:10", "ROS", "OESTE", 7, 7980),
      px("BBB", "19/04 13:00", "JG", "SUL", 7, 5670),
      px("BBB", "19/04 15:20", "SA", "SUL", 7, 4200),
      px("BBB", "20/04 10:39", "ROO", "NORTE", 3, 2250),
      px("BBB", "20/04 12:10", "CV", "NORTE", 3, 1800),
    ];
    const ts = trechosDe(ps);
    const res = cruzar(ts, [v("V18", "BBB", "2027-04-19", ida)], AUTO);
    expect(res.get(ts[0]!.ancoraId)).toMatchObject({ status: "AUTO", viagemId: "V18" });
    expect(res.get(ts[1]!.ancoraId)).toMatchObject({ status: "RETORNO", viagemId: "V18" });
  });

  it("vazio sem viagem por perto fica solto, e trecho carregado sem candidata é SOBRA", () => {
    const ts = trechosDe([px("BBB", "21/04 04:37", "JG", "NORTE", 3, 2430), px("BBB", "25/04 10:00", "NB", "NORTE", 7, 4690)]);
    const res = cruzar(ts, [], AUTO);
    expect(res.get(ts[0]!.ancoraId)!.status).toBe("VAZIO_SOLTO");
    expect(res.get(ts[1]!.ancoraId)!.status).toBe("SOBRA");
  });

  it("praça na rota que a tag não cobrou aparece como esperada sem passagem", () => {
    const ts = trechosDe([px("BBB", "18/04 18:33", "SA", "NORTE", 7, 4200)]);
    const viagem = v("V17", "BBB", "2027-04-18", rota(["CV", "NORTE"], ["SA", "NORTE"]));
    expect(pracasEsperadasSemPassagem(viagem, ts)).toEqual(["BR364|316550"]);
  });

  it("a viagem de outro caminhão nunca é candidata", () => {
    const ts = trechosDe([px("AAA", "05/03 12:10", "JG", "SUL", 7, 5670)]);
    expect(cruzar(ts, [v("V1", "ZZZ", "2027-03-05", ida)], AUTO).get(ts[0]!.ancoraId)!.status).toBe("SOBRA");
  });
});
