/**
 * GASTO DE VIAGEM (módulo `despesas`) — TODA a conversa do app com a API mora
 * aqui, junto com os tipos do contrato.
 *
 * ⚠️ Os tipos abaixo ESPELHAM o contrato que a API está escrevendo em paralelo
 * (docs/despesas-viagem/09-modelo-dinamico.md + o contrato publicado pelo
 * outro branch). Trocar por @ronan/shared-types quando o pacote tiver os
 * schemas (`despesa.ts`, `despesa-campos.ts`). Até lá, quem lê o que vem do
 * servidor são os leitores TOLERANTES daqui: nunca lançam, campo ausente vale
 * o padrão, forma desconhecida vira "nada". O app nunca crasha por cache velho
 * ou por servidor antigo.
 *
 * Nada aqui toca em tela nem em fila: a fila (lib/sync.ts) chama as funções de
 * envio, as telas chamam os hooks de lib/gastos.ts.
 */
import { api } from "./api";

// ---------------------------------------------------------------------------
// Capacidades (trocar pelo catálogo de shared-types quando ele tiver as chaves)
// ---------------------------------------------------------------------------

/** Card "Gasto de viagem", lista, formulário, gastos na viagem, sem viagem. */
export const CAP_DESPESA_LANCAR = "app.despesa.lancar";
/** Card "Pra receber de volta", "Meus reembolsos", item no Perfil. */
export const CAP_DESPESA_ACOMPANHAR = "app.despesa.acompanhar";

// ---------------------------------------------------------------------------
// Catálogo de tipos (vem em /m/catalogos → `tiposDespesa`)
// ---------------------------------------------------------------------------

export type SistemaTipoDespesa = "PEDAGIO" | "ABASTECIMENTO";

/** Campos que o app sabe desenhar. Ordem do catálogo do produto. */
export const CAMPOS_DESPESA = [
  "foto",
  "litros",
  "odometro",
  "estabelecimento",
  "placa",
  "observacao",
] as const;
export type CampoDespesa = (typeof CAMPOS_DESPESA)[number];

export type ModoCampo = "OCULTO" | "PEDE" | "EXIGE";

/** Padrão do catálogo quando o campo não veio (ou veio com lixo). */
const PADRAO_CAMPO: Record<CampoDespesa, ModoCampo> = {
  foto: "PEDE",
  litros: "OCULTO",
  odometro: "OCULTO",
  estabelecimento: "PEDE",
  placa: "PEDE",
  observacao: "PEDE",
};

export type TipoDespesaApp = {
  id: string;
  slug: string;
  nome: string;
  icone: string | null;
  ordem: number;
  /** Preenchido = tipo de sistema: o app abre a tela própria (pedágio/abastecimento). */
  sistema: SistemaTipoDespesa | null;
  /** false = "Por sua conta" (o tipo não devolve). */
  reembolsa: boolean;
  /** "Devolve no máximo R$ X por gasto" — só texto cinza no formulário. */
  tetoValor: number | null;
  /** "É manutenção": placa vira obrigatória e aparece a frase do histórico. */
  manutencao: boolean;
  campos: Record<CampoDespesa, ModoCampo>;
  /** A config crua, pra mandar de volta como `camposUsados`. */
  camposBrutos: unknown;
  camposVersao: number;
  /** Pergunta e exemplo do "o que foi feito" (rótulo vem do painel). */
  observacaoPergunta: string | null;
  observacaoExemplo: string | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * `campos` no formato `{ v: 1, campos: { chave: modo } }`. Total: nunca lança.
 * Forma desconhecida → padrões; campo ausente → padrão; modo inválido → padrão;
 * campo que este app não conhece → ignorado (o servidor carimba, não recusa).
 */
export function lerConfigCampos(json: unknown): Record<CampoDespesa, ModoCampo> {
  const out = { ...PADRAO_CAMPO };
  if (!json || typeof json !== "object") return out;
  const j = json as { v?: unknown; campos?: unknown };
  if (j.v !== undefined && j.v !== 1) return out;
  const campos = (j.campos ?? j) as Record<string, unknown>;
  if (!campos || typeof campos !== "object") return out;
  for (const chave of CAMPOS_DESPESA) {
    const bruto = campos[chave];
    // Aceita o modo direto ("EXIGE") ou um objeto ({ modo: "EXIGE", ... }).
    const modo =
      typeof bruto === "string"
        ? bruto
        : bruto && typeof bruto === "object"
          ? (bruto as { modo?: unknown }).modo
          : undefined;
    // Sinônimos da tela do painel ("Não aparece / Opcional / Obrigatório").
    const norm =
      modo === "OPCIONAL" ? "PEDE" : modo === "OBRIGATORIO" ? "EXIGE" : modo;
    if (norm === "OCULTO" || norm === "PEDE" || norm === "EXIGE") out[chave] = norm;
  }
  return out;
}

function lerTextoDoCampo(json: unknown, campo: string, chave: string): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const campos = (j.campos ?? {}) as Record<string, unknown>;
  const c = campos[campo];
  if (c && typeof c === "object") {
    const t = texto((c as Record<string, unknown>)[chave]);
    if (t) return t;
  }
  const textos = (j.textos ?? {}) as Record<string, unknown>;
  const t2 = textos[campo];
  if (t2 && typeof t2 === "object") return texto((t2 as Record<string, unknown>)[chave]);
  return null;
}

