import { CODIGO_UF, gerarChaveCte, MODELO_CTE } from "./chave";
import { soDigitos } from "../chave-fiscal";

/**
 * Monta o CT-e modelo 57 (rodoviário, carga) a partir do que o sistema já tem.
 *
 * A regra que organiza tudo aqui: **o sistema nunca escolhe tributo.** CFOP,
 * CST e alíquota vêm do cadastro, preenchidos pelo contador da transportadora.
 * Chutar uma alíquota "que costuma ser" produz um documento que a SEFAZ
 * autoriza e que está errado — e errado em imposto só aparece na fiscalização,
 * com multa e juros. O que o sistema faz é o que dá pra derivar sem opinião:
 * se a prestação é dentro ou fora do estado, quanto pesa a carga, quanto vale
 * o frete, e que a soma dos componentes bate com o total.
 */

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export type Endereco = {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  /** Código IBGE de 7 dígitos. O CT-e não aceita município por nome. */
  codigoMunicipio: string;
  municipio: string;
  cep?: string | null;
  uf: string;
};

export type Participante = {
  /** CNPJ (14) ou CPF (11), só dígitos. */
  cnpjCpf: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
  inscricaoEstadual?: string | null;
  /** 1 contribuinte · 2 contribuinte isento · 9 não contribuinte. */
  indicadorIe: "1" | "2" | "9";
  endereco: Endereco;
  telefone?: string | null;
  email?: string | null;
};

export type Emitente = Participante & {
  /** 1 Simples Nacional · 2 Simples, excesso de sublimite · 3 Regime Normal. */
  crt: "1" | "2" | "3";
  /** Registro na ANTT. Sem ele o modal rodoviário é rejeitado. */
  rntrc: string;
};

/** Quem paga o frete. É o campo que muda o CFOP, o ICMS e quem recebe o boleto. */
export type PapelTomador = "REMETENTE" | "EXPEDIDOR" | "RECEBEDOR" | "DESTINATARIO" | "OUTRO";

const CODIGO_TOMADOR: Record<Exclude<PapelTomador, "OUTRO">, number> = {
  REMETENTE: 0,
  EXPEDIDOR: 1,
  RECEBEDOR: 2,
  DESTINATARIO: 3,
};

/**
 * O tratamento do ICMS, como o contador definiu. Nenhum default aqui é
 * "o mais comum": o Simples é o único que o sistema deduz sozinho, porque
 * decorre do CRT do emitente e não tem alíquota pra errar.
 */
export type RegraIcms =
  | { tipo: "SN" }
  | { tipo: "00"; aliquota: number }
  | { tipo: "20"; aliquota: number; reducaoBase: number }
  | { tipo: "45"; cst: "40" | "41" | "51" }
  | { tipo: "60" }
  | { tipo: "90"; aliquota: number; reducaoBase?: number };

export type ConfigFiscal = {
  /**
   * Os TRÊS últimos dígitos do CFOP (ex.: "353" = a estabelecimento comercial).
   * O primeiro dígito o sistema põe: 5 dentro do estado, 6 pra fora. É a única
   * parte do CFOP que dá pra derivar sem opinião, e é a que mais erra na mão.
   */
  naturezaCfop: string;
  /** Texto da natureza da operação, como sai no DACTE. */
  naturezaOperacao: string;
  serie: number;
  icms: RegraIcms;
  /** 0 normal · 1 subcontratação · 2 redespacho · 3 redespacho intermediário. */
  tipoServico?: number;
};

export type CargaDaViagem = {
  /** O que foi transportado — vira `proPred`. */
  produtoPredominante: string;
  toneladas: number;
  /** Valor da mercadoria, quando conhecido (vem da NF-e do remetente). */
  valorCarga?: number | null;
  /** Chave da NF-e que acompanha a carga. */
  chaveNfe?: string | null;
  /** Nº do ticket/romaneio, usado quando não há NF-e. */
  documentoAvulso?: string | null;
};

export type ValorPrestacao = {
  valorFrete: number;
  valorPedagio?: number | null;
  /** Componentes extras já combinados (estadia, ajudante, etc). */
  extras?: { nome: string; valor: number }[];
};

