/**
 * Quem do RNTRC vira lead, e quanto vale.
 *
 * Regras puras, sem banco e sem rede, porque é aqui que mora a decisão
 * comercial — e decisão comercial muda de opinião toda semana. Separado assim,
 * mudar o alvo é mexer num arquivo e rodar o teste.
 *
 * Fonte: dados abertos da ANTT (https://dados.antt.gov.br/dataset/rntrc),
 * licença CC-BY, atualizado mensalmente.
 */

/** Uma linha do CSV, já com as aspas tiradas. */
export type LinhaRntrc = {
  nomeTransportador: string;
  numeroRntrc: string;
  dataPrimeiroCadastro: string;
  situacaoRntrc: string;
  cpfCnpj: string;
  categoria: string;
  cep: string;
  municipio: string;
  uf: string;
};

export type MotivoDescarte =
  | "SITUACAO_INATIVA"
  | "UF_FORA_DO_ALVO"
  | "CATEGORIA_NAO_EMPRESA"
  | "EMPRESARIO_INDIVIDUAL";

export type Qualificacao =
  | { entra: false; motivo: MotivoDescarte }
  | { entra: true; score: number; scoreMotivo: string };

/**
 * Razão social que começa com dígito é empresário individual — a Receita monta
 * o nome como "<CNPJ> <NOME DA PESSOA>" (ex.: "11.680.983 GILBERTO RODRIGUES
 * DA SILVA").
 *
 * A gente descarta por dois motivos que apontam pro mesmo lado: quase sempre é
 * caminhoneiro com um caminhão, que não é cliente de sistema de frota; e
 * juridicamente é PESSOA NATURAL, o caso mais delicado da LGPD. O filtro
 * comercial certo é o filtro legal certo.
 */
export function ehEmpresarioIndividual(razaoSocial: string): boolean {
  return /^\d/.test(razaoSocial.trim());
}

