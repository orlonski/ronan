import { z } from "zod";
import { ASSINATURA_MAX } from "./viagem-lifecycle";

/**
 * ETAPAS DA VIAGEM — os papéis de cada momento da viagem (carregamento,
 * descarga, acerto do frete), preenchidos no app e presos àquela viagem.
 *
 * Módulo `etapas` (adicional, NÃO depende do Financeiro: não mexe em dinheiro).
 * Capacidade do app `app.viagem.etapas` (nasce DESLIGADA; piloto liga por
 * pessoa). Desenho: docs/etapas-viagem/04-proposta.md ("Pra quem implementa").
 *
 * Três regras que este arquivo carrega e que valem igual no app e na API:
 *
 *  1. A DEFINIÇÃO do formulário é JSON versionado e imutável por versão. O
 *     painel grava pelo Zod ESTRITO (`DefinicaoEtapaInput`); quem lê (app com
 *     cache velho, API, painel) passa SEMPRE por `lerDefinicaoEtapa`, que nunca
 *     lança e pula o tipo de item que não conhece.
 *  2. O que FALTA é calculado na leitura (`calcularEstadoEtapas`): viagem ×
 *     modelos aplicáveis × respostas × dispensas/anexos. Resposta que não
 *     existe = todos os obrigatórios faltando. Nada disso mora em
 *     `ViagemDivergencia` — a fila da conferência de ticket não muda.
 *  3. Faltar documento NUNCA impede nada. "Não seguir viagem sem este" é uma
 *     parada com motivo na próxima ação do motorista, nunca uma trava, e o
 *     documento faltando não segura o faturamento.
 */

// ─── Vocabulário ─────────────────────────────────────────────────────────────

/**
 * Quando o formulário aparece.
 * - INICIO: logo depois de "Começar viagem" (é a carga);
 * - FIM: logo depois de "Finalizar viagem" (é a descarga);
 * - AVULSA: não abre sozinho — espera na tela inicial (acerto do frete);
 * - EVENTO: só pros tipos EXTRAS do catálogo de paradas. Carga e descarga são
 *   bookends fixos do app e nunca geram `EventoViagem` na guiada.
 */
export const MOMENTOS_ETAPA = ["INICIO", "FIM", "AVULSA", "EVENTO"] as const;
export type MomentoEtapa = (typeof MOMENTOS_ETAPA)[number];

export const MOMENTO_ETAPA_LABEL: Record<MomentoEtapa, string> = {
  INICIO: "Ao começar a viagem (carga)",
  FIM: "Ao finalizar a viagem (descarga)",
  AVULSA: "Depois, quando ele quiser (ex.: acerto do frete)",
  EVENTO: "Junto de uma parada da viagem",
};

export const TIPOS_ITEM_ETAPA = [
  "FOTO",
  "FOTO_OU_PDF",
  "SIM_NAO",
  "VALOR",
  "NUMERO",
  "TEXTO",
  "TEXTO_COM_FOTO",
  "ASSINATURA",
] as const;
export type TipoItemEtapa = (typeof TIPOS_ITEM_ETAPA)[number];

export const TIPO_ITEM_ETAPA_LABEL: Record<TipoItemEtapa, string> = {
  FOTO: "Foto (uma ou várias)",
  FOTO_OU_PDF: "Foto ou PDF",
  SIM_NAO: "Sim / Não",
  VALOR: "Valor (R$)",
  NUMERO: "Número",
  TEXTO: "Texto",
  TEXTO_COM_FOTO: "Texto + foto",
  ASSINATURA: "Assinatura",
};

/** Tipos que guardam arquivo (foto e/ou PDF). */
export const TIPOS_COM_ARQUIVO: readonly TipoItemEtapa[] = ["FOTO", "FOTO_OU_PDF", "TEXTO_COM_FOTO", "SIM_NAO"];

/**
 * "Se faltar":
 * - AVISAR (padrão): aparece como "documento faltando" na viagem;
 * - NAO_SEGUIR: igual, e na próxima ação do motorista o app para um instante
 *   ("O escritório precisa deste documento") e oferece anexar ou seguir dizendo
 *   o motivo. Nunca trava.
 */
export const SE_FALTAR = ["AVISAR", "NAO_SEGUIR"] as const;
export type SeFaltar = (typeof SE_FALTAR)[number];

/** Depois de Sim ou de Não: não pede / pede (opcional) / exige. */
export const MODOS_EXTRA_SIM_NAO = ["NAO", "PEDE", "EXIGE"] as const;
export type ModoExtraSimNao = (typeof MODOS_EXTRA_SIM_NAO)[number];

/** Os motivos de "Seguir sem isso". OUTRO exige o texto. */
export const MOTIVOS_SEGUIR_SEM = ["JA_COM_ESCRITORIO", "AINDA_NAO_RECEBI", "VOU_MANDAR_DEPOIS", "OUTRO"] as const;
export type MotivoSeguirSem = (typeof MOTIVOS_SEGUIR_SEM)[number];

export const MOTIVO_SEGUIR_SEM_LABEL: Record<MotivoSeguirSem, string> = {
  JA_COM_ESCRITORIO: "Já está com o escritório",
  AINDA_NAO_RECEBI: "Ainda não recebi",
  VOU_MANDAR_DEPOIS: "Vou mandar mais tarde",
  OUTRO: "Outro motivo",
};

/** Teto de arquivo do upload (foto ou PDF). */
export const ETAPA_ARQUIVO_MAX_BYTES = 10 * 1024 * 1024;
export const ETAPA_MAX_ARQUIVOS_POR_ITEM = 10;
export const ETAPA_MAX_ITENS = 60;
export const ETAPA_MAX_AREAS = 20;
/** Até quantos dias depois de finalizar ainda dá pra preencher (padrão). */
export const ETAPA_JANELA_DIAS_PADRAO = 30;