/**
 * O responsável técnico pelo software emissor.
 *
 * É onde a empresa que ESCREVEU o sistema entra no documento — e é o único
 * lugar dela: emitente é quem presta o serviço de transporte, e uma software
 * house não tem RNTRC, nem inscrição estadual, nem credenciamento de
 * transportador na SEFAZ.
 *
 * O dado é o mesmo pra todas as contas (é sempre a mesma desenvolvedora), então
 * ele vem de env e não do cadastro de cada empresa.
 */
export type ResponsavelTecnico = {
  cnpj: string;
  contato: string;
  email: string;
  telefone: string;
};

export type EntradaCte = {
  emitente: Emitente;
  remetente: Participante;
  destinatario: Participante;
  expedidor?: Participante | null;
  recebedor?: Participante | null;
  /** Só quando `papelTomador` é OUTRO. */
  tomadorOutro?: Participante | null;
  papelTomador: PapelTomador;
  /** Município onde o CT-e é emitido (normalmente o do emitente). */
  municipioEnvio?: { codigo: string; nome: string; uf: string } | null;
  inicioPrestacao: { codigo: string; nome: string; uf: string };
  fimPrestacao: { codigo: string; nome: string; uf: string };
  carga: CargaDaViagem;
  valores: ValorPrestacao;
  config: ConfigFiscal;
  numero: number;
  emitidoEm: Date;
  /** 1 produção · 2 homologação. */
  ambiente: 1 | 2;
  /** Injetável pra teste — em produção é sorteado. */
  codigoNumerico?: number;
  versaoAplicativo?: string;
  /** Ausente = o grupo não vai. A prévia avisa. */
  responsavelTecnico?: ResponsavelTecnico | null;
};

// ---------------------------------------------------------------------------
// Saída — espelha os grupos do XML, que é o que todo gateway aceita
// ---------------------------------------------------------------------------

export type CteMontado = {
  chave: string;
  versao: "4.00";
  ide: Record<string, unknown>;
  emit: Record<string, unknown>;
  rem: Record<string, unknown>;
  dest: Record<string, unknown>;
  exped?: Record<string, unknown>;
  receb?: Record<string, unknown>;
  toma4?: Record<string, unknown>;
  vPrest: Record<string, unknown>;
  imp: Record<string, unknown>;
  infCTeNorm: Record<string, unknown>;
  infRespTec?: Record<string, unknown>;
};

const dec = (n: number, casas: number) => n.toFixed(casas);

/**
 * Valor de tag OPCIONAL: ou tem valor de verdade, ou a tag não vai.
 *
 * Os tipos `*Opc` do schema recusam zero de propósito — `vDocFisc` é
 * `TDec_1302Opc`, cujo padrão não casa com "0.00". A leitura da SEFAZ é que
 * declarar que um documento vale nada é diferente de não declarar valor, e só o
 * segundo é aceitável. Mandar zero é rejeição de leiaute, que nem chega a ser
 * analisada como documento.
 *
 * Nota: isto NÃO vale pros campos obrigatórios (`TDec_1302` sem o `Opc`), que
 * aceitam zero normalmente — por isso o cuidado é campo a campo, e não uma
 * regra geral de "não mandar zero".
 */
const tagOpcional = (nome: string, n: number | null | undefined, casas: number) =>
  n != null && n > 0 ? { [nome]: n.toFixed(casas) } : {};

/**
 * O endereço, na ordem do schema.
 *
 * São DOIS tipos diferentes e a diferença morde: `TEndereco` (remetente,
 * destinatário, expedidor, recebedor, tomador) termina em `cPais`/`xPais`;
 * `TEndeEmi` (só o emitente) não tem país nenhum e termina em `fone`. Mandar
 * `cPais` no emitente é rejeição de leiaute, e é um erro que passa despercebido
 * porque os dois blocos são visualmente idênticos.
 */
function enderecoXml(e: Endereco, tipo: "emitente" | "outros", fone?: string | null) {
  return {
    xLgr: e.logradouro,
    nro: e.numero,
    ...(e.complemento ? { xCpl: e.complemento } : {}),
    xBairro: e.bairro,
    cMun: e.codigoMunicipio,
    xMun: e.municipio,
    ...(e.cep ? { CEP: soDigitos(e.cep) } : {}),
    UF: e.uf.toUpperCase(),
    ...(tipo === "emitente"
      ? { ...(fone ? { fone: soDigitos(fone) } : {}) }
      : { cPais: "1058", xPais: "BRASIL" }),
  };
}