/** dd/mm/aaaa → Date. A ANTT usa formato brasileiro. */
export function dataBr(valor: string): Date | null {
  const m = valor.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Anos completos entre a data e a referência. */
function anosDesde(data: Date, referencia: Date): number {
  return (referencia.getTime() - data.getTime()) / (365.25 * 24 * 3600 * 1000);
}

export type OpcoesQualificacao = {
  /** UFs que interessam. Vazio = todas. */
  ufs?: string[];
  /** Data de referência pro cálculo de idade do registro. Injetável pro teste. */
  agora?: Date;
};

/**
 * Nota de 0 a 100.
 *
 * O peso maior é a IDADE DO REGISTRO, e isso é a tese: empresa que acabou de
 * tirar RNTRC está comprando caminhão, contratando motorista e decidindo agora
 * como vai controlar viagem. Chegar nela seis meses depois é chegar depois do
 * caderno virar hábito. Quem roda há quinze anos já resolveu do jeito dela — dá
 * pra vender, mas é conversa mais longa.
 */
export function qualificar(
  linha: LinhaRntrc,
  opcoes: OpcoesQualificacao = {},
): Qualificacao {
  const agora = opcoes.agora ?? new Date();

  if (linha.situacaoRntrc.trim().toUpperCase() !== "ATIVO") {
    return { entra: false, motivo: "SITUACAO_INATIVA" };
  }

  const ufs = opcoes.ufs ?? [];
  if (ufs.length > 0 && !ufs.includes(linha.uf.trim().toUpperCase())) {
    return { entra: false, motivo: "UF_FORA_DO_ALVO" };
  }

  // ETC = empresa de transporte de carga. TAC é o autônomo (CPF) e CTC a
  // cooperativa; nenhum dos dois é o comprador.
  if (linha.categoria.trim().toUpperCase() !== "ETC") {
    return { entra: false, motivo: "CATEGORIA_NAO_EMPRESA" };
  }

  if (ehEmpresarioIndividual(linha.nomeTransportador)) {
    return { entra: false, motivo: "EMPRESARIO_INDIVIDUAL" };
  }

  const { score, motivo } = pontuar(
    linha.nomeTransportador,
    dataBr(linha.dataPrimeiroCadastro),
    agora,
  );

  return { entra: true, score, scoreMotivo: motivo };
}

/**
 * A nota, isolada de onde o dado veio.
 *
 * Separada de `qualificar` porque a régua muda com frequência e a base já
 * importada precisa ser repontuada sem baixar 159 MB de novo — o recálculo
 * chama esta função com o que já está no banco.
 */
export function pontuar(
  razaoSocial: string,
  registradoEm: Date | null,
  agora: Date,
): { score: number; motivo: string } {
  const idade = registradoEm ? anosDesde(registradoEm, agora) : null;

  let score = 50;
  const razoes: string[] = [];

  if (idade === null) {
    razoes.push("sem data de registro");
  } else if (idade < 1) {
    score += 35;
    razoes.push("registro de menos de 1 ano — está montando o processo agora");
  } else if (idade < 2) {
    score += 25;
    razoes.push("registro de 1 a 2 anos — ainda arrumando a operação");
  } else if (idade < 5) {
    score += 10;
    razoes.push("registro de 2 a 5 anos");
  } else if (idade > 15) {
    score -= 10;
    razoes.push("mais de 15 anos de registro — provavelmente já tem um jeito próprio");
  }

  // Sociedade anônima nessa faixa costuma ser grande demais: ou já tem TMS, ou
  // a compra passa por um comitê que não cabe numa conversa de WhatsApp.
  if (/\bS[\/.]?A\.?$|SOCIEDADE ANONIMA/i.test(razaoSocial)) {
    score -= 15;
    razoes.push("S/A — porte provavelmente acima do alvo");
  }

  const nicho = aderenciaAoNicho(razaoSocial);
  score += nicho.ajuste;
  if (nicho.razao) razoes.push(nicho.razao);

  return {
    score: Math.max(0, Math.min(100, score)),
    motivo: razoes.join("; ") || "sem sinal forte",
  };
}

/**
 * Palavras que dizem "esta empresa vende frete".
 *
 * Nem todo mundo com RNTRC é transportadora: atacadista, construtora e
 * frigorífico tiram registro pra levar a PRÓPRIA carga. Quem faz transporte
 * pra terceiro quase sempre diz isso na razão social.
 */
const TERMOS_TRANSPORTE = [
  "TRANSPORTE", "TRANSPORTADORA", "TRANSPORTES", "LOGISTICA", "LOGÍSTICA",
  "CARGAS", "CARGA", "EXPRESSO", "RODOVIARIO", "RODOVIÁRIO", "FRETE",
  "TRANSLOG", "TRANSLOGISTICA", "ENTREGAS", "MUDANCAS", "MUDANÇAS",
];

/**
 * O nicho real do Movatruck: granel — areia, brita, pedra, concreto, terra.
 * Quem move isso tem exatamente a dor que o produto resolve (ticket de balança,
 * peso, viagem por caçamba), então vale mais que uma transportadora genérica.
 */
const TERMOS_GRANEL = [
  "MINERA", "PEDREIRA", "BRITA", "AREIA", "CONCRETO", "TERRAPLENAGEM",
  "CACAMBA", "CAÇAMBA", "BASCULANTE", "AGREGADO", "ASFALTO", "USINA",
  "CONSTRUTORA", "CONSTRUCAO", "CONSTRUÇÃO", "PAVIMENTA",
];

/** Sufixos que marcam pessoa jurídica de verdade. */
const SUFIXOS_PJ = ["LTDA", "S/A", "S.A", "SA", "EIRELI", "ME", "EPP", "MEI", "SS", "S/S"];

function normalizar(texto: string): string {
  return texto.toUpperCase().replace(/[.,\-/]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Razão social que é só o nome de uma pessoa ("MARCELO SEIDEL").
 *
 * Empresário individual costuma vir com o CNPJ na frente (pego por
 * `ehEmpresarioIndividual`), mas nem sempre: às vezes a Receita registra só o
 * nome. Sem nenhum sufixo de PJ e sem nenhuma palavra de ramo, com poucas
 * palavras, é quase certamente uma pessoa — e aí é dado pessoal e um caminhão.
 */
export function pareceNomeDePessoa(razaoSocial: string): boolean {
  const n = normalizar(razaoSocial);
  const palavras = n.split(" ").filter(Boolean);

  if (palavras.length > 4) return false;
  if (SUFIXOS_PJ.some((suf) => palavras.includes(suf))) return false;
  if ([...TERMOS_TRANSPORTE, ...TERMOS_GRANEL].some((t) => n.includes(t))) return false;
  if (/\d/.test(n)) return false;

  return palavras.length >= 2;
}

/** Ajuste de nota por aderência ao que o Movatruck resolve. */
export function aderenciaAoNicho(razaoSocial: string): { ajuste: number; razao: string | null } {
  const n = normalizar(razaoSocial);

  if (pareceNomeDePessoa(razaoSocial)) {
    return { ajuste: -30, razao: "razão social é nome de pessoa — provavelmente um caminhão só" };
  }

  const granel = TERMOS_GRANEL.some((t) => n.includes(t));
  const transporte = TERMOS_TRANSPORTE.some((t) => n.includes(t));

  if (granel && transporte) {
    return { ajuste: 20, razao: "transporte de granel — é exatamente o nicho do produto" };
  }
  if (granel) {
    return { ajuste: 12, razao: "ramo de granel/construção — carga própria, mas a dor é a mesma" };
  }
  if (transporte) {
    return { ajuste: 8, razao: "transportadora — vende frete" };
  }

  return {
    ajuste: -18,
    razao: "razão social não indica transporte — pode ser frota própria de outro ramo",
  };
}