/** Um tipo do catálogo, ou null se nem id/nome vieram. */
function lerTipo(raw: unknown): TipoDespesaApp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = texto(r.id);
  const nome = texto(r.nome);
  if (!id || !nome) return null;
  const sistema = r.sistema === "PEDAGIO" || r.sistema === "ABASTECIMENTO" ? r.sistema : null;
  const campos = lerConfigCampos(r.campos);
  const manutencao = r.manutencao === true || r.tambemManutencao === true || r.ehManutencao === true;
  // "É manutenção" trava a placa em obrigatória (10-telas §9.2).
  if (manutencao) campos.placa = "EXIGE";
  const slug = texto(r.slug) ?? id;
  // "Outro" é a válvula: descrição sempre obrigatória (10-telas §9.2).
  if (slug === "outro" || slug === "outros") campos.observacao = "EXIGE";
  return {
    id,
    slug,
    nome,
    icone: texto(r.icone),
    ordem: num(r.ordem) ?? 0,
    sistema,
    reembolsa: r.reembolsa !== false,
    tetoValor: num(r.tetoValor ?? r.devolveAte ?? r.valorMaximo ?? r.teto),
    manutencao,
    campos,
    camposBrutos: r.campos ?? null,
    camposVersao: num(r.camposVersao) ?? 1,
    observacaoPergunta:
      texto(r.observacaoPergunta) ?? lerTextoDoCampo(r.campos, "observacao", "pergunta"),
    observacaoExemplo:
      texto(r.observacaoExemplo) ?? lerTextoDoCampo(r.campos, "observacao", "exemplo"),
  };
}

export function ehTipoOutro(t: Pick<TipoDespesaApp, "slug">): boolean {
  return t.slug === "outro" || t.slug === "outros";
}

/**
 * Compat on-read do catálogo: cache antigo sem `tiposDespesa` (ou com lixo) →
 * lista vazia. Nunca `undefined.map`. Ordena pela ordem do painel e põe o
 * "Outro" por último, sempre.
 */
export function lerTiposDespesa(catalogo: unknown): TipoDespesaApp[] {
  if (!catalogo || typeof catalogo !== "object") return [];
  const bruto = (catalogo as { tiposDespesa?: unknown }).tiposDespesa;
  if (!Array.isArray(bruto)) return [];
  const tipos: TipoDespesaApp[] = [];
  for (const r of bruto) {
    if (r && typeof r === "object" && (r as { ativo?: unknown }).ativo === false) continue;
    const t = lerTipo(r);
    if (t) tipos.push(t);
  }
  return tipos.sort((a, b) => {
    const oa = ehTipoOutro(a) ? 1 : 0;
    const ob = ehTipoOutro(b) ? 1 : 0;
    if (oa !== ob) return oa - ob;
    return a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR");
  });
}