function documentoXml(p: Participante) {
  const doc = soDigitos(p.cnpjCpf);
  return doc.length === 14 ? { CNPJ: doc } : { CPF: doc };
}

/**
 * A razão social que a SEFAZ EXIGE em homologação.
 *
 * Não é enfeite nem convenção: emitir em homologação com o nome real do
 * remetente, do expedidor, do recebedor ou do destinatário é rejeição na hora
 * (646, 647, 648 e a do destinatário). A ideia é que um documento de teste
 * nunca possa ser confundido com um de verdade — nem numa tela, nem num PDF
 * que vaze pra alguém.
 *
 * Só o EMITENTE mantém o nome verdadeiro: é ele que assina.
 *
 * O texto é **CTE**, sem hífen. Toda a documentação de terceiros escreve
 * "CT-E EMITIDO", e com hífen a SEFAZ rejeita — conferido contra a SVRS, que
 * cita a literal esperada dentro da própria mensagem da rejeição 646. Quem
 * decide o texto é ela, não a documentação.
 */
const NOME_HOMOLOGACAO = "CTE EMITIDO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

function participanteXml(p: Participante, chaveEndereco: string, ambiente: 1 | 2) {
  return {
    ...documentoXml(p),
    // Contribuinte isento vai com a tag literal "ISENTO"; mandar o número de
    // uma IE que não existe é rejeição na hora.
    ...(p.indicadorIe === "2"
      ? { IE: "ISENTO" }
      : p.inscricaoEstadual
        ? { IE: soDigitos(p.inscricaoEstadual) }
        : {}),
    xNome: ambiente === 2 ? NOME_HOMOLOGACAO : p.razaoSocial,
    ...(p.nomeFantasia ? { xFant: p.nomeFantasia } : {}),
    ...(p.telefone ? { fone: soDigitos(p.telefone) } : {}),
    [chaveEndereco]: enderecoXml(p.endereco, "outros"),
    ...(p.email ? { email: p.email } : {}),
  };
}

/** O tomador resolvido: é dele que sai o `indIEToma` e o CFOP. */
export function quemEhOTomador(e: EntradaCte): Participante {
  switch (e.papelTomador) {
    case "REMETENTE":
      return e.remetente;
    case "DESTINATARIO":
      return e.destinatario;
    case "EXPEDIDOR":
      if (!e.expedidor) throw new Error("Tomador é o expedidor, mas o expedidor não foi informado.");
      return e.expedidor;
    case "RECEBEDOR":
      if (!e.recebedor) throw new Error("Tomador é o recebedor, mas o recebedor não foi informado.");
      return e.recebedor;
    case "OUTRO":
      if (!e.tomadorOutro) throw new Error("Tomador é 'outro', mas não foi informado quem.");
      return e.tomadorOutro;
  }
}

/**
 * O CFOP.
 *
 * A UF de INÍCIO e a de FIM da prestação decidem o primeiro dígito — e não a UF
 * do emitente, que é o erro clássico: transportadora do Paraná levando de São
 * Paulo pra São Paulo faz uma prestação INTERNA, ainda que ela seja de fora.
 */
export function montarCfop(natureza: string, ufInicio: string, ufFim: string): string {
  const tres = soDigitos(natureza).padStart(3, "0").slice(-3);
  const interna = ufInicio.toUpperCase() === ufFim.toUpperCase();
  return (interna ? "5" : "6") + tres;
}

