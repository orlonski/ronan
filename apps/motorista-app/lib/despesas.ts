/**
 * GASTO DE VIAGEM (módulo `despesas`) — TODA a conversa do app com a API mora
 * aqui, junto com os tipos do contrato.
 *
 * ⚠️ Os tipos e leitores abaixo ESPELHAM o contrato /m/* da Etapa 1
 * (`packages/shared-types/src/despesa.ts` e `despesa-vinculo.ts`, que chegam
 * pelo branch da API). Trocar por @ronan/shared-types quando o pacote tiver os
 * schemas: `CamposDoTipo`, `lerConfigCampos`, `resolverCamposDoTipo`,
 * `CriarDespesaInput`, `VincularDespesasInput`, `DespesaDoMotorista`,
 * `TipoDespesaCatalogo` e `SituacaoDespesaMotorista` têm o mesmo nome lá.
 *
 * Quem lê o que vem do servidor são leitores TOLERANTES: nunca lançam, campo
 * ausente vale o padrão, forma desconhecida vira "nada". Cache velho ou
 * servidor antigo nunca derrubam a tela do posto.
 *
 * Nada aqui desenha tela nem mexe na fila: a fila (lib/sync.ts) chama as
 * funções de envio; as telas usam os hooks de lib/gastos.ts.
 */
import { api } from "./api";

// ---------------------------------------------------------------------------
// Capacidades (shared-types/capacidades-app.ts, grupo "Gastos", módulo "despesas")
// ---------------------------------------------------------------------------

/** Card "Gasto de viagem", lista, lançar/corrigir/apagar/ligar à viagem. */
export const CAP_DESPESA_LANCAR = "app.despesa.lancar";
/** Card "Pra receber de volta", "Meus gastos". */
export const CAP_DESPESA_ACOMPANHAR = "app.despesa.acompanhar";

// ---------------------------------------------------------------------------
// Configuração de campos do tipo (cópia do contrato — trocar por shared-types)
// ---------------------------------------------------------------------------

export const MODOS_FOTO = ["NAO_PEDE", "PEDE", "EXIGE"] as const;
export type ModoFoto = (typeof MODOS_FOTO)[number];

export const MODOS_CAMPO = ["OCULTO", "OPCIONAL", "OBRIGATORIO"] as const;
export type ModoCampo = (typeof MODOS_CAMPO)[number];

/** A ordem desta lista é a ordem no celular (não configurável, de propósito). */
export const CAMPOS_DESPESA = ["descricao", "placa", "litros", "odometro", "onde"] as const;
export type CampoDespesa = (typeof CAMPOS_DESPESA)[number];

export const CAMPO_DESPESA_PERGUNTA_PADRAO: Record<CampoDespesa, string> = {
  descricao: "O que foi feito?",
  placa: "Caminhão",
  litros: "Litros",
  odometro: "Odômetro",
  onde: "Onde foi?",
};

export type ConfigCampo = { modo: ModoCampo; pergunta?: string; exemplo?: string };

export type CamposDoTipo = {
  v: 1;
  foto: ModoFoto;
  campos: Record<CampoDespesa, ConfigCampo>;
};

export const CAMPOS_PADRAO: CamposDoTipo = {
  v: 1,
  foto: "PEDE",
  campos: {
    descricao: { modo: "OCULTO" },
    placa: { modo: "OCULTO" },
    litros: { modo: "OCULTO" },
    odometro: { modo: "OCULTO" },
    onde: { modo: "OCULTO" },
  },
};

