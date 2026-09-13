import { isCnpjValid, isCpfValid } from "@ronan/shared-types";
import { soDigitos } from "../chave-fiscal";
import { CODIGO_UF } from "./chave";
import { quemEhOTomador, type EntradaCte, type Participante } from "./montar";

/**
 * As rejeições da SEFAZ que dá pra pegar aqui, de graça, antes de mandar.
 *
 * Não substitui a validação de lá — nem tenta. O que ela evita é o ciclo caro:
 * emitir, esperar, levar "Rejeição 610: valor da prestação difere do somatório
 * dos componentes", e alguém ter que traduzir isso. Cada item abaixo é um erro
 * que já custou dia de operação de transportadora em algum lugar.
 *
 * Erro trava a emissão. Aviso não: ele diz que o documento vai passar e que
 * alguém vai reclamar depois — CT-e sem a chave da NF-e é autorizado, e o
 * tomador liga no dia seguinte porque não consegue creditar.
 */

export type Achado = { campo: string; mensagem: string };
export type Validacao = { ok: boolean; erros: Achado[]; avisos: Achado[] };

/** O código IBGE do município começa com o código da UF. Confere de graça. */
function municipioBateComUf(codigoMunicipio: string, uf: string): boolean {
  const cod = soDigitos(codigoMunicipio);
  const cUF = CODIGO_UF[uf.toUpperCase()];
  return cod.length === 7 && cUF !== undefined && cod.startsWith(cUF);
}

function checarParticipante(p: Participante, papel: string, erros: Achado[]): void {
  const doc = soDigitos(p.cnpjCpf);
  if (doc.length === 14) {
    if (!isCnpjValid(doc)) erros.push({ campo: papel, mensagem: `CNPJ do ${papel} é inválido.` });
  } else if (doc.length === 11) {
    if (!isCpfValid(doc)) erros.push({ campo: papel, mensagem: `CPF do ${papel} é inválido.` });
  } else {
    erros.push({ campo: papel, mensagem: `O ${papel} está sem CNPJ nem CPF.` });
  }

  if (!p.razaoSocial?.trim()) {
    erros.push({ campo: papel, mensagem: `O ${papel} está sem razão social.` });
  }

  const e = p.endereco;
  for (const [campo, valor] of [
    ["logradouro", e.logradouro],
    ["bairro", e.bairro],
    ["município", e.municipio],
    ["UF", e.uf],
  ] as const) {
    if (!String(valor ?? "").trim()) {
      erros.push({ campo: papel, mensagem: `Endereço do ${papel} está sem ${campo}.` });
    }
  }

  if (!CODIGO_UF[String(e.uf ?? "").toUpperCase()]) {
    erros.push({ campo: papel, mensagem: `UF do ${papel} não existe: "${e.uf}".` });
  } else if (!municipioBateComUf(e.codigoMunicipio, e.uf)) {
    // O erro clássico da importação de planilha: o código IBGE de outro estado.
    // A SEFAZ devolve "código de município inválido" sem dizer qual.
    erros.push({
      campo: papel,
      mensagem: `O código IBGE do município do ${papel} (${e.codigoMunicipio || "vazio"}) não é de ${e.uf.toUpperCase()}.`,
    });
  }

  // Contribuinte tem IE; isento não manda número; não contribuinte não tem.
  // Mandar IE de quem é isento, ou omitir a de quem é contribuinte, é rejeição.
  if (p.indicadorIe === "1" && !soDigitos(p.inscricaoEstadual ?? "")) {
    erros.push({
      campo: papel,
      mensagem: `O ${papel} está marcado como contribuinte de ICMS e não tem inscrição estadual.`,
    });
  }
  if (p.indicadorIe === "9" && soDigitos(p.inscricaoEstadual ?? "")) {
    erros.push({
      campo: papel,
      mensagem: `O ${papel} está marcado como NÃO contribuinte mas tem inscrição estadual preenchida.`,
    });
  }
}