// ---------------------------------------------------------------------------
// Lançar (POST /m/despesas) e foto (POST /m/uploads/despesa)
// ---------------------------------------------------------------------------

/** O que a tela junta; o formato do corpo é decidido em `montarCorpoDespesa`. */
export type NovaDespesa = {
  clientId: string;
  tipoId: string;
  /** Instante do gasto (ISO). */
  data: string;
  valor: number;
  veiculoId?: string | null;
  viagemId?: string | null;
  viagemClientId?: string | null;
  /** Ele respondeu "Não foi em viagem" (≠ não respondeu). */
  naoFoiEmViagem?: boolean;
  /** CONTEXTO = abriu de dentro da viagem; MOTORISTA = ele escolheu. */
  vinculoPor?: "CONTEXTO" | "MOTORISTA" | null;
  descricao?: string | null;
  estabelecimento?: string | null;
  litros?: number | null;
  odometro?: number | null;
  justificativaSemFoto?: string | null;
  camposVersao: number;
  camposUsados: unknown;
  /** "É outro — salvar este" no aviso de possível repetido. */
  confirmouNaoRepetido?: boolean;
  criadoOfflineEm?: string;
};

/**
 * O corpo do POST. Campo vazio não vai (o Zod do servidor descarta chave que
 * não conhece, mas `null` em campo opcional dá 400 em muito schema).
 */
export function montarCorpoDespesa(d: NovaDespesa): Record<string, unknown> {
  const c: Record<string, unknown> = {
    clientId: d.clientId,
    tipoId: d.tipoId,
    data: d.data,
    valor: d.valor,
    camposVersao: d.camposVersao,
    camposUsados: d.camposUsados ?? undefined,
  };
  if (d.veiculoId) c.veiculoId = d.veiculoId;
  if (d.viagemId) c.viagemId = d.viagemId;
  if (d.viagemClientId) c.viagemClientId = d.viagemClientId;
  if (d.naoFoiEmViagem) c.naoFoiEmViagem = true;
  if (d.vinculoPor && (d.viagemId || d.viagemClientId)) c.vinculoPor = d.vinculoPor;
  if (d.descricao?.trim()) c.descricao = d.descricao.trim();
  if (d.estabelecimento?.trim()) c.estabelecimento = d.estabelecimento.trim();
  if (d.litros != null) c.litros = d.litros;
  if (d.odometro != null) c.odometro = d.odometro;
  if (d.justificativaSemFoto?.trim()) c.justificativaSemFoto = d.justificativaSemFoto.trim();
  if (d.confirmouNaoRepetido) c.confirmouNaoRepetido = true;
  if (d.criadoOfflineEm) c.criadoOfflineEm = d.criadoOfflineEm;
  return c;
}

/** Sobe uma foto do comprovante. Devolve a chave pra ir no `fotoKeys`. */
export async function enviarFotoDespesa(
  foto: { uri: string; mime?: string },
  clientId: string,
  indice: number,
): Promise<string> {
  const fd = new FormData();
  fd.append("foto", {
    uri: foto.uri,
    type: foto.mime ?? "image/jpeg",
    name: `despesa-${clientId}-${indice + 1}.${foto.mime?.includes("png") ? "png" : "jpg"}`,
  } as unknown as Blob);
  const r = await api.postForm<{ storageKey?: string; fotoKey?: string; key?: string }>(
    "/m/uploads/despesa",
    fd,
    { outbox: true },
  );
  const chave = r.storageKey ?? r.fotoKey ?? r.key;
  if (!chave) throw new Error("O servidor não devolveu a chave da foto.");
  return chave;
}

