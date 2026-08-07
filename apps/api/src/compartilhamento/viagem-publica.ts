import { Prisma, StatusViagem } from "@prisma/client";
import { aplicarMinimos, resolverRegraMinimo, type RegraMinimoRow } from "../common/viagem-minimos";

/**
 * A FRONTEIRA entre a viagem interna e o comprovante que o cliente/embarcador
 * abre sem login.
 *
 * Primo do `admin/viagens/comercial.ts`, mas INVERTIDO: aquele é blacklist
 * (omite N campos de um payload conhecido), este é WHITELIST — monta um objeto
 * novo campo a campo. A diferença importa porque o público aqui é de fora da
 * casa: com blacklist, campo novo na Viagem vaza por padrão; com whitelist, ele
 * só aparece se alguém escrever a linha.
 *
 * Duas camadas de defesa: o `select` estreito do Prisma (no service) e este
 * builder. Se você chegou aqui querendo `...viagem`, PARE — é exatamente o que
 * este arquivo existe pra impedir.
 *
 * O QUE FICA DE FORA, e por quê:
 * - `id`/`clientId` — chave interna e idempotência do outbox.
 * - `motorista.cpf`/`motorista.id` — dado pessoal do parceiro autônomo (LGPD).
 *   Só o nome sai, porque é quem o cliente viu na portaria.
 * - `cliente`/`empresa`/`clienteId` — carteira comercial da Schaba. Quem abre o
 *   link já sabe quem é; a lista de quem mais compra não é dele.
 * - `regraMinimo` (faixa de km, mínimo, material específico) — política de
 *   preço interna. Sai só o booleano `ajustadoPorMinimo`.
 * - `matchesFechamento` — faturamento interno.
 * - `pontos[]` (lat/lng/velocidade/precisão) — telemetria bruta do trajeto.
 *   Mandar isso pro cliente é vigiar o motorista, não comprovar a entrega. O
 *   mapa usa a polilinha da ROTA, não o rastro do celular.
 * - GPS do lançamento (`lat`/`lng`, `carga*`, `descarga*`) — mesma razão.
 * - `kmReal`/`kmCalculado`/`kmFonte`/`kmEditadoManual`/`kmRecalculado*`/
 *   `kmReferencia*`/`kmDesvio*`/`justificativaKm`/`kmAceitoEm` — procedência e
 *   controle de qualidade. "O km era X e virou Y" abre uma conversa que não é
 *   do cliente.
 * - `ocrCampos`/`ocrConfidence` — "a IA preencheu isto" é ruído e risco.
 * - `revisadoEm`/`revisadoPor`/`motivoStatus`/`tipoDivergencia` — processo de
 *   conferência. `motivoStatus` costuma ter texto interno ("foto ilegível").
 * - `observacao` — campo livre; pode conter qualquer coisa.
 * - `transportadora`/`transportadoraId` — estrutura de frota.
 * - metadados de sync (`criadoOfflineEm`, `sincronizadoEm`, `appVersaoCriacao`…).
 * - `mensagens`/`eventos`/`eventosViagem` — chat interno e lifecycle.
 * - `fotos[].storageKey` — a chave do MinIO NUNCA sai; a foto é servida por um
 *   endpoint que valida o token.
 * - dos locais: `logradouro`/`numero`/`bairro`/`cep`/`apelidos`/
 *   `nivelConfianca`/`origemCadastro` — endereço completo e qualidade de
 *   cadastro são operação interna. Cidade/UF bastam pro comprovante.
 */

/** Situação em linguagem de cliente. Ver `mapearSituacao`. */
export type SituacaoPublica = {
  rotulo: string;
  tom: "ok" | "neutro" | "atencao";
};

export type ViagemPublica = {
  ticket: string | null;
  data: string | null;
  situacao: SituacaoPublica;
  emitidoEm: string;
  linkExpiraEm: string;

  material: { nome: string } | null;
  motorista: { nome: string };
  veiculo: { placa: string };

  origem: LocalPublico | null;
  destino: LocalPublico | null;
  trechos: { rotulo: string; localNome: string | null; km: string | null }[];

  km: { informado: string; efetivo: string; ajustadoPorMinimo: boolean };
  toneladas: { informada: string; efetiva: string; ajustadoPorMinimo: boolean };

  pedagio: {
    total: string | null;
    itens: { praca: string; valor: string; data: string }[];
  };

  rotaGeometria: string | null;
  fotos: { id: string; rotacao: number }[];
};