export function validarCte(e: EntradaCte): Validacao {
  const erros: Achado[] = [];
  const avisos: Achado[] = [];

  // --- emitente ---
  checarParticipante(e.emitente, "emitente", erros);
  if (!soDigitos(e.emitente.cnpjCpf) || soDigitos(e.emitente.cnpjCpf).length !== 14) {
    erros.push({ campo: "emitente", mensagem: "O emitente do CT-e tem que ser CNPJ." });
  }
  if (!soDigitos(e.emitente.rntrc)) {
    erros.push({
      campo: "rntrc",
      mensagem: "Sem RNTRC não dá pra emitir CT-e rodoviário. Está em Configurações → Minha empresa.",
    });
  }
  if (!["1", "2", "3"].includes(e.emitente.crt)) {
    erros.push({ campo: "crt", mensagem: "Falta dizer o regime tributário da empresa (CRT)." });
  }

  // --- participantes ---
  checarParticipante(e.remetente, "remetente", erros);
  checarParticipante(e.destinatario, "destinatário", erros);
  if (e.expedidor) checarParticipante(e.expedidor, "expedidor", erros);
  if (e.recebedor) checarParticipante(e.recebedor, "recebedor", erros);

  let tomador: Participante | null = null;
  try {
    tomador = quemEhOTomador(e);
  } catch (err) {
    erros.push({ campo: "tomador", mensagem: (err as Error).message });
  }
  if (tomador && e.papelTomador === "OUTRO") checarParticipante(tomador, "tomador", erros);

  // --- prestação ---
  for (const [nome, ponto] of [
    ["início", e.inicioPrestacao],
    ["fim", e.fimPrestacao],
  ] as const) {
    if (!ponto?.codigo || !ponto?.uf) {
      erros.push({
        campo: `prestacao.${nome}`,
        mensagem: `O local de ${nome === "início" ? "carga" : "descarga"} está sem município ou UF no cadastro.`,
      });
    } else if (!municipioBateComUf(ponto.codigo, ponto.uf)) {
      erros.push({
        campo: `prestacao.${nome}`,
        mensagem: `O código IBGE do local de ${nome === "início" ? "carga" : "descarga"} (${ponto.codigo}) não é de ${ponto.uf.toUpperCase()}.`,
      });
    }
  }

  // --- valores ---
  const extras = (e.valores.extras ?? []).reduce((s, x) => s + x.valor, 0);
  const total = e.valores.valorFrete + (e.valores.valorPedagio ?? 0) + extras;
  if (!(e.valores.valorFrete > 0)) {
    erros.push({
      campo: "valor",
      mensagem: "A viagem está sem valor de frete. O CT-e não pode ser emitido por R$ 0,00.",
    });
  }
  if (total > 0 && Math.abs(total - Number(total.toFixed(2))) > 0.005) {
    erros.push({ campo: "valor", mensagem: "O valor total tem mais de duas casas decimais." });
  }

  // --- carga ---
  if (!(e.carga.toneladas > 0)) {
    erros.push({
      campo: "carga",
      mensagem: "A viagem está sem peso. O CT-e exige a quantidade da carga.",
    });
  }
  if (!e.carga.produtoPredominante?.trim()) {
    erros.push({ campo: "carga", mensagem: "Falta o material transportado (produto predominante)." });
  }
  if (!e.carga.chaveNfe) {
    avisos.push({
      campo: "nfe",
      mensagem:
        "Sem a chave da NF-e o CT-e é autorizado, mas o tomador não consegue amarrar o frete à mercadoria pra se creditar.",
    });
  }
  if (e.carga.valorCarga == null) {
    avisos.push({ campo: "carga", mensagem: "Valor da carga não informado." });
  }

  // --- fiscal ---
  const natureza = soDigitos(e.config.naturezaCfop);
  if (natureza.length !== 3) {
    erros.push({
      campo: "cfop",
      mensagem: "A natureza do CFOP tem que ter 3 dígitos (ex.: 353). O 5 ou o 6 da frente o sistema põe.",
    });
  }
  if (!e.config.naturezaOperacao?.trim()) {
    erros.push({ campo: "cfop", mensagem: "Falta o texto da natureza da operação." });
  }
  if (e.emitente.crt === "1" && e.config.icms.tipo !== "SN") {
    // Empresa do Simples destacando ICMS no CT-e é erro de cadastro, e sai caro:
    // o tomador credita um imposto que não foi recolhido.
    erros.push({
      campo: "icms",
      mensagem:
        "A empresa está no Simples Nacional mas a regra de ICMS destaca imposto. No Simples o CT-e sai sem destaque.",
    });
  }
  if (e.emitente.crt === "3" && e.config.icms.tipo === "SN") {
    erros.push({
      campo: "icms",
      mensagem: "A empresa está no Regime Normal mas a regra de ICMS é a do Simples.",
    });
  }

  // --- emissão ---
  const agora = Date.now();
  if (e.emitidoEm.getTime() > agora + 5 * 60_000) {
    erros.push({ campo: "data", mensagem: "A data de emissão está no futuro." });
  }
  if (agora - e.emitidoEm.getTime() > 30 * 24 * 60 * 60_000) {
    avisos.push({
      campo: "data",
      mensagem: "A emissão tem mais de 30 dias. A SEFAZ costuma recusar CT-e muito atrasado.",
    });
  }
  if (e.ambiente !== 1 && e.ambiente !== 2) {
    erros.push({ campo: "ambiente", mensagem: "Ambiente tem que ser 1 (produção) ou 2 (homologação)." });
  }

  return { ok: erros.length === 0, erros, avisos };
}
