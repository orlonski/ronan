import PDFDocument from "pdfkit";
import { barrasCode128C } from "./codigo-barras";

/**
 * O DACTE — a representação em papel do CT-e.
 *
 * Duas coisas importam pra entender o que este arquivo é e o que ele não é.
 *
 * **O documento fiscal é o XML.** O DACTE não vale por si: ele é um espelho
 * impresso que serve pra acompanhar a carga e pra ser lido na barreira. Por
 * isso ele não "gera" nada — todo campo aqui sai do que já foi autorizado, e
 * nada é calculado de novo na hora de imprimir. Recalcular um valor na
 * impressão é como um papel passa a divergir do que a SEFAZ tem.
 *
 * **O leiaute é norma, não estética.** A ordem dos quadros, os rótulos e o
 * código de barras são definidos pelo Ajuste SINIEF: o fiscal procura cada
 * coisa num lugar, e o leitor óptico espera CODE-128C com a chave limpa.
 * Mexer aqui por gosto quebra o uso, não o visual.
 *
 * Em homologação sai a tarja: um DACTE de teste que circule sem ela é um
 * documento que parece verdadeiro e não é.
 */

// ---------------------------------------------------------------------------
// Leitura do que foi autorizado
// ---------------------------------------------------------------------------

type Json = Record<string, any>;

export type DadosDacte = {
  /** O CT-e montado, exatamente como foi assinado e enviado. */
  payload: Json;
  chave: string;
  ambiente: number;
  protocolo?: string | null;
  autorizadoEm?: Date | null;
  cancelado?: boolean;
  /** Quando não está autorizado, o papel precisa dizer isso na cara. */
  situacao?: string | null;
};

const TIPO_CTE: Record<string, string> = {
  "0": "Normal",
  "1": "Complemento de valores",
  "2": "Anulação",
  "3": "Substituto",
};

const TIPO_SERVICO: Record<string, string> = {
  "0": "Normal",
  "1": "Subcontratação",
  "2": "Redespacho",
  "3": "Redespacho intermediário",
  "4": "Serviço vinculado a multimodal",
};

const UNIDADE_CARGA: Record<string, string> = {
  "00": "M3",
  "01": "KG",
  "02": "TON",
  "03": "UNIDADE",
  "04": "LITROS",
  "05": "MMBTU",
};

/** Quem é o tomador, segundo o próprio documento. */
function tomadorDoCte(p: Json): { rotulo: string; bloco: Json | null } {
  const ide = p.ide ?? {};
  if (ide.toma4) return { rotulo: "Outro", bloco: ide.toma4 };
  const codigo = String(ide.toma3?.toma ?? "");
  const mapa: Record<string, [string, Json | undefined]> = {
    "0": ["Remetente", p.rem],
    "1": ["Expedidor", p.exped],
    "2": ["Recebedor", p.receb],
    "3": ["Destinatário", p.dest],
  };
  const [rotulo, bloco] = mapa[codigo] ?? ["—", undefined];
  return { rotulo, bloco: bloco ?? null };
}

/** O grupo do ICMS tem um nome diferente por CST; o conteúdo é o que interessa. */
function icmsDoCte(p: Json): { cst: string; base: string; aliquota: string; valor: string; reducao: string } {
  const grupo = (p.imp?.ICMS ?? {}) as Json;
  const chave = Object.keys(grupo)[0];
  const g = (chave ? grupo[chave] : {}) as Json;
  // O Simples não destaca imposto: CST 90 com indicador, sem base nem valor.
  const cst = chave === "ICMSSN" ? "SN" : (g.CST ?? "—");
  return {
    cst: String(cst),
    base: g.vBC ?? "",
    aliquota: g.pICMS ?? "",
    valor: g.vICMS ?? "",
    reducao: g.pRedBC ?? "",
  };
}

const dinheiro = (v: unknown) =>
  v === undefined || v === null || v === ""
    ? ""
    : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const documento = (b: Json | null | undefined) =>
  !b ? "" : b.CNPJ ? formatarCnpj(b.CNPJ) : b.CPF ? formatarCpf(b.CPF) : "";

function formatarCnpj(v: string) {
  return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}