function textoCurto(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

/**
 * Leitor TOTAL da configuração: nunca lança, nunca devolve campo faltando.
 * `v` ≠ 1 ou lixo → padrões; campo ausente ou modo inválido → padrão do campo;
 * chave desconhecida → ignorada (app velho, campo novo).
 */
export function lerConfigCampos(json: unknown): CamposDoTipo {
  const base: CamposDoTipo = {
    v: 1,
    foto: CAMPOS_PADRAO.foto,
    campos: { ...CAMPOS_PADRAO.campos },
  };
  if (!json || typeof json !== "object") return base;
  const j = json as Record<string, unknown>;
  if (j.v !== 1) return base;
  if (typeof j.foto === "string" && (MODOS_FOTO as readonly string[]).includes(j.foto)) {
    base.foto = j.foto as ModoFoto;
  }
  const campos =
    j.campos && typeof j.campos === "object" ? (j.campos as Record<string, unknown>) : {};
  for (const c of CAMPOS_DESPESA) {
    const bruto = campos[c];
    if (!bruto || typeof bruto !== "object") continue;
    const b = bruto as Record<string, unknown>;
    const modo =
      typeof b.modo === "string" && (MODOS_CAMPO as readonly string[]).includes(b.modo)
        ? (b.modo as ModoCampo)
        : CAMPOS_PADRAO.campos[c].modo;
    const cfg: ConfigCampo = { modo };
    const pergunta = textoCurto(b.pergunta, 80);
    const exemplo = textoCurto(b.exemplo, 120);
    if (pergunta) cfg.pergunta = pergunta;
    if (exemplo) cfg.exemplo = exemplo;
    base.campos[c] = cfg;
  }
  return base;
}

/** Slug do tipo "Outro": a válvula. Descrição sempre obrigatória. */
export const SLUG_TIPO_OUTRO = "outro";

/**
 * O que o celular pede pra ESTE tipo: a configuração + as regras que não são
 * opinião de quem configura (manutenção ⇒ placa obrigatória; Outro ⇒
 * descrição obrigatória). A mesma função que a API usa pra carimbar.
 */
export function resolverCamposDoTipo(tipo: {
  slug?: string | null;
  manutencao?: boolean | null;
  campos: unknown;
}): CamposDoTipo {
  const r = lerConfigCampos(tipo.campos);
  if (tipo.manutencao) r.campos.placa = { ...r.campos.placa, modo: "OBRIGATORIO" };
  if (tipo.slug === SLUG_TIPO_OUTRO) {
    r.campos.descricao = {
      ...r.campos.descricao,
      modo: "OBRIGATORIO",
      pergunta: r.campos.descricao.pergunta ?? "O que você pagou?",
    };
  }
  return r;
}

// ---------------------------------------------------------------------------
// Catálogo de tipos (/m/catalogos → `tiposDespesa`)
// ---------------------------------------------------------------------------

/** O tipo já lido e resolvido — é o que as telas usam. */
export type TipoDespesaApp = {
  id: string;
  slug: string;
  nome: string;
  icone: string | null;
  ordem: number;
  /** false = "Por sua conta" (o celular avisa antes de lançar). */
  reembolsa: boolean;
  /** "Devolvido até R$ X" — linha cinza, nunca validação. */
  tetoValor: number | null;
  manutencao: boolean;
  cfg: CamposDoTipo;
  camposVersao: number;
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

function lerTipo(raw: unknown): TipoDespesaApp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = texto(r.id);
  const nome = texto(r.nome);
  if (!id || !nome) return null;
  const slug = texto(r.slug) ?? id;
  const manutencao = r.manutencao === true;
  return {
    id,
    slug,
    nome,
    icone: texto(r.icone),
    ordem: num(r.ordem) ?? 0,
    reembolsa: r.devolve !== false,
    tetoValor: num(r.devolveNoMaximo),
    manutencao,
    cfg: resolverCamposDoTipo({ slug, manutencao, campos: r.campos }),
    camposVersao: num(r.camposVersao) ?? 1,
  };
}

/** Um tipo a partir do que ficou guardado no item da fila (tipo que saiu do catálogo). */
export function tipoDeReserva(input: {
  id: string;
  nome: string;
  icone?: string | null;
  reembolsa: boolean;
  campos?: unknown;
  camposVersao?: number | null;
}): TipoDespesaApp {
  return {
    id: input.id,
    slug: input.id,
    nome: input.nome,
    icone: input.icone ?? null,
    ordem: 0,
    reembolsa: input.reembolsa,
    tetoValor: null,
    manutencao: false,
    cfg: lerConfigCampos(input.campos),
    camposVersao: input.camposVersao ?? 1,
  };
}

export function ehTipoOutro(t: Pick<TipoDespesaApp, "slug">): boolean {
  return t.slug === SLUG_TIPO_OUTRO;
}

/**
 * Compat on-read: cache antigo sem `tiposDespesa` (ou lixo) → lista vazia,
 * nunca `undefined.map`. Mantém a ordem do painel e garante o "Outro" no fim.
 */
export function lerTiposDespesa(catalogo: unknown): TipoDespesaApp[] {
  if (!catalogo || typeof catalogo !== "object") return [];
  const bruto = (catalogo as { tiposDespesa?: unknown }).tiposDespesa;
  if (!Array.isArray(bruto)) return [];
  const tipos: TipoDespesaApp[] = [];
  for (const r of bruto) {
    const t = lerTipo(r);
    if (t) tipos.push(t);
  }
  return tipos
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const oa = ehTipoOutro(a.t) ? 1 : 0;
      const ob = ehTipoOutro(b.t) ? 1 : 0;
      if (oa !== ob) return oa - ob;
      return a.t.ordem - b.t.ordem || a.i - b.i;
    })
    .map(({ t }) => t);
}