function impostoXml(regra: RegraIcms, baseCalculo: number): Record<string, unknown> {
  switch (regra.tipo) {
    case "SN":
      // Simples Nacional: o ICMS do transporte é recolhido no DAS, então o CT-e
      // não destaca valor. `indSN: 1` é o que diz isso à SEFAZ.
      return { ICMS: { ICMSSN: { CST: "90", indSN: 1 } } };

    case "00": {
      const valor = baseCalculo * (regra.aliquota / 100);
      return {
        ICMS: {
          ICMS00: {
            CST: "00",
            vBC: dec(baseCalculo, 2),
            pICMS: dec(regra.aliquota, 2),
            vICMS: dec(valor, 2),
          },
        },
      };
    }

    case "20": {
      const base = baseCalculo * (1 - regra.reducaoBase / 100);
      return {
        ICMS: {
          ICMS20: {
            CST: "20",
            pRedBC: dec(regra.reducaoBase, 2),
            vBC: dec(base, 2),
            pICMS: dec(regra.aliquota, 2),
            vICMS: dec(base * (regra.aliquota / 100), 2),
          },
        },
      };
    }

    case "45":
      // Isenta (40), não tributada (41) ou com diferimento (51). Sem valor.
      return { ICMS: { ICMS45: { CST: regra.cst } } };

    case "60":
      return { ICMS: { ICMS60: { CST: "60" } } };

    case "90": {
      const base = baseCalculo * (1 - (regra.reducaoBase ?? 0) / 100);
      return {
        ICMS: {
          ICMS90: {
            CST: "90",
            ...(regra.reducaoBase ? { pRedBC: dec(regra.reducaoBase, 2) } : {}),
            vBC: dec(base, 2),
            pICMS: dec(regra.aliquota, 2),
            vICMS: dec(base * (regra.aliquota / 100), 2),
          },
        },
      };
    }
  }
}

