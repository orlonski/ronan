/**
 * Monta o TEXTO de uma fatura Sem Parar com o mesmo layout que o `pdf-parse`
 * devolve — pra testar o leitor sem o arquivo de cliente nenhum. Placas,
 * empresa, CNPJ, números e embarcadores são INVENTADOS; as praças são as
 * públicas (concessionária, rodovia, km, cidade).
 *
 * ⚠️ Nunca commitar o PDF nem o texto de uma fatura real.
 */

export type PassagemSintetica = {
  data: string; // dd/mm/aa
  hora: string;
  conc: string;
  praca: string; // "BR364, KM479+100, NORTE, JANGADA"
  cat: number;
  valor: number; // centavos
  dc?: "D" | "C";
};

export type ValeSintetico = Omit<PassagemSintetica, "conc"> & { conc: string; embarcador: [string, string]; viagem: string };

export type PlacaSintetica = {
  placa: string;
  passagens: PassagemSintetica[];
  /** Cada vale vira duas linhas: C (crédito, sem concessionária) e D. */
  vales?: ValeSintetico[];
  /** Diferença que o resumo cobra e o detalhe não mostra (centavos, qtd). */
  ajusteResumo?: { valor: number; qtd: number };
};

export type FaturaSintetica = {
  numeroFatura?: string;
  cnpj?: string;
  nome?: string;
  periodo?: [string, string]; // "31/08", "30/09"
  emissao?: string; // dd/mm/aa
  placas: PlacaSintetica[];
};