/** O catálogo deste celular já conhece os tipos (mesmo que vazios)? */
export function catalogoTemTiposDespesa(catalogo: unknown): boolean {
  return (
    !!catalogo &&
    typeof catalogo === "object" &&
    Array.isArray((catalogo as { tiposDespesa?: unknown }).tiposDespesa)
  );
}

// ---------------------------------------------------------------------------
// Lançar: POST /m/uploads/despesa e POST /m/despesas (CriarDespesaInput)
// ---------------------------------------------------------------------------

/** O que a tela junta; o corpo do POST é montado em `montarCorpoDespesa`. */
export type NovaDespesa = {
  clientId: string;
  tipoDespesaId: string;
  /** Instante do gasto (ISO). O dia civil é o de São Paulo. */
  data: string;
  valor: number;
  veiculoId?: string | null;
  viagemId?: string | null;
  /** Viagem que ainda está no celular: o servidor amarra quando ela subir. */
  viagemClientId?: string | null;
  /** Ele respondeu "Não foi em viagem" (≠ não respondeu). */
  foraDeViagem?: boolean;
  descricao?: string | null;
  onde?: string | null;
  litros?: number | null;
  odometro?: number | null;
  /** "Não tenho o comprovante" → o que aconteceu. */
  semComprovanteMotivo?: string | null;
  camposVersao: number;
  /** "É outro — salvar este" no aviso de possível repetido. */
  confirmouQueEOutro?: boolean;
  criadoOfflineEm?: string;
};

/**
 * O corpo do POST (sem `fotoKeys`, que a fila junta depois de subir as fotos).
 * Campo vazio não vai.
 */
export function montarCorpoDespesa(d: NovaDespesa): Record<string, unknown> {
  const c: Record<string, unknown> = {
    clientId: d.clientId,
    tipoDespesaId: d.tipoDespesaId,
    data: d.data,
    valor: d.valor,
    camposVersao: d.camposVersao,
  };
  if (d.veiculoId) c.veiculoId = d.veiculoId;
  if (d.viagemId) c.viagemId = d.viagemId;
  else if (d.viagemClientId) c.viagemClientId = d.viagemClientId;
  else if (d.foraDeViagem) c.foraDeViagem = true;
  if (d.descricao?.trim()) c.descricao = d.descricao.trim();
  if (d.onde?.trim()) c.onde = d.onde.trim();
  if (d.litros != null) c.litros = d.litros;
  if (d.odometro != null) c.odometro = d.odometro;
  if (d.semComprovanteMotivo?.trim()) c.semComprovanteMotivo = d.semComprovanteMotivo.trim();
  if (d.confirmouQueEOutro) c.confirmouQueEOutro = true;
  if (d.criadoOfflineEm) c.criadoOfflineEm = d.criadoOfflineEm;
  return c;
}

/** Sobe uma foto do comprovante. Devolve a `storageKey` pra ir em `fotoKeys`. */
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
  const r = await api.postForm<{ storageKey?: string; sha256?: string }>(
    "/m/uploads/despesa",
    fd,
    { outbox: true },
  );
  if (!r?.storageKey) throw new Error("O servidor não devolveu a chave da foto.");
  return r.storageKey;
}

