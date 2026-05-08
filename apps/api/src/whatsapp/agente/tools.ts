import type Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { MotoristaService } from "../../motorista/motorista.service";
import { ViagensMotoristaService } from "../../motorista/viagens.service";
import { DashboardService } from "../../admin/dashboard/dashboard.service";
import { ErrorsService } from "../../errors/errors.service";
import { UploadsService } from "../../uploads/uploads.service";
import { EvolutionClientService } from "../evolution-client.service";
import type { SessaoResolvida } from "../sessao.service";

const log = new Logger("AgenteTools");

type Identidade = Exclude<SessaoResolvida, { tipo: "DESCONHECIDO" }>;

export type ToolContext = {
  identidade: Identidade;
  prisma: PrismaService;
  motorista: MotoristaService;
  viagens: ViagensMotoristaService;
  dashboard: DashboardService;
  errors: ErrorsService;
  uploads: UploadsService;
  evolution: EvolutionClientService;
  metadata?: { evolutionMessageId?: string; tipoMidia?: "imagem" | "audio" };
};

// ===== TOOL DEFINITIONS (schemas Anthropic) =====

const TOOLS_COMUNS: Anthropic.Tool[] = [
  {
    name: "quem_sou_eu",
    description:
      "Retorna nome e perfil do usuário atual. Use no começo se precisar contextualizar.",
    input_schema: { type: "object", properties: {} },
  },
];

const TOOLS_MOTORISTA: Anthropic.Tool[] = [
  {
    name: "buscar_catalogo",
    description:
      "Busca por nome em catálogos do sistema. Use sempre que o usuário citar nome de material, obra, local de carga/descarga ou placa. Retorna até 5 resultados (id + nome). Se vier 0 ou >1, peça esclarecimento ao usuário antes de continuar.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["material", "obra", "local", "veiculo"],
          description: "Tipo do catálogo a buscar",
        },
        q: {
          type: "string",
          description: "Texto livre pra buscar (substring case-insensitive)",
        },
      },
      required: ["tipo", "q"],
    },
  },
  {
    name: "info_motorista",
    description:
      "Retorna info do motorista logado: nome, CPF, placa default, veículo associado.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "criar_viagem",
    description:
      "Cria uma nova viagem (lançamento de transporte). NUNCA chame sem confirmação explícita do usuário ('sim', 'confirma', 'ok'). Idempotente via clientId.",
    input_schema: {
      type: "object",
      properties: {
        veiculoId: { type: "string", description: "UUID do veículo" },
        obraId: { type: "string", description: "UUID da obra" },
        materialId: { type: "string", description: "UUID do material" },
        localCargaId: { type: "string", description: "UUID do local de carga" },
        localDescargaId: { type: "string", description: "UUID do local de descarga" },
        toneladas: { type: "number", description: "Toneladas, positivo" },
        ticket: { type: "string", description: "Número/código do ticket" },
        km: { type: "number", description: "Quilometragem rodada" },
        data: {
          type: "string",
          description: "Data em ISO (ex: 2026-05-08). Se vazio, usa hoje.",
        },
        valorPedagioTotal: {
          type: "number",
          description: "Valor total em R$ pedágio (opcional)",
        },
        observacao: { type: "string", description: "Observação livre (opcional)" },
      },
      required: [
        "veiculoId",
        "obraId",
        "materialId",
        "localCargaId",
        "localDescargaId",
        "toneladas",
        "ticket",
        "km",
      ],
    },
  },
  {
    name: "consultar_minhas_viagens",
    description:
      "Lista as viagens lançadas pelo motorista. Padrão: hoje. Use quando ele perguntar 'o que rodei?', 'minhas viagens'.",
    input_schema: {
      type: "object",
      properties: {
        desde: {
          type: "string",
          enum: ["hoje", "ontem", "semana", "mes"],
          description: "Janela temporal (default: hoje)",
        },
      },
    },
  },
  {
    name: "anexar_foto_ultima_viagem",
    description:
      "Pega a foto da última mensagem do WhatsApp e anexa à viagem mais recente do motorista (criada nas últimas 6h). Use quando o motorista mandar uma imagem depois de criar viagem.",
    input_schema: { type: "object", properties: {} },
  },
];