/** Cria o gasto. Idempotente por `clientId` no servidor. */
export async function enviarDespesa(corpo: Record<string, unknown>): Promise<{ id?: string }> {
  return api.post<{ id?: string }>("/m/despesas", corpo, { outbox: true });
}

/** Liga/solta um gasto já enviado (PATCH /m/despesas/:id/viagem). Idempotente. */
export async function enviarVinculoDespesa(
  despesaId: string,
  v: {
    viagemId?: string | null;
    viagemClientId?: string | null;
    naoFoiEmViagem?: boolean;
    desvincular?: boolean;
  },
): Promise<void> {
  const corpo: Record<string, unknown> = {};
  if (v.desvincular) corpo.desvincular = true;
  else if (v.naoFoiEmViagem) corpo.naoFoiEmViagem = true;
  else {
    if (v.viagemId) corpo.viagemId = v.viagemId;
    if (v.viagemClientId) corpo.viagemClientId = v.viagemClientId;
  }
  await api.patch(`/m/despesas/${despesaId}/viagem`, corpo);
}

// ---------------------------------------------------------------------------
// Acompanhar (GET /m/despesas) e mexer no que já foi
// ---------------------------------------------------------------------------

/** Status do servidor. Qualquer outro valor é lido como PENDENTE. */
export type StatusDespesaServidor = "PENDENTE" | "APROVADA" | "RECUSADA";

export type MensagemDespesa = {
  autor: "ESCRITORIO" | "MOTORISTA";
  texto: string;
  criadoEm: string;
};

export type DespesaApp = {
  id: string;
  clientId: string | null;
  tipoId: string | null;
  tipoNome: string;
  tipoIcone: string | null;
  /** Instante do gasto (ISO). */
  data: string;
  /** O que ele digitou. */
  valorInformado: number;
  /** O que vale (aprovado). */
  valor: number;
  status: StatusDespesaServidor;
  reembolsa: boolean;
  motivoDecisao: string | null;
  viagem: { id: string; clientId: string | null; rotulo: string | null; data: string | null } | null;
  viagemClientId: string | null;
  naoFoiEmViagem: boolean;
  /** No acerto: data de referência (fim do período / fechamento). */
  acertoEm: string | null;
  pagoEm: string | null;
  /** Registrado (CLT): o escritório paga fora do acerto. */
  pagoForaDoAcerto: boolean;
  fotos: { id: string }[];
  fotoPendente: boolean;
  justificativaSemFoto: string | null;
  descricao: string | null;
  estabelecimento: string | null;
  litros: number | null;
  odometro: number | null;
  veiculo: { id: string; placa: string } | null;
  mensagens: MensagemDespesa[];
};

function lerViagemDaDespesa(raw: unknown): DespesaApp["viagem"] {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = texto(r.id);
  if (!id) return null;
  const carga = (r.localCarga as { nome?: unknown } | null)?.nome;
  const desc = (r.localDescarga as { nome?: unknown } | null)?.nome;
  const rotulo =
    texto(r.rotulo) ??
    (texto(carga) ? `${carga as string}${texto(desc) ? ` → ${desc as string}` : ""}` : null) ??
    texto((r.cliente as { nome?: unknown } | null)?.nome);
  return { id, clientId: texto(r.clientId), rotulo, data: texto(r.data) };
}

function lerMensagens(raw: unknown): MensagemDespesa[] {
  if (!Array.isArray(raw)) return [];
  const out: MensagemDespesa[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const t = texto(r.texto);
    if (!t) continue;
    out.push({
      autor: r.autor === "MOTORISTA" ? "MOTORISTA" : "ESCRITORIO",
      texto: t,
      criadoEm: texto(r.criadoEm) ?? "",
    });
  }
  return out;
}