/** Cria o gasto. Idempotente por `clientId` (o mesmo devolve o existente). */
export async function enviarDespesa(corpo: Record<string, unknown>): Promise<unknown> {
  return api.post<unknown>("/m/despesas", corpo, { outbox: true });
}

export type AcaoVinculo = "VIAGEM" | "FORA_DE_VIAGEM" | "DESFAZER";

/**
 * POST /m/despesas/vincular, em lote. `despesas` aceita o id do servidor OU o
 * clientId do celular.
 */
export async function enviarVinculoDespesas(v: {
  despesas: string[];
  acao: AcaoVinculo;
  viagemId?: string | null;
  viagemClientId?: string | null;
}): Promise<void> {
  const corpo: Record<string, unknown> = { despesas: v.despesas, acao: v.acao };
  if (v.acao === "VIAGEM") {
    if (v.viagemId) corpo.viagemId = v.viagemId;
    else if (v.viagemClientId) corpo.viagemClientId = v.viagemClientId;
  }
  await api.post("/m/despesas/vincular", corpo, { outbox: true });
}

// ---------------------------------------------------------------------------
// Acompanhar: GET /m/despesas (DespesaDoMotorista)
// ---------------------------------------------------------------------------

export type StatusDespesa = "COM_ESCRITORIO" | "APROVADA" | "NAO_REEMBOLSADA";

export type SituacaoDespesaMotorista =
  | "COM_ESCRITORIO"
  | "APROVADA"
  | "APROVADA_OUTRO_VALOR"
  | "NO_ACERTO"
  | "PAGO"
  | "NAO_REEMBOLSADA"
  | "POR_SUA_CONTA"
  | "PAGO_FORA_DO_ACERTO";

const SITUACOES: readonly string[] = [
  "COM_ESCRITORIO",
  "APROVADA",
  "APROVADA_OUTRO_VALOR",
  "NO_ACERTO",
  "PAGO",
  "NAO_REEMBOLSADA",
  "POR_SUA_CONTA",
  "PAGO_FORA_DO_ACERTO",
];

export type VinculoDespesa = "SEM_RESPOSTA" | "VIAGEM" | "FORA_DE_VIAGEM";

/** Um gasto como o app usa (decimais já em número). */
export type DespesaApp = {
  id: string;
  clientId: string | null;
  tipoId: string | null;
  tipoSlug: string | null;
  tipoNome: string;
  tipoIcone: string | null;
  /** Instante do gasto (ISO). */
  data: string;
  valorInformado: number;
  valorAprovado: number | null;
  status: StatusDespesa;
  situacao: SituacaoDespesaMotorista;
  motivo: string | null;
  vinculo: VinculoDespesa;
  viagemId: string | null;
  viagemClientId: string | null;
  viagem: { id: string; clientId: string | null; data: string | null; resumo: string | null } | null;
  veiculo: { id: string; placa: string } | null;
  descricao: string | null;
  litros: number | null;
  odometro: number | null;
  onde: string | null;
  semComprovanteMotivo: string | null;
  fotos: { id: string }[];
  acerto: { id: string; periodoFim: string | null; status: string | null; pagoEm: string | null } | null;
  /** Entra no "pra receber de volta"? (o servidor decide) */
  somaPraReceber: boolean;
  /** Ainda dá pra corrigir/apagar pelo app. */
  editavel: boolean;
};