export function montarCte(e: EntradaCte): CteMontado {
  const tomador = quemEhOTomador(e);
  const envio = e.municipioEnvio ?? {
    codigo: e.emitente.endereco.codigoMunicipio,
    nome: e.emitente.endereco.municipio,
    uf: e.emitente.endereco.uf,
  };

  const { chave, codigoNumerico } = gerarChaveCte({
    ufEmitente: e.emitente.endereco.uf,
    cnpjEmitente: e.emitente.cnpjCpf,
    emitidoEm: e.emitidoEm,
    serie: e.config.serie,
    numero: e.numero,
    codigoNumerico: e.codigoNumerico,
  });

  // Os componentes SOMAM o total. A SEFAZ confere isso (rejeição 552), então o
  // total sai da soma e não de um campo digitado à parte — assim não há como
  // divergir.
  const componentes = [
    { xNome: "FRETE VALOR", vComp: dec(e.valores.valorFrete, 2) },
    ...(e.valores.valorPedagio
      ? [{ xNome: "PEDAGIO", vComp: dec(e.valores.valorPedagio, 2) }]
      : []),
    ...(e.valores.extras ?? []).map((x) => ({ xNome: x.nome, vComp: dec(x.valor, 2) })),
  ];
  const total =
    e.valores.valorFrete +
    (e.valores.valorPedagio ?? 0) +
    (e.valores.extras ?? []).reduce((s, x) => s + x.valor, 0);

  const ide = {
    cUF: CODIGO_UF[e.emitente.endereco.uf.toUpperCase()],
    cCT: codigoNumerico,
    CFOP: montarCfop(e.config.naturezaCfop, e.inicioPrestacao.uf, e.fimPrestacao.uf),
    natOp: e.config.naturezaOperacao,
    mod: MODELO_CTE,
    serie: String(e.config.serie),
    nCT: String(e.numero),
    dhEmi: emIso(e.emitidoEm),
    tpImp: 1, // DACTE retrato
    tpEmis: 1, // normal (não contingência)
    cDV: Number(chave[43]),
    tpAmb: e.ambiente,
    tpCTe: 0, // normal (não é complemento nem anulação)
    procEmi: 0, // emissão por aplicativo do contribuinte
    verProc: e.versaoAplicativo ?? "Movatruck 1.0",
    cMunEnv: envio.codigo,
    xMunEnv: envio.nome,
    UFEnv: envio.uf.toUpperCase(),
    modal: "01", // rodoviário
    tpServ: e.config.tipoServico ?? 0,
    cMunIni: e.inicioPrestacao.codigo,
    xMunIni: e.inicioPrestacao.nome,
    UFIni: e.inicioPrestacao.uf.toUpperCase(),
    cMunFim: e.fimPrestacao.codigo,
    xMunFim: e.fimPrestacao.nome,
    UFFim: e.fimPrestacao.uf.toUpperCase(),
    retira: 1, // não há retirada pelo destinatário
    indIEToma: tomador.indicadorIe,
    ...(e.papelTomador === "OUTRO"
      ? { toma4: { toma: 4, ...participanteXml(tomador, "enderToma", e.ambiente) } }
      : { toma3: { toma: CODIGO_TOMADOR[e.papelTomador] } }),
  };

  return {
    chave,
    versao: "4.00",
    ide,
    emit: {
      CNPJ: soDigitos(e.emitente.cnpjCpf),
      ...(e.emitente.inscricaoEstadual
        ? { IE: soDigitos(e.emitente.inscricaoEstadual) }
        : {}),
      xNome: e.emitente.razaoSocial,
      ...(e.emitente.nomeFantasia ? { xFant: e.emitente.nomeFantasia } : {}),
      enderEmit: enderecoXml(e.emitente.endereco, "emitente", e.emitente.telefone),
      CRT: e.emitente.crt,
    },
    rem: participanteXml(e.remetente, "enderReme", e.ambiente),
    dest: participanteXml(e.destinatario, "enderDest", e.ambiente),
    ...(e.expedidor ? { exped: participanteXml(e.expedidor, "enderExped", e.ambiente) } : {}),
    ...(e.recebedor ? { receb: participanteXml(e.recebedor, "enderReceb", e.ambiente) } : {}),
    vPrest: {
      vTPrest: dec(total, 2),
      vRec: dec(total, 2),
      Comp: componentes,
    },
    imp: impostoXml(e.config.icms, total),
    infCTeNorm: {
      infCarga: {
        ...(e.carga.valorCarga != null ? { vCarga: dec(e.carga.valorCarga, 2) } : {}),
        proPred: e.carga.produtoPredominante,
        infQ: [
          {
            cUnid: "02", // tonelada
            tpMed: "PESO BRUTO",
            qCarga: dec(e.carga.toneladas, 4),
          },
        ],
      },
      infDoc: e.carga.chaveNfe
        ? { infNFe: [{ chave: soDigitos(e.carga.chaveNfe) }] }
        : {
            // Sem a NF-e o CT-e ainda é emissível, mas o vínculo com a
            // mercadoria some — e é esse vínculo que o tomador usa pra creditar.
            // O ticket entra como "outros" pra que ao menos exista rastro.
            infOutros: [
              {
                tpDoc: "99",
                descOutros: "TICKET DE PESAGEM",
                // Sem número do ticket, a tag não vai. "SEM NUMERO" é texto
                // inventado que ia parar no documento fiscal e no DACTE, como
                // se fosse o número — e `nDoc` é opcional justamente pra isso.
                ...(e.carga.documentoAvulso ? { nDoc: e.carga.documentoAvulso } : {}),
                dEmi: emData(e.emitidoEm),
                ...tagOpcional("vDocFisc", e.carga.valorCarga, 2),
              },
            ],
          },
      // `versaoModal` é ATRIBUTO, não elemento: o `infModal` tem um único filho
      // (`xs:any`), e pôr a versão como tag ocupava essa vaga — daí o `rodo`
      // virar "elemento não esperado", que é uma mensagem que não ajuda nada.
      infModal: {
        "@versaoModal": "4.00",
        rodo: { RNTRC: soDigitos(e.emitente.rntrc) },
      },
    },
    ...(e.responsavelTecnico
      ? {
          infRespTec: {
            CNPJ: soDigitos(e.responsavelTecnico.cnpj),
            xContato: e.responsavelTecnico.contato,
            email: e.responsavelTecnico.email,
            fone: soDigitos(e.responsavelTecnico.telefone),
          },
        }
      : {}),
  };
}

/** `dhEmi` é datetime com fuso; a SEFAZ recusa sem o offset. */
function emIso(d: Date): string {
  const brasilia = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${brasilia.getUTCFullYear()}-${p(brasilia.getUTCMonth() + 1)}-${p(brasilia.getUTCDate())}` +
    `T${p(brasilia.getUTCHours())}:${p(brasilia.getUTCMinutes())}:${p(brasilia.getUTCSeconds())}-03:00`
  );
}

function emData(d: Date): string {
  return emIso(d).slice(0, 10);
}