export type LocalPublico = {
  nome: string;
  cidade: string | null;
  uf: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * `select` do Prisma pro comprovante. Estreito de propósito — é a primeira das
 * duas camadas. Campos que existem só pra CALCULAR (empresaId, materialId) são
 * lidos aqui e descartados no builder; nunca são emitidos.
 */
export const SELECT_VIAGEM_PUBLICA = {
  status: true,
  ticket: true,
  data: true,
  km: true,
  toneladas: true,
  valorPedagioTotal: true,
  rotaGeometria: true,
  material: { select: { id: true, nome: true } },
  // empresaId alimenta a regra de mínimo; NÃO vai pro payload.
  cliente: { select: { empresaId: true } },
  // Ids dos locais servem só pra achar a rota do par no cache; NÃO vão pro payload.
  localCargaId: true,
  localDescargaId: true,
  motorista: { select: { nome: true } },
  veiculo: { select: { placa: true } },
  localCarga: { select: { nome: true, cidade: true, uf: true, lat: true, lng: true } },
  localDescarga: { select: { nome: true, cidade: true, uf: true, lat: true, lng: true } },
  trechos: {
    orderBy: { ordem: "asc" },
    select: { tipo: true, km: true, local: { select: { nome: true } } },
  },
  pedagios: {
    orderBy: { data: "asc" },
    select: { pracaPedagio: true, valor: true, data: true },
  },
  fotos: { orderBy: { capturadaEm: "asc" }, select: { id: true, rotacao: true } },
} satisfies Prisma.ViagemSelect;

type ViagemSelecionada = Prisma.ViagemGetPayload<{ select: typeof SELECT_VIAGEM_PUBLICA }>;

/**
 * O status interno é jargão de conferência: "DIVERGENTE" pro cliente cria uma
 * conversa que não é dele (a divergência é entre a Schaba e o motorista). O
 * comprovante fala de duas coisas só: já foi conferido, ou ainda está sendo.
 */
function mapearSituacao(status: StatusViagem): SituacaoPublica {
  switch (status) {
    case "OK":
      return { rotulo: "Conferida", tom: "ok" };
    case "EM_ANDAMENTO":
      return { rotulo: "Em andamento", tom: "atencao" };
    default:
      return { rotulo: "Em conferência", tom: "neutro" };
  }
}

const ROTULO_TRECHO: Record<string, string> = {
  RETORNO_BOTA_FORA: "Retorno (bota-fora)",
  ENTREGA: "Entrega adicional",
};

function local(l: ViagemSelecionada["localCarga"]): LocalPublico | null {
  if (!l) return null;
  return { nome: l.nome, cidade: l.cidade, uf: l.uf, lat: l.lat, lng: l.lng };
}

/** Data-only (`@db.Date`) sai como YYYY-MM-DD — sem hora, sem fuso pra errar. */
function dataISO(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function serializarViagemPublica(
  viagem: ViagemSelecionada,
  ctx: {
    regras: RegraMinimoRow[];
    expiraEm: Date;
    agora: Date;
    /** Geometria do par de locais (RotaCache), usada quando a viagem não tem uma própria. */
    rotaDoPar: string | null;
  },
): ViagemPublica {
  // Mínimo por faixa: mesma resolução do painel, mas só o RESULTADO sai daqui.
  const empresaId = viagem.cliente?.empresaId;
  const materialId = viagem.material?.id;
  const override =
    ctx.regras.length > 0 && empresaId && materialId
      ? (resolverRegraMinimo(ctx.regras, empresaId, materialId, viagem.km ?? 0) ?? undefined)
      : undefined;
  const minimos = aplicarMinimos({ km: viagem.km, toneladas: viagem.toneladas }, override);

  return {
    ticket: viagem.ticket,
    data: dataISO(viagem.data),
    situacao: mapearSituacao(viagem.status),
    emitidoEm: ctx.agora.toISOString(),
    linkExpiraEm: ctx.expiraEm.toISOString(),

    material: viagem.material ? { nome: viagem.material.nome } : null,
    motorista: { nome: viagem.motorista.nome },
    veiculo: { placa: viagem.veiculo.placa },

    origem: local(viagem.localCarga),
    destino: local(viagem.localDescarga),
    trechos: viagem.trechos.map((t) => ({
      rotulo: ROTULO_TRECHO[t.tipo] ?? "Trecho adicional",
      localNome: t.local?.nome ?? null,
      km: t.km != null ? t.km.toFixed(2) : null,
    })),

    km: {
      informado: minimos.kmInformado,
      efetivo: minimos.kmEfetivo,
      ajustadoPorMinimo: minimos.kmAjustada,
    },
    toneladas: {
      informada: minimos.toneladasInformada,
      efetiva: minimos.toneladasEfetiva,
      ajustadoPorMinimo: minimos.toneladasAjustada,
    },

    pedagio: {
      total: viagem.valorPedagioTotal != null ? viagem.valorPedagioTotal.toFixed(2) : null,
      itens: viagem.pedagios.map((p) => ({
        praca: p.pracaPedagio,
        valor: p.valor.toFixed(2),
        data: dataISO(p.data) ?? "",
      })),
    },

    // `Viagem.rotaGeometria` só existe quando o motorista ESCOLHEU uma rota no
    // seletor — na maioria das viagens é null, e sem o fallback o mapa do
    // comprovante ficava só com os dois pinos. Mesmo encadeamento do detalhe do
    // painel (viagens.service.ts `detalhe`), pra as duas telas desenharem igual.
    //
    // O `rota_cache` é por PAR de locais, não por viagem — ler ele direto já
    // causou bug antes (aviso de pedágio acusando praça não cruzada). Aqui não
    // morde: o comprovante não DERIVA nada da geometria; km e toneladas vêm da
    // própria viagem, e a linha é ilustração do trajeto. Se um dia alguém for
    // calcular algo a partir deste campo, tem que resolver por viagem primeiro.
    rotaGeometria: viagem.rotaGeometria ?? ctx.rotaDoPar,
    fotos: viagem.fotos.map((f) => ({ id: f.id, rotacao: f.rotacao })),
  };
}