const R = (c: number) => {
  const neg = c < 0;
  const [i, d] = (Math.abs(c) / 100).toFixed(2).split(".");
  return `${neg ? "-" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
};

const PLANO = [
  ["PRÉ-PAGO EMPRESARIAL EXEMPLO", 4585],
  ["PARCERIA SERVIÇOS DE SAUDE", 790],
  ["MONITORAMENTO DÉBITO VEICULAR", 790],
] as const;
const PLANO_TOTAL = PLANO.reduce((s, [, v]) => s + v, 0);
const GESTOR = 390;
const CODIGO = "87654321";

export function textoDaFatura(f: FaturaSintetica): string {
  const [de, ate] = f.periodo ?? ["31/08", "30/09"];
  const nPag = f.placas.length + 2;
  let pag = 1;
  const L: string[] = [];
  const quebra = () => {
    L.push(`${pag}/${nPag}`, CODIGO, "", `-- ${pag} of ${nPag} --`, "");
    pag++;
  };
  L.push(
    "SEM PARAR INSTITUIÇÃO DE PAGAMENTO LTDA.",
    "Av. Exemplo, 100, Andar 1",
    "CEP: 00000-000 - Centro - São Paulo - SP",
    "CNPJ/MF: 11.111.111/0001-11 - Insc. Municipal nº 1.111.111-1",
    "Olá Exemplo,",
    "Este é o seu extrato para simples",
    "conferência dos serviços e recargas",
    `do período de ${de} a ${ate}`,
    `Nome: ${f.nome ?? "Transportadora Exemplo Ltda"}`,
    `CNPJ: ${f.cnpj ?? "12.345.678/0002-90"}`,
    "E-mail: contato@exemplo.invalid",
    ...(f.numeroFatura === "" ? [] : [`Nº da Fatura: ${f.numeroFatura ?? "99990000001"}`]),
    "Nº da Nota Fiscal: 123456789",
    `Código de Cliente: ${CODIGO}`,
    "Banco/Agência: 000/0001",
    `Data de Emissão: ${f.emissao ?? "30/09/26"}`,
  );
  quebra();
  L.push("Recargas R$", "31/08/26 VALOR RECARGA 1.500,00 C", "Resumo por Veículo R$", "Placa Plano Contratado Uso (R$) Qtd Uso Total");
  const usos = f.placas.map((p) => {
    const tag = p.passagens.reduce((s, x) => s + (x.dc === "C" ? -x.valor : x.valor), 0);
    const vale = 0; // pares C/D se anulam
    const qtd = p.passagens.length + (p.vales?.length ?? 0) * 2 + (p.ajusteResumo?.qtd ?? 0);
    return { placa: p.placa, uso: tag + vale + (p.ajusteResumo?.valor ?? 0), qtd };
  });
  for (const u of usos) L.push(`${u.placa} ${R(PLANO_TOTAL)} D ${R(u.uso)} D ${u.qtd} ${R(PLANO_TOTAL + u.uso)} D`);
  const usoTotal = usos.reduce((s, u) => s + u.uso, 0);
  const qtdTotal = usos.reduce((s, u) => s + u.qtd, 0);
  const planoTotal = PLANO_TOTAL * f.placas.length;
  L.push(`Total ${R(planoTotal)} D ${R(usoTotal)} D ${qtdTotal} ${R(planoTotal + usoTotal)} D`);
  L.push("Plano Contratado", "Placa Tipo Período Descrição R$");
  for (const p of f.placas) {
    PLANO.forEach(([d, v], i) =>
      L.push(`${i === 0 ? `${p.placa} PLANO CONTRATADO ` : ""}01/09/2026 a 30/09/2026 ${d} ${R(v)} D`),
    );
  }
  for (const p of f.placas) {
    L.push(`${p.placa} - PRÉ-PAGO EMPRESARIAL EXEMPLO`, "Detalhamento das Passagens por Pedágios", "Data Hora Concessionária Praça Cat R$");
    p.passagens.forEach((x, i) => {
      if (i > 0 && i % 25 === 0) {
        quebra();
        L.push("Detalhamento das Passagens por Pedágios", "Data Hora Concessionária Praça Cat R$");
      }
      L.push(`${x.data} ${x.hora} ${x.conc} ${x.praca} ${x.cat} ${R(x.valor)} ${x.dc ?? "D"}`);
    });
    const tot = p.passagens.reduce((s, x) => s + (x.dc === "C" ? -x.valor : x.valor), 0);
    L.push(`Total de Pedágio ${R(tot)} D`);
    if (p.vales?.length) {
      L.push("Detalhamento das Passagens Vale Pedágio", "Data Hora Concessionária Embarcador Praça Cat Viagem R$");
      for (const v of p.vales) {
        for (const dc of ["C", "D"] as const) {
          const fim = `${v.cat} ${v.viagem} ${R(v.valor)} ${dc}`;
          L.push(`${v.data} ${v.hora} ${dc === "D" ? `${v.conc} ` : ""}${v.embarcador[0]}`, v.embarcador[1]);
          // Praça longa quebra em duas linhas e o fim vai sozinho, como no PDF.
          if (v.praca.length > 32) {
            const corte = v.praca.lastIndexOf(" ", 32);
            L.push(v.praca.slice(0, corte), v.praca.slice(corte + 1), fim);
          } else {
            L.push(`${v.praca} ${fim}`);
          }
        }
      }
      L.push("Total de Vale Pedágio 0,00");
    }
    L.push("Outras arrecadações", "Data Descrição R$", `01/09/26 GESTOR DE DEBITOS ${R(GESTOR)} D`, `Total de outras arrecadações ${R(GESTOR)} D`);
    quebra();
  }
  const outras = GESTOR * f.placas.length;
  L.push(
    "Valores Tributáveis R$",
    "Descrição Qtd Valor",
    `Plano Contratado ${f.placas.length} ${R(planoTotal)} D`,
    `Total ${R(planoTotal)} D`,
    "Valores não Tributáveis R$",
    "Descrição Qtd Valor",
    `Outras Taxas ${f.placas.length} ${R(outras)} D`,
    `Passagens ${qtdTotal} ${R(usoTotal)} D`,
    `Total não Tributável ${R(outras + usoTotal)} D`,
    "Impostos Retidos 0,00",
    `Total da Nota Fiscal ${R(planoTotal + outras + usoTotal)} D`,
    "C = crédito / D = débito.",
  );
  quebra();
  return L.join("\n");
}

/** Uma fatura de exemplo com três placas, vale-pedágio e um ajuste no resumo. */
export function faturaExemplo(): FaturaSintetica {
  const NRO = "NOVA ROTA DO OESTE";
  const VB = "VIA BRASIL MT 246";
  const EV = "ECOVIAS DO ARAGUAIA";
  return {
    placas: [
      {
        placa: "TST1A23",
        passagens: [
          { data: "01/09/26", hora: "10:41:12", conc: NRO, praca: "BR364, KM479+100, NORTE, JANGADA", cat: 4, valor: 3240 },
          { data: "01/09/26", hora: "13:06:45", conc: NRO, praca: "BR364, KM579+100, NORTE, NOBRES", cat: 4, valor: 2680 },
          { data: "04/09/26", hora: "08:50:31", conc: NRO, praca: "BR364, KM579+100, NORTE, NOBRES", cat: 61, valor: 4690 },
          { data: "18/09/26", hora: "13:19:10", conc: VB, praca: "MT246, KM107+000, OESTE, TANGARÁ DA SERRA", cat: 4, valor: 4560 },
          { data: "18/09/26", hora: "17:46:41", conc: VB, praca: "MT246, KM119+000, OESTE, ROSÁRIO DO OESTE", cat: 61, valor: 7980 },
          { data: "18/09/26", hora: "18:22:23", conc: NRO, praca: "BR364, KM479+100, SUL, JANGADA", cat: 61, valor: 5670 },
          { data: "18/09/26", hora: "20:46:28", conc: NRO, praca: "BR364, KM383+100, SUL, SANTO ANTÔNIO LEVERGER", cat: 61, valor: 4200 },
          { data: "30/09/26", hora: "09:26:52", conc: NRO, praca: "BR364, KM579+100, NORTE, NOBRES", cat: 61, valor: 4690 },
          { data: "30/09/26", hora: "09:28:36", conc: NRO, praca: "BR364, KM579+100, SUL, NOBRES", cat: 61, valor: 4690 },
          { data: "30/09/26", hora: "16:28:09", conc: NRO, praca: "BR364, KM316+550, SUL, CAMPO VERDE", cat: 61, valor: 4200 },
          { data: "30/09/26", hora: "19:36:26", conc: NRO, praca: "BR364, KM316+550, NORTE, CAMPO VERDE", cat: 5, valor: 3000 },
        ],
        vales: [
          { data: "30/09/26", hora: "12:47:25", conc: NRO, embarcador: ["ALFA CEREAIS", "COMERC"], praca: "BR364, KM479+100, SUL, JANGADA", cat: 61, viagem: "900000001", valor: 5670 },
          { data: "30/09/26", hora: "14:37:05", conc: NRO, embarcador: ["ALFA CEREAIS", "COMERC"], praca: "BR364, KM383+100, SUL, SANTO ANTÔNIO LEVERGER", cat: 61, viagem: "900000001", valor: 4200 },
        ],
      },
      {
        placa: "TST2B34",
        passagens: [
          { data: "29/08/26", hora: "11:01:36", conc: NRO, praca: "BR364, KM479+100, SUL, JANGADA", cat: 61, valor: 5670 },
          { data: "03/09/26", hora: "08:51:36", conc: NRO, praca: "BR364, KM579+100, NORTE, NOBRES", cat: 61, valor: 4690 },
          { data: "04/09/26", hora: "07:26:36", conc: NRO, praca: "BR364, KM579+100, SUL, NOBRES", cat: 3, valor: 2010 },
          { data: "04/09/26", hora: "11:07:36", conc: NRO, praca: "BR364, KM579+100, NORTE, NOBRES", cat: 61, valor: 4690 },
        ],
        ajusteResumo: { valor: -6480, qtd: 1 },
      },
      {
        placa: "TST3C45",
        passagens: [
          { data: "15/09/26", hora: "16:21:09", conc: EV, praca: "BR153, KM745+432, NORTE, ALVORADA", cat: 5, valor: 5890 },
          { data: "15/09/26", hora: "17:58:16", conc: EV, praca: "BR153, KM640+066, NORTE, ALIANÇA DO TOCANTINS", cat: 6, valor: 5415 },
          { data: "29/09/26", hora: "13:52:57", conc: EV, praca: "BR153, KM640+066, SUL, ALIANÇA DO TOCANTINS", cat: 6, valor: 5415 },
        ],
      },
    ],
  };
}