/** Um gasto da lista, tolerante. null = linha sem id (ignorada). */
export function lerDespesa(raw: unknown): DespesaApp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = texto(r.id);
  if (!id) return null;
  const tipo = (r.tipo ?? null) as Record<string, unknown> | null;
  const valorInformado = num(r.valorInformado) ?? num(r.valor) ?? 0;
  const status: StatusDespesaServidor =
    r.status === "APROVADA" || r.status === "RECUSADA" ? r.status : "PENDENTE";
  const acerto = (r.acerto ?? null) as Record<string, unknown> | null;
  const veiculo = (r.veiculo ?? null) as Record<string, unknown> | null;
  const fotos = Array.isArray(r.fotos)
    ? (r.fotos as unknown[])
        .map((f) => (f && typeof f === "object" ? texto((f as { id?: unknown }).id) : null))
        .filter((x): x is string => !!x)
        .map((fid) => ({ id: fid }))
    : [];
  return {
    id,
    clientId: texto(r.clientId),
    tipoId: texto(r.tipoId) ?? texto(tipo?.id),
    tipoNome: texto(r.tipoNome) ?? texto(tipo?.nome) ?? "Gasto",
    tipoIcone: texto(r.tipoIcone) ?? texto(tipo?.icone),
    data: texto(r.data) ?? new Date().toISOString(),
    valorInformado,
    valor: num(r.valorAprovado) ?? num(r.valor) ?? valorInformado,
    status,
    reembolsa: r.reembolsa !== false && tipo?.reembolsa !== false,
    motivoDecisao: texto(r.motivoDecisao) ?? texto(r.motivo),
    viagem: lerViagemDaDespesa(r.viagem),
    viagemClientId: texto(r.viagemClientId),
    naoFoiEmViagem: r.naoFoiEmViagem === true || r.vinculo === "FORA_DE_VIAGEM",
    acertoEm: texto(r.acertoEm) ?? texto(acerto?.periodoFim) ?? texto(acerto?.fechadoEm),
    pagoEm: texto(r.pagoEm) ?? texto(acerto?.pagoEm),
    pagoForaDoAcerto: r.pagoForaDoAcerto === true,
    fotos,
    fotoPendente: r.fotoPendente === true,
    justificativaSemFoto: texto(r.justificativaSemFoto),
    descricao: texto(r.descricao),
    estabelecimento: texto(r.estabelecimento),
    litros: num(r.litros),
    odometro: num(r.odometro),
    veiculo:
      veiculo && texto(veiculo.id) && texto(veiculo.placa)
        ? { id: veiculo.id as string, placa: veiculo.placa as string }
        : null,
    mensagens: lerMensagens(r.mensagens),
  };
}

/** Aceita `{ itens: [...] }` ou a lista crua. */
export function lerListaDespesas(raw: unknown): DespesaApp[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { itens?: unknown }).itens)
      ? ((raw as { itens: unknown[] }).itens)
      : [];
  const out: DespesaApp[] = [];
  for (const r of arr) {
    const d = lerDespesa(r);
    if (d) out.push(d);
  }
  return out;
}

/** Os últimos gastos dele (60 dias bastam pra "pra receber" e "sem viagem"). */
export async function buscarMinhasDespesas(): Promise<DespesaApp[]> {
  return lerListaDespesas(await api.get<unknown>("/m/despesas?limit=100"));
}

/** Corrigir (só enquanto está com o escritório). */
export async function corrigirDespesa(id: string, corpo: Record<string, unknown>): Promise<void> {
  await api.patch(`/m/despesas/${id}`, corpo);
}

/** Apagar (só enquanto está com o escritório). */
export async function apagarDespesa(id: string): Promise<void> {
  await api.delete(`/m/despesas/${id}`);
}

/** Resposta dele à conversa do escritório. */
export async function responderDespesa(id: string, mensagem: string): Promise<void> {
  await api.post(`/m/despesas/${id}/mensagens`, { texto: mensagem });
}

/** Caminho da foto já enviada (servida pela API, nunca do MinIO direto). */
export function caminhoFotoDespesa(despesaId: string, fotoId: string): string {
  return `/m/despesas/${despesaId}/fotos/${fotoId}`;
}