const TOOLS_ADMIN: Anthropic.Tool[] = [
  {
    name: "dashboard_snapshot",
    description:
      "Retorna o snapshot atual do dashboard executivo: hoje, mês, pendências, última atividade, top motoristas/obras/materiais.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "consultar_erros_pendentes",
    description:
      "Lista os erros agrupados pendentes (não resolvidos). Use quando admin pergunta 'tem erro?', 'bugs novos?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "marcar_erro_resolvido",
    description:
      "Marca todas as ocorrências de um hash de erro como resolvidas. Pegue o hash do retorno de consultar_erros_pendentes. Pode chamar direto sem confirmação (admin pode reabrir pelo painel).",
    input_schema: {
      type: "object",
      properties: {
        hash: { type: "string", description: "Hash do erro (do retorno de consultar_erros_pendentes)" },
      },
      required: ["hash"],
    },
  },
];

export function construirTools(perfil: "MOTORISTA" | "ADMIN"): Anthropic.Tool[] {
  if (perfil === "MOTORISTA") return [...TOOLS_COMUNS, ...TOOLS_MOTORISTA];
  return [...TOOLS_COMUNS, ...TOOLS_ADMIN];
}

// ===== TOOL EXECUTION =====

export async function executarTool(
  nome: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  log.log(`tool=${nome} input=${JSON.stringify(input).slice(0, 200)}`);

  switch (nome) {
    case "quem_sou_eu":
      return ctx.identidade.tipo === "MOTORISTA"
        ? { tipo: "MOTORISTA", nome: ctx.identidade.nome, motoristaId: ctx.identidade.motoristaId }
        : { tipo: "ADMIN", nome: ctx.identidade.nome, perfil: ctx.identidade.perfil };

    case "info_motorista": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      return ctx.motorista.me(ctx.identidade.motoristaId);
    }

    case "buscar_catalogo": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      const tipo = input.tipo as "material" | "obra" | "local" | "veiculo";
      const q = String(input.q ?? "");
      return ctx.motorista.buscarCatalogo(ctx.identidade.motoristaId, tipo, q);
    }

    case "criar_viagem": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      const clientId = derivarClientId(ctx.identidade.motoristaId, input);
      const data = input.data ? new Date(String(input.data)) : new Date();
      const v = await ctx.viagens.create(ctx.identidade.motoristaId, {
        clientId,
        veiculoId: String(input.veiculoId),
        obraId: String(input.obraId),
        materialId: String(input.materialId),
        localCargaId: String(input.localCargaId),
        localDescargaId: String(input.localDescargaId),
        data,
        toneladas: Number(input.toneladas),
        ticket: String(input.ticket),
        km: Number(input.km),
        valorPedagioTotal:
          input.valorPedagioTotal != null ? Number(input.valorPedagioTotal) : undefined,
        observacao: input.observacao ? String(input.observacao) : undefined,
      } as never);
      return {
        ok: true,
        viagemId: v?.id,
        ticket: v?.ticket,
        criadaEm: v?.sincronizadoEm,
      };
    }

    case "consultar_minhas_viagens": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      const desde = (input.desde as string) ?? "hoje";
      const inicio = inicioJanela(desde);
      const lista = await ctx.prisma.viagem.findMany({
        where: {
          motoristaId: ctx.identidade.motoristaId,
          data: { gte: inicio },
        },
        select: {
          id: true,
          data: true,
          ticket: true,
          toneladas: true,
          km: true,
          status: true,
          material: { select: { nome: true } },
          obra: { select: { nome: true } },
          localCarga: { select: { nome: true } },
          localDescarga: { select: { nome: true } },
          veiculo: { select: { placa: true } },
        },
        orderBy: { data: "desc" },
        take: 20,
      });
      return {
        janela: desde,
        total: lista.length,
        toneladasTotal: lista
          .reduce((s, v) => s + Number(v.toneladas), 0)
          .toFixed(2),
        viagens: lista.map((v) => ({
          ticket: v.ticket,
          data: v.data,
          toneladas: Number(v.toneladas),
          km: Number(v.km),
          material: v.material.nome,
          obra: v.obra.nome,
          de: v.localCarga.nome,
          para: v.localDescarga.nome,
          placa: v.veiculo.placa,
          status: v.status,
        })),
      };
    }

    case "anexar_foto_ultima_viagem": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      const messageId = ctx.metadata?.evolutionMessageId;
      if (!messageId) throw new Error("Nenhuma imagem na mensagem atual.");

      const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const ultimaViagem = await ctx.prisma.viagem.findFirst({
        where: {
          motoristaId: ctx.identidade.motoristaId,
          sincronizadoEm: { gte: seisHorasAtras },
        },
        orderBy: { sincronizadoEm: "desc" },
        select: { id: true, ticket: true, fotos: { select: { id: true } } },
      });
      if (!ultimaViagem) {
        throw new Error("Não achei viagem recente sua nas últimas 6h pra anexar foto.");
      }

      const midia = await ctx.evolution.baixarMidia(messageId);
      if (!midia) throw new Error("Não consegui baixar a foto do WhatsApp.");

      const storageKey = await ctx.uploads.putTicketFoto(
        midia.buffer,
        midia.mimetype,
        ctx.identidade.motoristaId,
      );
      await ctx.prisma.ticketFoto.create({
        data: {
          viagemId: ultimaViagem.id,
          storageKey,
          capturadaEm: new Date(),
        },
      });

      return {
        ok: true,
        viagemId: ultimaViagem.id,
        ticket: ultimaViagem.ticket,
        totalFotos: ultimaViagem.fotos.length + 1,
      };
    }

    case "dashboard_snapshot": {
      if (ctx.identidade.tipo !== "ADMIN") throw new Error("tool não disponível pra esse perfil");
      return ctx.dashboard.snapshot();
    }

    case "consultar_erros_pendentes": {
      if (ctx.identidade.tipo !== "ADMIN") throw new Error("tool não disponível pra esse perfil");
      const grupos = await ctx.errors.agrupados({ status: "pendentes", limit: 10 });
      return {
        total: grupos.length,
        erros: grupos.map((g, i) => ({
          ordem: i + 1,
          hash: g.hash,
          origem: g.origem,
          message: g.message,
          ocorrencias: g.ocorrencias,
          ultima: g.ultimaOcorrencia,
        })),
      };
    }

    case "marcar_erro_resolvido": {
      if (ctx.identidade.tipo !== "ADMIN") throw new Error("tool não disponível pra esse perfil");
      const hash = String(input.hash);
      const r = await ctx.errors.resolverGrupo(hash, ctx.identidade.userId);
      return { ok: true, count: r.count };
    }

    default:
      throw new Error(`Tool desconhecida: ${nome}`);
  }
}

// ===== Helpers =====

/**
 * Gera clientId determinístico baseado em motorista + ticket + data, pra
 * idempotência: se o motorista mandar a mesma viagem 2x (mesmo "criar_viagem"),
 * o backend reconhece e não duplica. UUID aleatório só como fallback.
 */
function derivarClientId(motoristaId: string, input: Record<string, unknown>): string {
  const chave = `${motoristaId}|${input.ticket ?? ""}|${input.obraId ?? ""}|${input.data ?? ""}`;
  if (input.ticket && input.obraId) {
    const hex = createHash("sha256").update(chave).digest("hex");
    // Formato UUID v4-ish (não é v4 real, mas é único e estável)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  return randomUUID();
}

function inicioJanela(desde: string): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (desde === "ontem") {
    d.setDate(d.getDate() - 1);
  } else if (desde === "semana") {
    d.setDate(d.getDate() - 7);
  } else if (desde === "mes") {
    d.setDate(1);
  }
  return d;
}
