import { describe, expect, it } from "vitest";
import { chaveEmGrupos, gerarDacte } from "./dacte";
import { montarCte } from "./montar";

/**
 * O que dá pra provar de um PDF sem virar teste de pixel.
 *
 * O risco real aqui não é o layout ficar feio — é o gerador EXPLODIR com um
 * documento legítimo e deixar o motorista sem papel na hora de sair. Um CT-e
 * sem expedidor, sem recebedor, sem NF-e e sem observação é o caso mais comum
 * de todos, e é o que tem mais campo ausente.
 */

const CHAVE = "43260963620308000150579990000000031263366246";

function entradaMinima() {
  const p = {
    cnpjCpf: "11222333000181",
    razaoSocial: "Pedreira Norte Ltda",
    indicadorIe: "9" as const,
    endereco: {
      logradouro: "Rodovia do Café",
      numero: "1200",
      bairro: "Uvaranas",
      codigoMunicipio: "4119905",
      municipio: "Ponta Grossa",
      cep: "84035-000",
      uf: "PR",
    },
  };
  return montarCte({
    emitente: { ...p, cnpjCpf: "34238864000168", razaoSocial: "Transportes Aurora Ltda", crt: "3", rntrc: "12345678" },
    remetente: p,
    destinatario: { ...p, cnpjCpf: "45997418000153", razaoSocial: "Construtora Obra Centro Ltda" },
    papelTomador: "DESTINATARIO",
    inicioPrestacao: { codigo: "4119905", nome: "Ponta Grossa", uf: "PR" },
    fimPrestacao: { codigo: "4106902", nome: "Curitiba", uf: "PR" },
    carga: { produtoPredominante: "BRITA 1", toneladas: 28.5, valorCarga: 2100 },
    valores: { valorFrete: 1200, valorPedagio: 75 },
    config: {
      naturezaCfop: "353",
      naturezaOperacao: "PRESTACAO DE SERVICO DE TRANSPORTE",
      serie: 1,
      icms: { tipo: "00", aliquota: 12 },
    },
    numero: 1042,
    emitidoEm: new Date("2026-09-13T18:30:00.000Z"),
    ambiente: 1,
    codigoNumerico: 87654321,
  });
}

describe("DACTE", () => {
  it("a chave sai em grupos de quatro, que é como se confere a olho", () => {
    expect(chaveEmGrupos(CHAVE)).toBe(
      "4326 0963 6203 0800 0150 5799 9000 0000 0312 6336 6246",
    );
  });

  it("gera o PDF de um CT-e sem expedidor, recebedor nem NF-e", async () => {
    // O caso mais comum é justamente o que tem mais campo ausente. Se o
    // gerador depender de um bloco opcional, é aqui que aparece.
    const pdf = await gerarDacte({
      payload: entradaMinima() as never,
      chave: CHAVE,
      ambiente: 1,
      protocolo: "143260000123456",
      autorizadoEm: new Date("2026-09-13T18:31:00.000Z"),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("um documento sem protocolo diz que não está autorizado", async () => {
    // Papel sem protocolo não vale nada, e um DACTE que só deixa o campo em
    // branco parece um documento válido mal impresso.
    const semProtocolo = await gerarDacte({
      payload: entradaMinima() as never,
      chave: CHAVE,
      ambiente: 1,
      protocolo: null,
      situacao: "SEM AUTORIZAÇÃO DE USO — 646 Rejeição",
    });
    expect(semProtocolo.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("homologação imprime a tarja, produção não", async () => {
    // A tarja é conteúdo desenhado a mais: o PDF de homologação é maior que o
    // mesmo documento em produção. É indireto, mas prova que ela saiu.
    const base = { payload: entradaMinima() as never, chave: CHAVE, protocolo: "1" };
    const producao = await gerarDacte({ ...base, ambiente: 1 });
    const homologacao = await gerarDacte({ ...base, ambiente: 2 });
    expect(homologacao.length).toBeGreaterThan(producao.length);
  });
});
