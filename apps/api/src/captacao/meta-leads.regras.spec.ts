import { describe, expect, it } from "vitest";
import { frotaMinimaDaFaixa, lerEnvio, resumoDoEnvio } from "./meta-leads.regras";

// O formato que a Graph API devolve em `/{form_id}/leads` (field_data).
const ENVIO = {
  id: "1234567890",
  created_time: "2026-09-28T17:20:00+0000",
  form_id: "999",
  ad_id: "777",
  ad_name: "Fechamento do mês",
  campaign_name: "Teste 30 dias",
  field_data: [
    { name: "você_é_dono_ou_gestor_da_transportadora,_ou_motorista?", values: ["Dono ou sócio"] },
    { name: "quantos_caminhões_rodam_hoje?", values: ["6 a 15"] },
    { name: "full_name", values: ["Diego Orlonski"] },
    { name: "phone_number", values: ["+5542998424945"] },
  ],
};

describe("lerEnvio", () => {
  it("reconhece as perguntas pelo assunto, não pelo nome exato", () => {
    const l = lerEnvio(ENVIO);
    expect(l).toMatchObject({
      leadgenId: "1234567890",
      nome: "Diego Orlonski",
      telefone: "+5542998424945",
      funcao: "Dono ou sócio",
      frota: "6 a 15",
      motorista: false,
      qualificado: true,
      frotaMinima: 6,
    });
    expect(resumoDoEnvio(l)).toBe("Formulário do anúncio: Dono ou sócio, 6 a 15 caminhões.");
  });

  it("motorista nunca é qualificado, com qualquer frota", () => {
    const l = lerEnvio({
      ...ENVIO,
      field_data: [
        { name: "voce_e_dono_ou_gestor_da_transportadora_ou_motorista", values: ["Motorista"] },
        { name: "quantos_caminhoes_rodam_hoje", values: ["16 a 40"] },
      ],
    });
    expect(l.motorista).toBe(true);
    expect(l.qualificado).toBe(false);
  });

  it("frota de 1 a 2 não aciona ligação", () => {
    const l = lerEnvio({
      ...ENVIO,
      field_data: [
        { name: "voce_e_dono", values: ["Dono ou sócio"] },
        { name: "quantos_caminhoes", values: ["1 a 2"] },
      ],
    });
    expect(l.qualificado).toBe(false);
  });

  it("sobrevive a envio sem respostas", () => {
    expect(lerEnvio({ id: "1" })).toMatchObject({ nome: null, telefone: null, qualificado: false });
  });
});

it("resposta como chave da opção (como a Meta devolve de verdade) vira texto legível", () => {
  const l = lerEnvio({
    id: "2",
    field_data: [
      { name: "você_é_dono_ou_gestor_da_transportadora,_ou_motorista?", values: ["dono_ou_sócio"] },
      { name: "quantos_caminhões_rodam_hoje?", values: ["6_a_15"] },
      { name: "nome_completo", values: ["Diego Teste"] },
      { name: "telefone", values: ["+5542998424945"] },
    ],
  });
  expect(l).toMatchObject({ funcao: "Dono ou sócio", frota: "6 a 15", nome: "Diego Teste", telefone: "+5542998424945", qualificado: true });
});

describe("frotaMinimaDaFaixa", () => {
  it.each([
    ["1 a 2", 1],
    ["3 a 5", 3],
    ["Mais de 40", 41],
    [null, null],
  ])("%s → %s", (faixa, esperado) => {
    expect(frotaMinimaDaFaixa(faixa)).toBe(esperado);
  });
});