/** Um gasto da lista, tolerante. null = linha sem id (ignorada). */
export function lerDespesa(raw: unknown): DespesaApp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = texto(r.id);
  if (!id) return null;
  const tipo = (r.tipo && typeof r.tipo === "object" ? r.tipo : {}) as Record<string, unknown>;
  const status: StatusDespesa =
    r.status === "APROVADA" || r.status === "NAO_REEMBOLSADA" ? r.status : "COM_ESCRITORIO";
  const situacao: SituacaoDespesaMotorista =
    typeof r.situacao === "string" && SITUACOES.includes(r.situacao)
      ? (r.situacao as SituacaoDespesaMotorista)
      : status;
  const vinculo: VinculoDespesa =
    r.vinculo === "VIAGEM" || r.vinculo === "FORA_DE_VIAGEM" ? r.vinculo : "SEM_RESPOSTA";
  const viagemRaw = (r.viagem && typeof r.viagem === "object" ? r.viagem : null) as Record<
    string,
    unknown
  > | null;
  const veiculo = (r.veiculo && typeof r.veiculo === "object" ? r.veiculo : null) as Record<
    string,
    unknown
  > | null;
  const acerto = (r.acerto && typeof r.acerto === "object" ? r.acerto : null) as Record<
    string,
    unknown
  > | null;
  const fotos = Array.isArray(r.fotos)
    ? (r.fotos as unknown[])
        .map((f) => (f && typeof f === "object" ? texto((f as { id?: unknown }).id) : null))
        .filter((x): x is string => !!x)
        .map((fid) => ({ id: fid }))
    : [];
  const valorInformado = num(r.valorInformado) ?? 0;
  return {
    id,
    clientId: texto(r.clientId),
    tipoId: texto(tipo.id),
    tipoSlug: texto(tipo.slug),
    tipoNome: texto(tipo.nome) ?? "Gasto",
    tipoIcone: texto(tipo.icone),
    data: texto(r.data) ?? new Date().toISOString(),
    valorInformado,
    valorAprovado: num(r.valorAprovado),
    status,
    situacao,
    motivo: texto(r.motivo),
    vinculo,
    viagemId: texto(r.viagemId),
    viagemClientId: texto(r.viagemClientId),
    viagem:
      viagemRaw && texto(viagemRaw.id)
        ? {
            id: viagemRaw.id as string,
            clientId: texto(viagemRaw.clientId),
            data: texto(viagemRaw.data),
            resumo: texto(viagemRaw.resumo),
          }
        : null,
    veiculo:
      veiculo && texto(veiculo.id) && texto(veiculo.placa)
        ? { id: veiculo.id as string, placa: veiculo.placa as string }
        : null,
    descricao: texto(r.descricao),
    litros: num(r.litros),
    odometro: num(r.odometro),
    onde: texto(r.onde),
    semComprovanteMotivo: texto(r.semComprovanteMotivo),
    fotos,
    acerto:
      acerto && texto(acerto.id)
        ? {
            id: acerto.id as string,
            periodoFim: texto(acerto.periodoFim),
            status: texto(acerto.status),
            pagoEm: texto(acerto.pagoEm),
          }
        : null,
    somaPraReceber: r.somaPraReceber === true,
    editavel: r.editavel === true,
  };
}

/** Aceita `{ itens: [...] }` (DespesasDoMotoristaResposta) ou a lista crua. */
export function lerListaDespesas(raw: unknown): DespesaApp[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { itens?: unknown }).itens)
      ? (raw as { itens: unknown[] }).itens
      : [];
  const out: DespesaApp[] = [];
  for (const r of arr) {
    const d = lerDespesa(r);
    if (d) out.push(d);
  }
  return out;
}

/** Os últimos gastos dele (uma página de 100 cobre o "pra receber" e o "sem viagem"). */
export async function buscarMinhasDespesas(): Promise<DespesaApp[]> {
  return lerListaDespesas(await api.get<unknown>("/m/despesas?limit=100"));
}

/** PATCH /m/despesas/:id — só enquanto `editavel`. `fotoKeys` presente substitui a lista. */
export async function corrigirDespesa(id: string, corpo: Record<string, unknown>): Promise<void> {
  await api.patch(`/m/despesas/${id}`, corpo);
}

/** DELETE /m/despesas/:id — idempotente (já apagado = 204). */
export async function apagarDespesa(id: string): Promise<void> {
  await api.delete(`/m/despesas/${id}`);
}

/** Caminho da foto já enviada (servida pela API com Authorization, nunca do MinIO). */
export function caminhoFotoDespesa(despesaId: string, fotoId: string): string {
  return `/m/despesas/${despesaId}/fotos/${fotoId}`;
}