/** O `d` do AssinaturaPad (300×150). Mesma regra de `assinaturaRecebedor`. */
export const ASSINATURA_ETAPA_REGEX = /^[MLQ0-9.\s,-]+$/;

// ─── Definição (o formulário que a empresa monta) ───────────────────────────

const ChaveItem = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "Chave do item: até 40 letras, números, _ ou -.");

const ExtraSimNaoSchema = z
  .object({ foto: z.enum(MODOS_EXTRA_SIM_NAO), comentario: z.enum(MODOS_EXTRA_SIM_NAO) })
  .strict();

export const ItemEtapaInput = z
  .object({
    /** Estável entre versões: é o que liga as respostas no tempo. */
    chave: ChaveItem,
    rotulo: z.string().trim().min(1).max(120),
    ajuda: z.string().trim().max(200).optional(),
    tipo: z.enum(TIPOS_ITEM_ETAPA),
    obrigatorio: z.boolean(),
    seFaltar: z.enum(SE_FALTAR).default("AVISAR"),
    /** O escritório também pode anexar este documento (ex.: comprovante de encerramento do MDF-e). */
    escritorioPodeAnexar: z.boolean().default(false),
    /** FOTO / FOTO_OU_PDF / TEXTO_COM_FOTO: quantos arquivos. */
    fotos: z
      .object({ min: z.number().int().min(0).max(ETAPA_MAX_ARQUIVOS_POR_ITEM), max: z.number().int().min(1).max(ETAPA_MAX_ARQUIVOS_POR_ITEM) })
      .strict()
      .optional(),
    /** SIM_NAO: o que pedir depois de cada resposta. */
    simNao: z.object({ aoSim: ExtraSimNaoSchema, aoNao: ExtraSimNaoSchema }).strict().optional(),
    /** VALOR: é a "tarifa por tonelada" — o painel compara com a tabela de preço (nunca muda o valor). */
    valor: z.object({ comparaTabelaPorTonelada: z.boolean() }).strict().optional(),
    /** NUMERO: unidade mostrada ao lado ("km", "kg") e casas decimais. */
    numero: z.object({ unidade: z.string().trim().max(12).optional(), casas: z.number().int().min(0).max(3) }).strict().optional(),
    /** ASSINATURA: pede o nome de quem assina. */
    assinatura: z.object({ pedeNome: z.boolean() }).strict().optional(),
  })
  .strict();
export type ItemEtapaInput = z.infer<typeof ItemEtapaInput>;

export const AreaEtapaInput = z
  .object({
    titulo: z.string().trim().min(1).max(80),
    itens: z.array(ItemEtapaInput).min(1).max(ETAPA_MAX_ITENS),
  })
  .strict();
export type AreaEtapaInput = z.infer<typeof AreaEtapaInput>;

/**
 * Zod ESTRITO da definição (o painel grava por aqui). Gravar lixo e confiar no
 * leitor tolerante seria esconder o erro de quem monta o formulário.
 */
export const DefinicaoEtapaInput = z
  .object({
    v: z.literal(1),
    areas: z.array(AreaEtapaInput).min(1).max(ETAPA_MAX_AREAS),
  })
  .strict()
  .superRefine((d, ctx) => {
    const vistas = new Set<string>();
    let total = 0;
    d.areas.forEach((a, ai) =>
      a.itens.forEach((it, ii) => {
        total++;
        const path = ["areas", ai, "itens", ii];
        if (vistas.has(it.chave)) {
          ctx.addIssue({ code: "custom", path: [...path, "chave"], message: "Dois itens com a mesma chave." });
        }
        vistas.add(it.chave);
        if (it.seFaltar === "NAO_SEGUIR" && !it.obrigatorio) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "seFaltar"],
            message: "\"Não seguir viagem sem este\" só vale pra item obrigatório.",
          });
        }
        if (it.fotos && it.fotos.min > it.fotos.max) {
          ctx.addIssue({ code: "custom", path: [...path, "fotos"], message: "O mínimo de fotos passa do máximo." });
        }
      }),
    );
    if (total > ETAPA_MAX_ITENS) {
      ctx.addIssue({ code: "custom", path: ["areas"], message: `No máximo ${ETAPA_MAX_ITENS} itens por formulário.` });
    }
  });
export type DefinicaoEtapaInput = z.infer<typeof DefinicaoEtapaInput>;

/** Item JÁ RESOLVIDO pelo leitor (todos os campos presentes). */
export type ItemEtapa = {
  chave: string;
  rotulo: string;
  ajuda: string | null;
  tipo: TipoItemEtapa;
  obrigatorio: boolean;
  seFaltar: SeFaltar;
  escritorioPodeAnexar: boolean;
  fotos: { min: number; max: number };
  simNao: { aoSim: { foto: ModoExtraSimNao; comentario: ModoExtraSimNao }; aoNao: { foto: ModoExtraSimNao; comentario: ModoExtraSimNao } };
  valor: { comparaTabelaPorTonelada: boolean };
  numero: { unidade: string | null; casas: number };
  assinatura: { pedeNome: boolean };
};
export type AreaEtapa = { titulo: string; itens: ItemEtapa[] };
export type DefinicaoEtapa = { v: 1; areas: AreaEtapa[] };

const ehObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const inteiro = (v: unknown, min: number, max: number, padrao: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : padrao;
const umDe = <T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T =>
  typeof v === "string" && (opcoes as readonly string[]).includes(v) ? (v as T) : padrao;

function lerExtra(v: unknown): { foto: ModoExtraSimNao; comentario: ModoExtraSimNao } {
  const o = ehObj(v) ? v : {};
  return {
    foto: umDe(o.foto, MODOS_EXTRA_SIM_NAO, "NAO"),
    comentario: umDe(o.comentario, MODOS_EXTRA_SIM_NAO, "NAO"),
  };
}

/** Um item cru → resolvido, ou null se não dá pra mostrar (tipo desconhecido, sem chave/rótulo). */
export function lerItemEtapa(bruto: unknown): ItemEtapa | null {
  if (!ehObj(bruto)) return null;
  const tipo = typeof bruto.tipo === "string" && (TIPOS_ITEM_ETAPA as readonly string[]).includes(bruto.tipo)
    ? (bruto.tipo as TipoItemEtapa)
    : null;
  const chave = typeof bruto.chave === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(bruto.chave) ? bruto.chave : null;
  const rotulo = texto(bruto.rotulo, 120);
  if (!tipo || !chave || !rotulo) return null;
  const obrigatorio = bruto.obrigatorio === true;
  const fotosBrutas = ehObj(bruto.fotos) ? bruto.fotos : {};
  const minPadrao = tipo === "FOTO" || tipo === "FOTO_OU_PDF" || tipo === "TEXTO_COM_FOTO" ? 1 : 0;
  const max = inteiro(fotosBrutas.max, 1, ETAPA_MAX_ARQUIVOS_POR_ITEM, ETAPA_MAX_ARQUIVOS_POR_ITEM);
  const min = Math.min(max, inteiro(fotosBrutas.min, 0, ETAPA_MAX_ARQUIVOS_POR_ITEM, minPadrao));
  const sn = ehObj(bruto.simNao) ? bruto.simNao : {};
  const val = ehObj(bruto.valor) ? bruto.valor : {};
  const num = ehObj(bruto.numero) ? bruto.numero : {};
  const ass = ehObj(bruto.assinatura) ? bruto.assinatura : {};
  return {
    chave,
    rotulo,
    ajuda: texto(bruto.ajuda, 200),
    tipo,
    obrigatorio,
    // NAO_SEGUIR em item opcional não tem o que parar: vira AVISAR.
    seFaltar: obrigatorio ? umDe(bruto.seFaltar, SE_FALTAR, "AVISAR") : "AVISAR",
    escritorioPodeAnexar: bruto.escritorioPodeAnexar === true,
    fotos: { min, max },
    simNao: { aoSim: lerExtra(sn.aoSim), aoNao: lerExtra(sn.aoNao) },
    valor: { comparaTabelaPorTonelada: val.comparaTabelaPorTonelada === true },
    numero: { unidade: texto(num.unidade, 12), casas: inteiro(num.casas, 0, 3, 0) },
    assinatura: { pedeNome: ass.pedeNome === true },
  };
}

/**
 * Leitor TOTAL da definição: nunca lança.
 * - forma desconhecida (`v` ≠ 1, não-objeto) → formulário vazio;
 * - item de tipo que este código não conhece → pulado (app velho, tipo novo);
 * - área sem nenhum item mostrável → pulada;
 * - chave repetida → fica a primeira.
 */
export function lerDefinicaoEtapa(json: unknown): DefinicaoEtapa {
  const vazio: DefinicaoEtapa = { v: 1, areas: [] };
  if (!ehObj(json) || json.v !== 1 || !Array.isArray(json.areas)) return vazio;
  const vistas = new Set<string>();
  const areas: AreaEtapa[] = [];
  for (const a of json.areas.slice(0, ETAPA_MAX_AREAS)) {
    if (!ehObj(a) || !Array.isArray(a.itens)) continue;
    const itens: ItemEtapa[] = [];
    for (const bruto of a.itens) {
      const it = lerItemEtapa(bruto);
      if (!it || vistas.has(it.chave)) continue;
      vistas.add(it.chave);
      itens.push(it);
    }
    if (itens.length) areas.push({ titulo: texto(a.titulo, 80) ?? "Documentos", itens });
  }
  return { v: 1, areas };
}

/** Todos os itens da definição, na ordem da tela, com o título da área. */
export function itensDaDefinicao(d: DefinicaoEtapa): (ItemEtapa & { area: string })[] {
  return d.areas.flatMap((a) => a.itens.map((it) => ({ ...it, area: a.titulo })));
}

// ─── O que conta como "respondido" ──────────────────────────────────────────

/** O estado de um item como o servidor (ou o celular) o conhece. */
export type EstadoRespostaItem = {
  simNao?: boolean | null;
  texto?: string | null;
  numero?: number | null;
  valor?: number | null;
  comentario?: string | null;
  assinatura?: string | null;
  assinanteNome?: string | null;
  /** Arquivos vivos (não removidos) do item. */
  arquivos?: number;
};

const preenchido = (s: string | null | undefined) => typeof s === "string" && s.trim().length > 0;

/**
 * O item está completo? Regra única, usada no app (barreira e contador) e no
 * servidor (pendência). Item opcional vazio não está "completo", mas também
 * não falta — quem decide falta é `obrigatorio`.
 */
export function itemCompleto(item: ItemEtapa, r: EstadoRespostaItem | null | undefined): boolean {
  if (!r) return false;
  const arquivos = r.arquivos ?? 0;
  const minArquivos = Math.max(1, item.fotos.min);
  switch (item.tipo) {
    case "FOTO":
    case "FOTO_OU_PDF":
      return arquivos >= minArquivos;
    case "TEXTO_COM_FOTO":
      return preenchido(r.texto) && arquivos >= minArquivos;
    case "TEXTO":
      return preenchido(r.texto);
    case "VALOR":
      return r.valor != null && Number.isFinite(r.valor);
    case "NUMERO":
      return r.numero != null && Number.isFinite(r.numero);
    case "ASSINATURA":
      return preenchido(r.assinatura) && (!item.assinatura.pedeNome || preenchido(r.assinanteNome));
    case "SIM_NAO": {
      if (r.simNao !== true && r.simNao !== false) return false;
      const extra = r.simNao ? item.simNao.aoSim : item.simNao.aoNao;
      if (extra.foto === "EXIGE" && arquivos < 1) return false;
      if (extra.comentario === "EXIGE" && !preenchido(r.comentario)) return false;
      return true;
    }
  }
}

// ─── Pendência calculada na leitura ─────────────────────────────────────────

export type AcaoPendenciaTipo = "SEGUIU_SEM" | "DISPENSADO" | "ANEXADO_ESCRITORIO";

export type EntradaEstadoEtapas = {
  viagem: {
    /** Finalizada = saiu de EM_ANDAMENTO (inclui AGUARDANDO_PESO, INCOMPLETA…). */
    finalizada: boolean;
    /** Tipos de evento já registrados (pro momento EVENTO). */
    tiposEventoRegistrados: readonly string[];
  };
  /** Os modelos que valem pra esta viagem, já com a versão que manda. */
  modelos: readonly {
    modeloId: string;
    nome: string;
    momento: MomentoEtapa;
    tipoEventoId: string | null;
    versaoId: string;
    definicao: DefinicaoEtapa;
  }[];
  respostas: readonly {
    modeloId: string;
    concluida: boolean;
    itens: Readonly<Record<string, EstadoRespostaItem>>;
  }[];
  /** Ações vivas (desfeitas ficam de fora). `itemChave` null = o formulário inteiro (só DISPENSADO). */
  acoes: readonly {
    modeloId: string;
    itemChave: string | null;
    tipo: AcaoPendenciaTipo;
    motivo: string | null;
    motivoCodigo?: MotivoSeguirSem | null;
    em: string;
  }[];
};

export type EstadoItemEtapa = "FEITO" | "FALTANDO" | "DISPENSADO" | "ANEXADO_ESCRITORIO" | "OPCIONAL_VAZIO";

export type ItemFaltando = {
  itemChave: string;
  rotulo: string;
  area: string;
  tipo: TipoItemEtapa;
  seFaltar: SeFaltar;
  escritorioPodeAnexar: boolean;
  /** O motorista já "seguiu sem" este item (a última vez). */
  seguiuSem: { motivoCodigo: MotivoSeguirSem | null; motivo: string | null; em: string } | null;
};

/**
 * - AINDA_NAO: o momento ainda não chegou (descarga com a viagem em andamento,
 *   evento não registrado). Não conta como documento faltando.
 * - COMPLETA: nenhum obrigatório faltando.
 * - FALTANDO: algum obrigatório faltando (mesmo que ele nunca tenha aberto).
 */
export type SituacaoEtapa = "AINDA_NAO" | "COMPLETA" | "FALTANDO";

export type EstadoEtapa = {
  modeloId: string;
  nome: string;
  momento: MomentoEtapa;
  versaoId: string;
  situacao: SituacaoEtapa;
  /** Existe resposta do motorista (abriu e mandou alguma coisa). */
  respondida: boolean;
  /** Ele tocou "Concluir". */
  concluida: boolean;
  totalItens: number;
  itensFeitos: number;
  itens: { chave: string; estado: EstadoItemEtapa }[];
  /** Só os obrigatórios faltando — mesmo quando o momento ainda não chegou. */
  faltando: ItemFaltando[];
  /** Algum faltando é "não seguir viagem sem este" (e o momento já chegou). */
  pedeMotivoPraSeguir: boolean;
};

export type EstadoEtapasViagem = {
  etapas: EstadoEtapa[];
  /** Quantos obrigatórios faltam nas etapas cujo momento já chegou. */
  documentosFaltando: number;
};

function momentoChegou(
  m: { momento: MomentoEtapa; tipoEventoId: string | null },
  v: EntradaEstadoEtapas["viagem"],
): boolean {
  switch (m.momento) {
    case "INICIO":
      return true;
    case "FIM":
    case "AVULSA":
      return v.finalizada;
    case "EVENTO":
      return !!m.tipoEventoId && v.tiposEventoRegistrados.includes(m.tipoEventoId);
  }
}

/**
 * O que falta numa viagem. Função PURA: o servidor monta a entrada com o que
 * leu do banco, o app com o que tem no celular — a regra é uma só.
 *
 * Resposta inexistente = todos os obrigatórios faltando (B2 do QA): o
 * formulário que ninguém abriu é justamente o que o escritório precisa ver.
 * Dispensa ou anexo do escritório suprem o item; "seguiu sem" NÃO supre — só
 * anota o motivo ao lado.
 */
export function calcularEstadoEtapas(e: EntradaEstadoEtapas): EstadoEtapasViagem {
  const etapas: EstadoEtapa[] = [];
  let documentosFaltando = 0;
  for (const m of e.modelos) {
    const resposta = e.respostas.find((r) => r.modeloId === m.modeloId) ?? null;
    const acoes = e.acoes.filter((a) => a.modeloId === m.modeloId);
    const dispensadoInteiro = acoes.some((a) => a.tipo === "DISPENSADO" && a.itemChave == null);
    const chegou = momentoChegou(m, e.viagem);
    const itens: EstadoEtapa["itens"] = [];
    const faltando: ItemFaltando[] = [];
    let feitos = 0;
    for (const it of itensDaDefinicao(m.definicao)) {
      const doItem = acoes.filter((a) => a.itemChave === it.chave);
      let estado: EstadoItemEtapa;
      if (itemCompleto(it, resposta?.itens[it.chave])) estado = "FEITO";
      else if (doItem.some((a) => a.tipo === "ANEXADO_ESCRITORIO")) estado = "ANEXADO_ESCRITORIO";
      else if (dispensadoInteiro || doItem.some((a) => a.tipo === "DISPENSADO")) estado = "DISPENSADO";
      else estado = it.obrigatorio ? "FALTANDO" : "OPCIONAL_VAZIO";
      if (estado !== "FALTANDO" && estado !== "OPCIONAL_VAZIO") feitos++;
      itens.push({ chave: it.chave, estado });
      if (estado === "FALTANDO") {
        const seguiu = doItem
          .filter((a) => a.tipo === "SEGUIU_SEM")
          .sort((a, b) => (a.em < b.em ? 1 : -1))[0];
        faltando.push({
          itemChave: it.chave,
          rotulo: it.rotulo,
          area: it.area,
          tipo: it.tipo,
          seFaltar: it.seFaltar,
          escritorioPodeAnexar: it.escritorioPodeAnexar,
          seguiuSem: seguiu ? { motivoCodigo: seguiu.motivoCodigo ?? null, motivo: seguiu.motivo, em: seguiu.em } : null,
        });
      }
    }
    const situacao: SituacaoEtapa = !chegou ? "AINDA_NAO" : faltando.length ? "FALTANDO" : "COMPLETA";
    if (situacao === "FALTANDO") documentosFaltando += faltando.length;
    etapas.push({
      modeloId: m.modeloId,
      nome: m.nome,
      momento: m.momento,
      versaoId: m.versaoId,
      situacao,
      respondida: !!resposta,
      concluida: !!resposta?.concluida,
      totalItens: itens.length,
      itensFeitos: feitos,
      itens,
      faltando,
      pedeMotivoPraSeguir: chegou && faltando.some((f) => f.seFaltar === "NAO_SEGUIR"),
    });
  }
  return { etapas, documentosFaltando };
}

// ─── Catálogo (o que o app baixa) ───────────────────────────────────────────

/**
 * Um modelo no `/m/catalogos` (`modelosEtapa`) e no `GET /m/etapas/modelos`.
 * Só os ATIVOS com versão publicada, na ordem do painel. Sem o módulo `etapas`
 * a lista vem VAZIA. `definicao` já sai resolvida pelo leitor — mas o app lê
 * de novo por `lerDefinicaoEtapa` (o cache dele pode ser de outra versão do código).
 */
export type ModeloEtapaCatalogo = {
  id: string;
  nome: string;
  momento: MomentoEtapa;
  /** Só no momento EVENTO. */
  tipoEventoId: string | null;
  /** Até quantos dias depois de finalizar o app ainda oferece. */
  janelaDias: number;
  ordem: number;
  versaoId: string;
  versao: number;
  definicao: DefinicaoEtapa;
};

// ─── Rotas do motorista (/m/etapas/*) ───────────────────────────────────────

const Uuid = z.string().uuid();
const TextoOpc = (max: number) => z.string().trim().max(max).optional().nullable();

export const ArquivoRespostaInput = z.object({
  /** A `storageKey` devolvida por `POST /m/uploads/etapa`. */
  storageKey: z.string().min(1).max(400),
  /** O que o upload devolveu (`image/jpeg`, `application/pdf`…). Informativo: o servidor guarda o do upload. */
  mime: z.string().max(100).optional().nullable(),
  /** Nome do arquivo escolhido (PDF), pra mostrar. */
  nome: TextoOpc(200),
});
export type ArquivoRespostaInput = z.infer<typeof ArquivoRespostaInput>;

export const ItemRespostaInput = z.object({
  chave: ChaveItem,
  simNao: z.boolean().optional().nullable(),
  texto: TextoOpc(500),
  numero: z.number().finite().min(-1e9).max(1e9).optional().nullable(),
  valor: z.number().finite().min(0).max(10_000_000).optional().nullable(),
  comentario: TextoOpc(500),
  /** Traço como `d` de path SVG, num quadro de 300×150. */
  assinatura: z.string().max(ASSINATURA_MAX).regex(ASSINATURA_ETAPA_REGEX, "Assinatura inválida.").optional().nullable(),
  assinanteNome: TextoOpc(120),
  /** Arquivos do item. SOMA com o que já subiu (nunca apaga sozinho). */
  arquivos: z.array(ArquivoRespostaInput).max(ETAPA_MAX_ARQUIVOS_POR_ITEM).default([]),
  /** `storageKey`s que ele apagou ("Apagar esta foto?"). Só assim um arquivo sai. */
  arquivosRemovidos: z.array(z.string().min(1).max(400)).max(ETAPA_MAX_ARQUIVOS_POR_ITEM).default([]),
  /**
   * Quando ele mexeu neste item (relógio do aparelho). Desempata dois envios:
   * o mais novo vence, o mais velho não desfaz o mais novo.
   */
  respondidoEm: z.coerce.date(),
});
export type ItemRespostaInput = z.infer<typeof ItemRespostaInput>;

/**
 * POST /m/etapas — cria OU MESCLA a resposta de (viagem, modelo). Sempre 200.
 *
 * - Chave natural: (`viagemClientId`, `modeloId`). Outro `clientId` pro mesmo
 *   par (reinstalou o app, outro celular) MESCLA, nunca 409.
 * - Item ausente no corpo fica como está ("o que vier depois soma").
 * - Item presente: valores escalares trocam se `respondidoEm` for mais novo
 *   que o gravado (o anterior vai pro histórico); arquivos SOMAM;
 *   `arquivosRemovidos` tira.
 * - A viagem não precisa existir ainda no servidor (amarra quando chegar).
 *   Viagem finalizada é aceita; passada a janela, aceita e carimba.
 * - Sem o módulo `etapas` na conta: aceita e carimba. Nunca 403.
 */
export const ResponderEtapaInput = z.object({
  /** Gerado no celular, uma vez por resposta. */
  clientId: Uuid,
  viagemClientId: Uuid,
  modeloId: Uuid,
  /** A versão que ELE viu (`versaoId` do catálogo). */
  versaoId: Uuid,
  itens: z.array(ItemRespostaInput).max(ETAPA_MAX_ITENS).default([]),
  /** Ele tocou "Concluir" (ou "Concluir e mandar depois"). Nunca volta a false. */
  concluida: z.boolean().optional(),
  /** Abriu a tela (aparelho). */
  iniciadaEm: z.coerce.date().optional().nullable(),
  /** Tocou Concluir (aparelho). */
  concluidaEm: z.coerce.date().optional().nullable(),
  /** GPS do fim do preenchimento. Precisão é float. */
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  precisao: z.number().nonnegative().optional().nullable(),
  /** Ficou guardado no celular esperando sinal desde… */
  criadoOfflineEm: z.coerce.date().optional().nullable(),
});
export type ResponderEtapaInput = z.infer<typeof ResponderEtapaInput>;

/**
 * POST /m/etapas/seguiu-sem — "Seguir sem isso" na barreira. Idempotente por
 * `clientId`. Não precisa da resposta existir (o formulário pode nunca ter
 * sido aberto) nem da viagem ter chegado.
 */
export const SeguiuSemEtapaInput = z
  .object({
    clientId: Uuid,
    viagemClientId: Uuid,
    modeloId: Uuid,
    /** As chaves dos itens "não seguir sem este" que ele deixou pra trás. */
    itens: z.array(ChaveItem).min(1).max(ETAPA_MAX_ITENS),
    motivoCodigo: z.enum(MOTIVOS_SEGUIR_SEM),
    /** Obrigatório quando OUTRO. */
    motivoTexto: TextoOpc(300),
    /** Em que ação a barreira apareceu. */
    acao: z.enum(["FINALIZAR", "INICIAR_PROXIMA", "OUTRA"]),
    ocorridoEm: z.coerce.date(),
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
    precisao: z.number().nonnegative().optional().nullable(),
  })
  .refine((v) => v.motivoCodigo !== "OUTRO" || (v.motivoTexto ?? "").trim().length >= 3, {
    message: "Escreva o motivo.",
    path: ["motivoTexto"],
  });
export type SeguiuSemEtapaInput = z.infer<typeof SeguiuSemEtapaInput>;

/** GET /m/etapas e GET /m/etapas/pendencias. Sem `viagemClientId`: as viagens recentes dele. */
export const ListarEtapasMotoristaQuery = z.object({
  viagemClientId: Uuid.optional(),
});
export type ListarEtapasMotoristaQuery = z.infer<typeof ListarEtapasMotoristaQuery>;

/** POST /m/uploads/etapa (multipart, campo `arquivo`) devolve isto. */
export type UploadEtapaResposta = { storageKey: string; sha256: string; mime: string; tamanho: number };

export type ArquivoEtapaDoMotorista = {
  id: string;
  storageKey: string;
  mime: string;
  nome: string | null;
  /** `GET /m/etapas/arquivos/:id` (com o token). */
  url: string;
};

export type ItemRespostaDoMotorista = {
  chave: string;
  simNao: boolean | null;
  texto: string | null;
  numero: number | null;
  valor: number | null;
  comentario: string | null;
  assinatura: string | null;
  assinanteNome: string | null;
  respondidoEm: string;
  corrigidoEm: string | null;
  arquivos: ArquivoEtapaDoMotorista[];
};

export type RespostaEtapaDoMotorista = {
  id: string;
  clientId: string;
  viagemClientId: string;
  viagemId: string | null;
  modeloId: string;
  versaoId: string;
  modeloNome: string;
  momento: MomentoEtapa;
  concluida: boolean;
  concluidaEm: string | null;
  recebidoEm: string;
  atualizadoEm: string;
  itens: ItemRespostaDoMotorista[];
};

/** Resposta do POST /m/etapas. `estado` é a pendência já recalculada desta viagem (null se a viagem não chegou). */
export type ResponderEtapaResposta = { resposta: RespostaEtapaDoMotorista; estado: EstadoEtapasViagem | null };

/** Pendências de UMA viagem, do ponto de vista do motorista. */
export type PendenciasViagemMotorista = {
  viagemClientId: string;
  viagemId: string | null;
  /** "12/10 · Sorriso → Rondonópolis". */
  resumo: string;
  finalizada: boolean;
  estado: EstadoEtapasViagem;
};

/** GET /m/etapas?viagemClientId= */
export type EtapasDoMotoristaResposta = {
  respostas: RespostaEtapaDoMotorista[];
  pendencias: PendenciasViagemMotorista[];
};

/** GET /m/etapas/pendencias — só viagens com algo a fazer (alguma etapa FALTANDO ou AINDA_NAO incompleta). */
export type PendenciasEtapaMotoristaResposta = {
  viagens: PendenciasViagemMotorista[];
  /** Soma de `documentosFaltando` (o número do bloco da tela inicial). */
  total: number;
};

/** O que vai no 4xx das rotas do motorista. 4xx manda o item pros Pendentes; nunca 500. */
export const CODIGOS_ERRO_ETAPA = {
  ARQUIVO_INVALIDO: "ARQUIVO_INVALIDO",
  MODELO_INEXISTENTE: "ITEM_INEXISTENTE",
  VIAGEM_DE_OUTRO_MOTORISTA: "VIAGEM_DE_OUTRO_MOTORISTA",
  CADASTRO_NAO_APROVADO: "CADASTRO_NAO_APROVADO",
} as const;

/** Carimbos da resposta (nunca recusa: marca). */
export const MARCAS_RESPOSTA_ETAPA = ["SEM_MODULO", "FORA_DA_JANELA", "MODELO_INATIVO", "VERSAO_ANTIGA"] as const;
export type MarcaRespostaEtapa = (typeof MARCAS_RESPOSTA_ETAPA)[number];

export const MARCA_RESPOSTA_ETAPA_LABEL: Record<MarcaRespostaEtapa, string> = {
  SEM_MODULO: "Chegou com o módulo desligado",
  FORA_DA_JANELA: "Mandado depois do prazo",
  MODELO_INATIVO: "O formulário já estava desativado",
  VERSAO_ANTIGA: "Preenchido numa versão antiga do formulário",
};

// ─── Painel (admin/*) ────────────────────────────────────────────────────────

export const SalvarModeloEtapaInput = z
  .object({
    nome: z.string().trim().min(2).max(60),
    momento: z.enum(MOMENTOS_ETAPA),
    tipoEventoId: Uuid.optional().nullable(),
    janelaDias: z.number().int().min(1).max(180).default(ETAPA_JANELA_DIAS_PADRAO),
    ativo: z.boolean().default(true),
    definicao: DefinicaoEtapaInput,
  })
  .refine((v) => v.momento !== "EVENTO" || !!v.tipoEventoId, {
    message: "Escolha a parada em que o formulário aparece.",
    path: ["tipoEventoId"],
  });
export type SalvarModeloEtapaInput = z.infer<typeof SalvarModeloEtapaInput>;

export const ReordenarModelosEtapaInput = z.object({ ids: z.array(Uuid).min(1).max(100) });
export type ReordenarModelosEtapaInput = z.infer<typeof ReordenarModelosEtapaInput>;

export type ModeloEtapaPainel = {
  id: string;
  nome: string;
  momento: MomentoEtapa;
  tipoEventoId: string | null;
  tipoEventoNome: string | null;
  janelaDias: number;
  ordem: number;
  ativo: boolean;
  versao: number | null;
  versaoId: string | null;
  publicadaEm: string | null;
  definicao: DefinicaoEtapa;
  criadoEm: string;
  alteradoEm: string;
};

export const DispensarEtapaInput = z.object({
  modeloId: Uuid,
  /** null = o formulário inteiro. */
  itemChave: ChaveItem.optional().nullable(),
  motivo: z.string().trim().min(3, "Escreva o motivo.").max(300),
});
export type DispensarEtapaInput = z.infer<typeof DispensarEtapaInput>;

/** Campos do multipart de "Anexar pelo escritório" (o arquivo vai em `arquivo`). */
export const AnexarEtapaInput = z.object({
  modeloId: Uuid,
  itemChave: ChaveItem,
  observacao: z.string().trim().max(300).optional().nullable(),
});
export type AnexarEtapaInput = z.infer<typeof AnexarEtapaInput>;

export type ArquivoEtapaPainel = {
  id: string;
  mime: string;
  nome: string | null;
  tamanho: number | null;
  /** `GET /admin/etapas/arquivos/:id` — buscar como blob, com o token. */
  url: string;
  enviadoEm: string;
  removidoEm: string | null;
};

export type AcaoEtapaPainel = {
  id: string;
  tipo: AcaoPendenciaTipo;
  itemChave: string | null;
  motivoCodigo: MotivoSeguirSem | null;
  motivo: string | null;
  autor: string | null;
  porMotorista: boolean;
  em: string;
  lat: number | null;
  lng: number | null;
  arquivo: ArquivoEtapaPainel | null;
  desfeitoEm: string | null;
};

export type ItemRespostaPainel = ItemRespostaDoMotorista & {
  arquivosPainel: ArquivoEtapaPainel[];
  /** Valores anteriores, do mais novo pro mais velho. */
  historico: { em: string; antes: Record<string, unknown> }[];
};

/** A tarifa por tonelada que ele informou × a da tabela de preço da viagem. Nunca muda o valor da viagem. */
export type ComparacaoTarifa = {
  itemChave: string;
  informada: number;
  tabela: number | null;
  /** null quando não há preço por tonelada pra comparar. */
  diferente: boolean | null;
};

export type EtapaDaViagemPainel = {
  modeloId: string;
  nome: string;
  momento: MomentoEtapa;
  versaoId: string;
  versao: number | null;
  definicao: DefinicaoEtapa;
  estado: EstadoEtapa;
  resposta: {
    id: string;
    motoristaNome: string | null;
    placa: string | null;
    iniciadaEm: string | null;
    concluidaEm: string | null;
    recebidoEm: string;
    atualizadoEm: string;
    criadoOfflineEm: string | null;
    lat: number | null;
    lng: number | null;
    precisao: number | null;
    marcas: MarcaRespostaEtapa[];
    itens: ItemRespostaPainel[];
  } | null;
  acoes: AcaoEtapaPainel[];
  tarifas: ComparacaoTarifa[];
};

/** GET /admin/viagens/:id/etapas — a seção "Documentos" da ficha. */
export type DocumentosDaViagemPainel = {
  viagemId: string;
  /** A conta tem o módulo (sem ele a seção nem aparece). */
  modulo: boolean;
  etapas: EtapaDaViagemPainel[];
  documentosFaltando: number;
};

// ─── Modelos prontos (OFERECIDOS, nunca criados sozinhos) ───────────────────

type ItemPronto = ItemEtapaInput;
const foto = (chave: string, rotulo: string, extra: Partial<ItemPronto> = {}): ItemPronto => ({
  chave,
  rotulo,
  tipo: "FOTO",
  obrigatorio: true,
  seFaltar: "AVISAR",
  escritorioPodeAnexar: false,
  fotos: { min: 1, max: 3 },
  ...extra,
});
const fotoOuPdf = (chave: string, rotulo: string, extra: Partial<ItemPronto> = {}): ItemPronto => ({
  chave,
  rotulo,
  tipo: "FOTO_OU_PDF",
  obrigatorio: true,
  seFaltar: "AVISAR",
  escritorioPodeAnexar: true,
  ajuda: "Chegou em PDF? Anexe o PDF ou uma foto da tela.",
  fotos: { min: 1, max: 5 },
  ...extra,
});
const simNao = (
  chave: string,
  rotulo: string,
  aoSim: { foto: ModoExtraSimNao; comentario: ModoExtraSimNao },
  aoNao: { foto: ModoExtraSimNao; comentario: ModoExtraSimNao },
  extra: Partial<ItemPronto> = {},
): ItemPronto => ({
  chave,
  rotulo,
  tipo: "SIM_NAO",
  obrigatorio: true,
  seFaltar: "AVISAR",
  escritorioPodeAnexar: false,
  fotos: { min: 0, max: 5 },
  simNao: { aoSim, aoNao },
  ...extra,
});
const NADA = { foto: "NAO", comentario: "NAO" } as const;

/**
 * Os três formulários do primeiro cliente de estrada, como PONTO DE PARTIDA.
 * O painel oferece "Começar pelos modelos prontos"; a empresa edita antes de
 * publicar. Nunca semeados por migration nem por ligar o módulo (os dados do
 * cliente são do cliente). CT-e, MDF-e, ordem e comprovante de encerramento são
 * FOTO OU PDF: chegam em PDF pelo WhatsApp do escritório.
 */
export const MODELOS_ETAPA_PRONTOS: readonly {
  nome: string;
  momento: MomentoEtapa;
  janelaDias: number;
  descricao: string;
  definicao: DefinicaoEtapaInput;
}[] = [
  {
    nome: "Carregamento",
    momento: "INICIO",
    janelaDias: ETAPA_JANELA_DIAS_PADRAO,
    descricao: "Ordem de carregamento, tarifa por tonelada, pesagem, CT-e, MDF-e e o km de saída.",
    definicao: {
      v: 1,
      areas: [
        {
          titulo: "Ordem de carregamento",
          itens: [
            fotoOuPdf("ordem", "Foto ou PDF da ordem de carregamento", { escritorioPodeAnexar: false }),
            {
              chave: "tarifa_tonelada",
              rotulo: "Valor da tarifa por tonelada",
              tipo: "VALOR",
              obrigatorio: true,
              seFaltar: "AVISAR",
              escritorioPodeAnexar: false,
              valor: { comparaTabelaPorTonelada: true },
            },
            simNao("pesagem", "Teve pesagem?", { foto: "EXIGE", comentario: "NAO" }, NADA, {
              ajuda: "Se teve, tire a foto do ticket da pesagem.",
            }),
          ],
        },
        {
          titulo: "CT-e e MDF-e",
          itens: [fotoOuPdf("cte", "CT-e"), fotoOuPdf("mdfe", "MDF-e")],
        },
        {
          titulo: "Km de saída",
          itens: [foto("tacografo_saida", "Foto do km no tacógrafo", { fotos: { min: 1, max: 2 } })],
        },
      ],
    },
  },
  {
    nome: "Descarga",
    momento: "FIM",
    janelaDias: ETAPA_JANELA_DIAS_PADRAO,
    descricao: "Tacógrafo na chegada, encerramento do MDF-e, pesagem, canhoto assinado e o tacógrafo no fim.",
    definicao: {
      v: 1,
      areas: [
        {
          titulo: "Chegada no destino",
          itens: [
            foto("tacografo_chegada", "Foto do km no tacógrafo na chegada", { fotos: { min: 1, max: 2 } }),
            simNao("encerramento_solicitado", "Pediu o encerramento do MDF-e?", NADA, { foto: "NAO", comentario: "PEDE" }),
          ],
        },
        {
          titulo: "Pesagem",
          itens: [
            simNao("pesagem", "Teve pesagem?", { foto: "PEDE", comentario: "PEDE" }, { foto: "NAO", comentario: "PEDE" }),
            simNao(
              "canhoto",
              "Comprovante de descarga (canhoto da NF assinado)",
              { foto: "EXIGE", comentario: "NAO" },
              { foto: "NAO", comentario: "EXIGE" },
            ),
          ],
        },
        {
          titulo: "MDF-e encerrado",
          itens: [
            fotoOuPdf("comprovante_encerramento_mdfe", "Comprovante de encerramento do MDF-e", {
              seFaltar: "NAO_SEGUIR",
              ajuda: "Peça no escritório. Chegou em PDF? Anexe o PDF ou uma foto da tela.",
            }),
          ],
        },
        {
          titulo: "Descarga finalizada",
          itens: [foto("tacografo_fim", "Foto do tacógrafo no fim da descarga", { fotos: { min: 1, max: 2 } })],
        },
      ],
    },
  },
  {
    nome: "Acerto do frete",
    momento: "AVULSA",
    janelaDias: ETAPA_JANELA_DIAS_PADRAO,
    descricao: "No escritório de quem contratou o frete: transportadora, responsável, documento e assinatura.",
    definicao: {
      v: 1,
      areas: [
        {
          titulo: "Transportadora",
          itens: [
            {
              chave: "transportadora",
              rotulo: "Nome da transportadora (cidade)",
              ajuda: "Escreva o nome e a cidade, e tire uma foto da fachada.",
              tipo: "TEXTO_COM_FOTO",
              obrigatorio: true,
              seFaltar: "AVISAR",
              escritorioPodeAnexar: false,
              fotos: { min: 1, max: 2 },
            },
            {
              chave: "responsavel",
              rotulo: "Pessoa responsável",
              ajuda: "Nome e uma foto de quem atendeu.",
              tipo: "TEXTO_COM_FOTO",
              obrigatorio: true,
              seFaltar: "AVISAR",
              escritorioPodeAnexar: false,
              fotos: { min: 1, max: 2 },
            },
          ],
        },
        {
          titulo: "Documento",
          itens: [foto("documento", "Fotos do documento", { fotos: { min: 1, max: 10 }, ajuda: "Ex.: o contrato, via do motorista." })],
        },
        {
          titulo: "Assinatura",
          itens: [
            {
              chave: "assinatura",
              rotulo: "Assinatura do responsável",
              tipo: "ASSINATURA",
              obrigatorio: true,
              seFaltar: "AVISAR",
              escritorioPodeAnexar: false,
              assinatura: { pedeNome: true },
            },
          ],
        },
      ],
    },
  },
];
