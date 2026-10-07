import { describe, expect, it } from "vitest";
import { lerCsvAntt, nomeNoMapa, pracasQueFaltamNoMapa, rodoviaNoMapa } from "./antt-sincronizacao";

const CSV = [
  "concessionaria;praca_de_pedagio;ano_do_pnv_snv;rodovia;uf;km_m;municipal;tipo_de_pista;sentido;situacao;data_da_inativacao;latitude;longitude",
  "NOVA ROTA DO OESTE;P7;2016;BR-163;MT;586.9;Nova Mutum;Principal;Crescente/Decrescente;Ativo;;-13.91952;-56.093419",
  "VIA BRASIL;P2 - Guarantã do Norte;2021;BR-163;MT;1089.45;Terra Nova do Norte;Principal;Crescente/Decrescente;Ativo;;-9.756473;-54.89443",
  "RIOSP;Itaguaí;2021;BR-101;RJ;414.9;Itaguaí;Principal;Crescente/Decrescente;Ativo;;-22.91;-43.89",
  "EPR PARANÁ;P01;2024;444;PR;3.3;Arapongas;Principal;Crescente/Decrescente;Ativo;;-23.4;-51.4",
  "VELHA;P9;2010;BR-116;SP;10;X;Principal;Crescente;Inativo;2020-01-01;-23.5;-46.6",
].join("\n");

describe("sincronização com a lista da ANTT", () => {
  it("lê o CSV pelas colunas, só as ativas, e marca coordenada arredondada", () => {
    const l = lerCsvAntt(CSV);
    expect(l.map((x) => x.municipio)).toEqual(["Nova Mutum", "Terra Nova do Norte", "Itaguaí", "Arapongas"]);
    expect(l.find((x) => x.municipio === "Nova Mutum")).toMatchObject({ rodovia: "BR-163", uf: "MT", km: 586.9, coordenadaPrecisa: true });
    expect(l.find((x) => x.municipio === "Itaguaí")!.coordenadaPrecisa).toBe(false);
  });

  it("arquivo sem as colunas esperadas não vira lista vazia que apaga tudo — vira nada", () => {
    expect(lerCsvAntt("a;b;c\n1;2;3")).toEqual([]);
  });

  it("só entra no mapa o que falta, com coordenada precisa, longe de praça já mapeada", () => {
    const l = lerCsvAntt(CSV);
    // O mapa já tem Nova Mutum (a 1 km).
    const faltam = pracasQueFaltamNoMapa(l, [{ lat: -13.925, lng: -56.09 }]);
    expect(faltam.map((x) => x.municipio)).toEqual(["Terra Nova do Norte"]);
  });

  it("rodovia só com número vai com as duas siglas; nome legível", () => {
    expect(rodoviaNoMapa({ rodovia: "444", uf: "PR" })).toBe("PR-444;BR-444");
    expect(rodoviaNoMapa({ rodovia: "BR-163", uf: "MT" })).toBe("BR-163");
    const [nm] = lerCsvAntt(CSV);
    expect(nomeNoMapa(nm!)).toBe("P7 (Nova Rota Do Oeste) — BR-163 km 586,9");
  });
});