function formatarCpf(v: string) {
  return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

/** A chave sai em grupos de quatro — é assim que se confere a olho. */
export function chaveEmGrupos(chave: string) {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function endereco(b: Json | null | undefined, campo: string) {
  const e = (b?.[campo] ?? {}) as Json;
  if (!e.xLgr) return { linha1: "", linha2: "" };
  const numero = e.nro && e.nro !== "SN" ? `, ${e.nro}` : "";
  const cpl = e.xCpl ? ` ${e.xCpl}` : "";
  const cep = e.CEP ? `CEP ${String(e.CEP).replace(/^(\d{5})(\d{3})$/, "$1-$2")} · ` : "";
  return {
    linha1: `${e.xLgr}${numero}${cpl}${e.xBairro ? ` — ${e.xBairro}` : ""}`,
    linha2: `${cep}${e.xMun ?? ""}/${e.UF ?? ""}`,
  };
}

function dataHora(iso: unknown) {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

const MARGEM = 24;
const LARGURA = 595.28 - MARGEM * 2;
const CINZA = "#000000";

type Caixa = { x: number; y: number; w: number; h: number };

/**
 * O quadro rotulado — a unidade de que o DACTE inteiro é feito.
 *
 * O rótulo é minúsculo e o valor é o que se lê: quem confere o documento está
 * procurando o número, não a legenda.
 */
function quadro(doc: PDFKit.PDFDocument, c: Caixa, rotulo: string, valor: string, opcoes: { negrito?: boolean; tamanho?: number; centro?: boolean } = {}) {
  doc.lineWidth(0.5).rect(c.x, c.y, c.w, c.h).stroke(CINZA);
  if (rotulo) {
    doc.font("Helvetica").fontSize(5).fillColor("#444")
      .text(rotulo.toUpperCase(), c.x + 3, c.y + 2.5, { width: c.w - 6, lineBreak: false });
  }
  if (valor) {
    doc.font(opcoes.negrito ? "Helvetica-Bold" : "Helvetica")
      .fontSize(opcoes.tamanho ?? 7.5)
      .fillColor("#000")
      .text(valor, c.x + 3, c.y + (rotulo ? 9 : 4), {
        width: c.w - 6,
        height: c.h - (rotulo ? 10 : 5),
        align: opcoes.centro ? "center" : "left",
        ellipsis: true,
      });
  }
}

/** Um participante: é o mesmo bloco pra remetente, destinatário, expedidor… */
function participante(doc: PDFKit.PDFDocument, c: Caixa, titulo: string, b: Json | null | undefined, campoEndereco: string) {
  doc.lineWidth(0.5).rect(c.x, c.y, c.w, c.h).stroke(CINZA);
  doc.font("Helvetica").fontSize(5).fillColor("#444")
    .text(titulo.toUpperCase(), c.x + 3, c.y + 2.5, { width: c.w - 6, lineBreak: false });
  if (!b) {
    doc.font("Helvetica").fontSize(7).fillColor("#666")
      .text("Não informado", c.x + 3, c.y + 10, { width: c.w - 6, lineBreak: false });
    return;
  }
  const end = endereco(b, campoEndereco);
  const linhas = [
    b.xNome ?? "",
    end.linha1,
    end.linha2,
    `${documento(b)}${b.IE ? `  ·  IE ${b.IE}` : ""}${b.fone ? `  ·  ${b.fone}` : ""}`,
  ].filter(Boolean);
  doc.font("Helvetica").fontSize(6.5).fillColor("#000")
    .text(linhas.join("\n"), c.x + 3, c.y + 9.5, { width: c.w - 6, height: c.h - 11, ellipsis: true, lineGap: 0.5 });
}

/**
 * O código de barras da chave.
 *
 * Desenhado em módulos e escalado no fim: a largura de um módulo é a mesma pra
 * todas as barras, e arredondar cada uma isolada é o que produz código que
 * imprime e não lê.
 */
function codigoDeBarras(doc: PDFKit.PDFDocument, chave: string, c: Caixa) {
  const { barras, modulos } = barrasCode128C(chave);
  const modulo = c.w / modulos;
  doc.fillColor("#000");
  for (const b of barras) doc.rect(c.x + b.x * modulo, c.y, b.largura * modulo, c.h).fill();
}

/**
 * Monta o PDF.
 *
 * Devolve `Buffer` e não escreve arquivo: o DACTE é gerado sob demanda e serve
 * direto na resposta. Guardar em disco criaria uma segunda cópia do documento
 * que pode divergir do XML — e o XML é o que vale.
 */
export function gerarDacte(d: DadosDacte): Promise<Buffer> {
  const p = d.payload ?? {};
  const ide = (p.ide ?? {}) as Json;
  const emit = (p.emit ?? {}) as Json;
  const norm = (p.infCTeNorm ?? {}) as Json;
  const carga = (norm.infCarga ?? {}) as Json;
  const icms = icmsDoCte(p);
  const tomador = tomadorDoCte(p);
  const homologacao = Number(d.ambiente) === 2;

  const doc = new PDFDocument({ size: "A4", margin: MARGEM, bufferPages: true });
  const pedacos: Buffer[] = [];
  doc.on("data", (x: Buffer) => pedacos.push(x));
  const pronto = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(pedacos))));

  let y = MARGEM;
  const L = MARGEM;

  // --- Cabeçalho: emitente · identificação do DACTE · chave -----------------
  const alturaTopo = 96;
  const wEmit = LARGURA * 0.36;
  const wIdent = LARGURA * 0.24;
  const wChave = LARGURA - wEmit - wIdent;

  participante(doc, { x: L, y, w: wEmit, h: alturaTopo }, "Emitente", emit, "enderEmit");

  const xIdent = L + wEmit;
  doc.lineWidth(0.5).rect(xIdent, y, wIdent, alturaTopo).stroke(CINZA);
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#000")
    .text("DACTE", xIdent, y + 6, { width: wIdent, align: "center" });
  doc.font("Helvetica").fontSize(5).fillColor("#444")
    .text("Documento Auxiliar do Conhecimento de Transporte Eletrônico", xIdent + 4, y + 24, {
      width: wIdent - 8,
      align: "center",
    });
  const celulaIdent = (i: number, n: number, rotulo: string, valor: string) => {
    const w = wIdent / n;
    quadro(doc, { x: xIdent + i * w, y: y + 42, w, h: 24 }, rotulo, valor, { negrito: true, centro: true, tamanho: 8 });
  };
  celulaIdent(0, 3, "Modelo", String(ide.mod ?? "57"));
  celulaIdent(1, 3, "Série", String(ide.serie ?? ""));
  celulaIdent(2, 3, "Número", String(ide.nCT ?? ""));
  quadro(doc, { x: xIdent, y: y + 66, w: wIdent, h: 30 }, "Tipo do CT-e / tipo do serviço",
    `${TIPO_CTE[String(ide.tpCTe)] ?? "—"}\n${TIPO_SERVICO[String(ide.tpServ)] ?? "—"}`, { tamanho: 6.5 });

  const xChave = xIdent + wIdent;
  doc.lineWidth(0.5).rect(xChave, y, wChave, alturaTopo).stroke(CINZA);
  codigoDeBarras(doc, d.chave, { x: xChave + 8, y: y + 8, w: wChave - 16, h: 32 });
  doc.font("Helvetica").fontSize(5).fillColor("#444")
    .text("CHAVE DE ACESSO", xChave + 4, y + 44, { width: wChave - 8 });
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000")
    .text(chaveEmGrupos(d.chave), xChave + 4, y + 51, { width: wChave - 8 });
  doc.font("Helvetica").fontSize(5.5).fillColor("#444")
    .text(
      "Consulte a autenticidade no portal nacional do CT-e, www.cte.fazenda.gov.br/portal, ou no site da Sefaz autorizadora.",
      xChave + 4,
      y + 64,
      { width: wChave - 8 },
    );
  y += alturaTopo;

  // --- Protocolo ------------------------------------------------------------
  // É o que prova que a SEFAZ autorizou. Sem ele o papel não vale nada, e
  // dizer isso em voz alta no próprio documento é mais honesto que deixar o
  // campo vazio.
  const protocolo = d.protocolo
    ? `${d.protocolo}${d.autorizadoEm ? `  —  ${d.autorizadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}`
    : (d.situacao ?? "DOCUMENTO SEM AUTORIZAÇÃO DE USO");
  quadro(doc, { x: L, y, w: LARGURA * 0.62, h: 22 }, "Protocolo de autorização de uso", protocolo, { negrito: true });
  quadro(doc, { x: L + LARGURA * 0.62, y, w: LARGURA * 0.38, h: 22 }, "Data e hora de emissão", dataHora(ide.dhEmi));
  y += 22;

  // --- Natureza e percurso --------------------------------------------------
  quadro(doc, { x: L, y, w: LARGURA * 0.14, h: 20 }, "CFOP", String(ide.CFOP ?? ""), { negrito: true });
  quadro(doc, { x: L + LARGURA * 0.14, y, w: LARGURA * 0.86, h: 20 }, "Natureza da prestação", String(ide.natOp ?? ""));
  y += 20;

  const terco = LARGURA / 3;
  quadro(doc, { x: L, y, w: terco, h: 20 }, "Início da prestação", `${ide.xMunIni ?? ""} / ${ide.UFIni ?? ""}`);
  quadro(doc, { x: L + terco, y, w: terco, h: 20 }, "Término da prestação", `${ide.xMunFim ?? ""} / ${ide.UFFim ?? ""}`);
  quadro(doc, { x: L + terco * 2, y, w: terco, h: 20 }, "Município de emissão", `${ide.xMunEnv ?? ""} / ${ide.UFEnv ?? ""}`);
  y += 20;

  // --- Participantes --------------------------------------------------------
  const meio = LARGURA / 2;
  const alturaParte = 46;
  participante(doc, { x: L, y, w: meio, h: alturaParte }, "Remetente", p.rem, "enderReme");
  participante(doc, { x: L + meio, y, w: meio, h: alturaParte }, "Destinatário", p.dest, "enderDest");
  y += alturaParte;

  if (p.exped || p.receb) {
    participante(doc, { x: L, y, w: meio, h: alturaParte }, "Expedidor", p.exped, "enderExped");
    participante(doc, { x: L + meio, y, w: meio, h: alturaParte }, "Recebedor", p.receb, "enderReceb");
    y += alturaParte;
  }

  participante(
    doc,
    { x: L, y, w: LARGURA, h: alturaParte - 8 },
    `Tomador do serviço — ${tomador.rotulo}`,
    tomador.bloco,
    "enderToma",
  );
  y += alturaParte - 8;

  // --- Carga ----------------------------------------------------------------
  quadro(doc, { x: L, y, w: LARGURA * 0.42, h: 20 }, "Produto predominante", String(carga.proPred ?? ""));
  quadro(doc, { x: L + LARGURA * 0.42, y, w: LARGURA * 0.36, h: 20 }, "Outras características da carga", String(carga.xOutCat ?? ""));
  quadro(doc, { x: L + LARGURA * 0.78, y, w: LARGURA * 0.22, h: 20 }, "Valor total da carga (R$)", dinheiro(carga.vCarga), { negrito: true });
  y += 20;

  const quantidades: Json[] = Array.isArray(carga.infQ) ? carga.infQ : carga.infQ ? [carga.infQ] : [];
  const textoQtd = quantidades
    .map((q) => `${Number(q.qCarga).toLocaleString("pt-BR", { minimumFractionDigits: 4 })} ${UNIDADE_CARGA[String(q.cUnid)] ?? ""} (${q.tpMed})`)
    .join("   ·   ");
  quadro(doc, { x: L, y, w: LARGURA, h: 18 }, "Quantidade da carga", textoQtd);
  y += 18;

  // --- Valores --------------------------------------------------------------
  // Os componentes ficam do lado do total de propósito: a SEFAZ rejeita quando
  // a soma não bate (610), e o papel deixa a conta à vista pra quem confere.
  const componentes: Json[] = Array.isArray(p.vPrest?.Comp)
    ? p.vPrest.Comp
    : p.vPrest?.Comp
      ? [p.vPrest.Comp]
      : [];
  const alturaComp = Math.max(30, 12 + componentes.length * 9);
  doc.lineWidth(0.5).rect(L, y, LARGURA * 0.62, alturaComp).stroke(CINZA);
  doc.font("Helvetica").fontSize(5).fillColor("#444")
    .text("COMPONENTES DO VALOR DA PRESTAÇÃO", L + 3, y + 2.5, { width: LARGURA * 0.62 - 6 });
  componentes.forEach((comp, i) => {
    const linhaY = y + 10 + i * 9;
    doc.font("Helvetica").fontSize(6.5).fillColor("#000")
      .text(String(comp.xNome ?? ""), L + 5, linhaY, { width: LARGURA * 0.4, lineBreak: false });
    doc.text(dinheiro(comp.vComp), L + LARGURA * 0.4, linhaY, {
      width: LARGURA * 0.22 - 8,
      align: "right",
      lineBreak: false,
    });
  });
  quadro(doc, { x: L + LARGURA * 0.62, y, w: LARGURA * 0.19, h: alturaComp }, "Valor total da prestação (R$)", dinheiro(p.vPrest?.vTPrest), { negrito: true, tamanho: 9 });
  quadro(doc, { x: L + LARGURA * 0.81, y, w: LARGURA * 0.19, h: alturaComp }, "Valor a receber (R$)", dinheiro(p.vPrest?.vRec), { negrito: true, tamanho: 9 });
  y += alturaComp;

  // --- Imposto --------------------------------------------------------------
  const quinto = LARGURA / 5;
  quadro(doc, { x: L, y, w: quinto, h: 20 }, "Situação tributária", icms.cst, { negrito: true });
  quadro(doc, { x: L + quinto, y, w: quinto, h: 20 }, "Base de cálculo (R$)", dinheiro(icms.base));
  quadro(doc, { x: L + quinto * 2, y, w: quinto, h: 20 }, "Alíquota ICMS (%)", icms.aliquota ? String(icms.aliquota) : "");
  quadro(doc, { x: L + quinto * 3, y, w: quinto, h: 20 }, "Valor do ICMS (R$)", dinheiro(icms.valor));
  quadro(doc, { x: L + quinto * 4, y, w: quinto, h: 20 }, "% red. base de cálculo", icms.reducao ? String(icms.reducao) : "");
  y += 20;

  // --- Documentos originários ----------------------------------------------
  const infDoc = (norm.infDoc ?? {}) as Json;
  const nfes: Json[] = Array.isArray(infDoc.infNFe) ? infDoc.infNFe : infDoc.infNFe ? [infDoc.infNFe] : [];
  const outros: Json[] = Array.isArray(infDoc.infOutros) ? infDoc.infOutros : infDoc.infOutros ? [infDoc.infOutros] : [];
  const textoDocs = [
    ...nfes.map((n) => `NF-e ${chaveEmGrupos(String(n.chave ?? ""))}`),
    ...outros.map((o) => `${o.descOutros ?? "Documento"} ${o.nDoc ?? ""}`),
  ].join("   ·   ");
  quadro(doc, { x: L, y, w: LARGURA, h: 20 }, "Documentos originários", textoDocs);
  y += 20;

  // --- Modal rodoviário -----------------------------------------------------
  const rodo = (norm.infModal?.rodo ?? {}) as Json;
  quadro(doc, { x: L, y, w: LARGURA * 0.25, h: 20 }, "RNTRC da empresa", String(rodo.RNTRC ?? ""), { negrito: true });
  quadro(doc, { x: L + LARGURA * 0.25, y, w: LARGURA * 0.75, h: 20 }, "Modal", "Rodoviário");
  y += 20;

  // --- Observações ----------------------------------------------------------
  quadro(doc, { x: L, y, w: LARGURA, h: 34 }, "Observações gerais", String(norm.infCteComp?.xObs ?? p.compl?.xObs ?? ""));
  y += 34;

  // --- Canhoto --------------------------------------------------------------
  // Vai pro PÉ da página, e não logo abaixo do último quadro: é a parte que se
  // destaca com a tesoura, e destacar pelo meio da folha levaria junto os
  // dados do documento. O comprovante de entrega eletrônico existe e é melhor,
  // mas quem carrega o papel ainda precisa de onde assinar.
  y = doc.page.height - MARGEM - 50;
  doc.lineWidth(0.5).rect(L, y, LARGURA, 36).stroke(CINZA);
  doc.font("Helvetica").fontSize(6).fillColor("#444")
    .text("DECLARO QUE RECEBI OS VOLUMES DESTE CONHECIMENTO EM PERFEITO ESTADO", L + 4, y + 4, { width: LARGURA - 8 });
  doc.font("Helvetica").fontSize(5.5).fillColor("#444")
    .text("Data · Nome legível · Assinatura", L + 4, y + 26, { width: LARGURA / 2 });
  doc.moveTo(L + 4, y + 24).lineTo(L + LARGURA - 4, y + 24).lineWidth(0.5).stroke("#999");
  y += 36;

  // --- Tarja de homologação -------------------------------------------------
  if (homologacao) {
    doc.save();
    doc.rotate(-28, { origin: [297, 420] });
    doc.font("Helvetica-Bold").fontSize(26).fillColor("#dc2626").opacity(0.22)
      .text("AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL", 20, 400, { width: 560, align: "center" });
    doc.restore();
    doc.opacity(1);
  }

  if (d.cancelado) {
    doc.save();
    doc.font("Helvetica-Bold").fontSize(40).fillColor("#dc2626").opacity(0.25)
      .text("CANCELADO", 0, 380, { width: 595.28, align: "center" });
    doc.restore();
    doc.opacity(1);
  }

  doc.font("Helvetica").fontSize(5.5).fillColor("#666")
    .text(
      `Emitido por ${ide.verProc ?? "Movatruck"} · O documento fiscal é o XML; este DACTE é a representação impressa dele.`,
      L,
      doc.page.height - MARGEM - 8,
      { width: LARGURA, align: "center" },
    );

  doc.end();
  return pronto;
}
