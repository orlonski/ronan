import { describe, expect, it } from "vitest";
import {
  CriarViagemInput,
  camposFaltandoPeloModo,
  criarViagemInputDoModo,
  escolherModoDaLista,
  regrasDoModo,
} from "@ronan/shared-types";
import { carimbarFaltasDoModo } from "./tipo-servico";

/**
 * A RÉGUA DO MODO É UMA SÓ, NO APP E NA API.
 *
 * ⚠️ Conta com um modo só (o caso de toda empresa em produção) não mandava
 * tipoServicoId, e o app validava pelo clássico: o campo que a flag escondeu
 * ficava impossível de preencher e o salvar travava em "Informe o km rodado".
 */

const SEM_KM = regrasDoModo({ exigeKm: false, exigeLocalDescarga: false, exigeMaterial: false });

const BASE = {
  clientId: "8a0f3b8e-5f0e-4a57-9d7a-2b0c6a3f1e11",
  veiculoId: "8a0f3b8e-5f0e-4a57-9d7a-2b0c6a3f1e12",
  clienteId: "8a0f3b8e-5f0e-4a57-9d7a-2b0c6a3f1e13",
  localCargaId: "8a0f3b8e-5f0e-4a57-9d7a-2b0c6a3f1e14",
  data: "2026-09-20",
  toneladas: 30,
};

describe("regrasDoModo (compat on-read)", () => {
  it("modo ausente é o clássico: tudo exigido e pedágio à mostra", () => {
    expect(regrasDoModo(null)).toEqual({
      exigeMaterial: true,
      exigeTicket: true,
      exigeLocalDescarga: true,
      exigeKm: true,
      mostraPedagio: true,
    });
  });

  it("catálogo antigo sem mostraPedagio continua mostrando o pedágio", () => {
    expect(regrasDoModo({ exigeKm: false }).mostraPedagio).toBe(true);
    expect(regrasDoModo({ mostraPedagio: false }).mostraPedagio).toBe(false);
  });
});

describe("escolherModoDaLista", () => {
  const tipos = [
    { id: "a", padrao: false },
    { id: "b", padrao: true },
  ];
  it("o escolhido vence", () => expect(escolherModoDaLista(tipos, "a")?.id).toBe("a"));
  it("sem escolha (ou escolha que sumiu) cai no padrão", () => {
    expect(escolherModoDaLista(tipos, "")?.id).toBe("b");
    expect(escolherModoDaLista(tipos, "sumiu")?.id).toBe("b");
  });
  it("lista vazia ou sem padrão → nenhum (clássico)", () => {
    expect(escolherModoDaLista([], "a")).toBeNull();
    expect(escolherModoDaLista(undefined)).toBeNull();
    expect(escolherModoDaLista([{ id: "a" }])).toBeNull();
  });
});

describe("camposFaltandoPeloModo", () => {
  it("clássico cobra material, km e descarga", () => {
    const campos = camposFaltandoPeloModo({ toneladas: 30 }, regrasDoModo(null)).map((f) => f.campo);
    expect(campos).toEqual(["materialId", "km", "localDescargaId"]);
  });
  it("modo que dispensa não cobra", () => {
    expect(camposFaltandoPeloModo({ toneladas: 30 }, SEM_KM)).toEqual([]);
  });
  it("peso é sempre cobrado, menos no aguardando peso", () => {
    expect(camposFaltandoPeloModo({}, SEM_KM).map((f) => f.campo)).toEqual(["toneladas"]);
    expect(camposFaltandoPeloModo({ aguardandoPeso: true }, SEM_KM)).toEqual([]);
  });
});

describe("criarViagemInputDoModo — o que o app valida antes de enfileirar", () => {
  it("modo sem km aceita lançamento sem km, SEM precisar de tipoServicoId", () => {
    expect(criarViagemInputDoModo(SEM_KM).safeParse(BASE).success).toBe(true);
    // O schema antigo (sem modo conhecido) é o que travava o motorista.
    expect(CriarViagemInput.safeParse(BASE).success).toBe(false);
  });
  it("modo clássico segue recusando sem km, com a mesma mensagem", () => {
    const r = criarViagemInputDoModo(regrasDoModo(null)).safeParse({
      ...BASE,
      materialId: "8a0f3b8e-5f0e-4a57-9d7a-2b0c6a3f1e15",
      localDescargaId: "8a0f3b8e-5f0e-4a57-9d7a-2b0c6a3f1e16",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual(["Informe o km rodado."]);
  });
});

describe("carimbarFaltasDoModo (API) usa a mesma régua", () => {
  it("mapeia cada campo pro motivo de divergência", () => {
    const motivos: string[] = [];
    carimbarFaltasDoModo({ add: (m) => motivos.push(m) }, {}, regrasDoModo(null));
    expect(motivos).toEqual(["FALTA_TONELADAS", "FALTA_MATERIAL", "FALTA_KM", "FALTA_LOCAL_DESCARGA"]);
  });
  it("modo que dispensa não carimba", () => {
    const motivos: string[] = [];
    carimbarFaltasDoModo({ add: (m) => motivos.push(m) }, { toneladas: 30 }, SEM_KM);
    expect(motivos).toEqual([]);
  });
});
