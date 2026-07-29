import { Logger } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { MotoristaService } from "../../motorista/motorista.service";
import { ViagensMotoristaService } from "../../motorista/viagens.service";
import { DashboardService } from "../../admin/dashboard/dashboard.service";
import { ErrorsService } from "../../errors/errors.service";
import { UploadsService } from "../../uploads/uploads.service";
import { EvolutionClientService } from "../evolution-client.service";
import { ymdSaoPaulo } from "../../common/timezone";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import type { SessaoResolvida } from "../sessao.service";
import type { AgentToolDefinition } from "./providers/agent.provider";

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
  metadata?: {
    evolutionMessageId?: string;
    tipoMidia?: "imagem" | "audio";
    evolutionPayload?: { key: unknown; message: unknown };
    telefoneRemetente?: string;
  };
};

// ===== TOOL DEFINITIONS (formato neutro — JSON Schema, portável entre providers) =====

const TOOLS_COMUNS: AgentToolDefinition[] = [
  {
    name: "quem_sou_eu",
    description:
      "Retorna nome e perfil do usuário atual. Use no começo se precisar contextualizar.",
    input_schema: { type: "object", properties: {} },
  },
];

const TOOLS_MOTORISTA: AgentToolDefinition[] = [
  {
    name: "buscar_catalogo",
    description:
      "Busca fuzzy por nome em catálogos (material, cliente, local, veiculo). " +
      "Tolera typo, abreviação, acento e apelidos (admin cadastra apelidos no painel). " +
      "Retorna até 8 candidatos com `score` (0..2) e `motivo[]` (justificativa legível) " +
      "pra você escolher e justificar a escolha pro motorista. " +
      "Score alto + 'usado Nx' = quase certeza, mas SEMPRE confirme citando o nome exato. " +
      "Score baixo (<0.5) OU múltiplos candidatos próximos (diferença <0.15) → liste opções. " +
      "Ao buscar `local` de DESCARGA E já ter o de CARGA resolvido, passe `ancora_local_id` " +
      "pra priorizar locais próximos no ranking.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["material", "cliente", "local", "veiculo"],
          description: "Tipo do catálogo a buscar",
        },
        q: {
          type: "string",
          description: "Texto livre pra buscar (fuzzy: typo/acento/apelido tolerados)",
        },
        ancora_local_id: {
          type: "string",
          description:
            "Opcional (só pra tipo=local). UUID de um local já resolvido — o ranking " +
            "vai priorizar locais próximos geograficamente. Útil pra desambiguar descarga.",
        },
      },
      required: ["tipo", "q"],
    },
  },
  {
    name: "inferir_cliente_por_trajeto",
    description:
      "Quando carga e descarga JÁ estão resolvidos (você tem localCargaId E localDescargaId) " +
      "e o motorista NÃO citou o cliente, chame esta tool ANTES de perguntar. Olha no histórico " +
      "de viagens da empresa quais clientes já foram atendidos por esse mesmo par origem→destino. " +
      "Se `auto_selecionavel: true` E `candidatos[0]` for único, USE direto o cliente no resumo " +
      "mencionando 'presumi pelo trajeto' (motorista valida no confirma). " +
      "Se vier 2-3 candidatos com `auto_selecionavel: false`, mostra opções numeradas. " +
      "Se vier lista vazia, cai no fluxo normal (perguntar o nome).",
    input_schema: {
      type: "object",
      properties: {
        localCargaId: { type: "string", description: "UUID do local de carga já resolvido" },
        localDescargaId: { type: "string", description: "UUID do local de descarga já resolvido" },
        materialId: {
          type: "string",
          description:
            "Opcional. Boost pequeno se cliente historicamente recebeu esse material no mesmo trajeto.",
        },
      },
      required: ["localCargaId", "localDescargaId"],
    },
  },
  {
    name: "locais_recentes_do_motorista",
    description:
      "Lista os locais que ESTE motorista mais usou recentemente (default 30d). " +
      "Use ANTES de `buscar_catalogo` quando o motorista for vago: 'igual ontem', " +
      "'mesma de sempre', 'volta pra base'. Retorna top 10 com contagem por papel " +
      "(carga/descarga) e última data — assim você pode sugerir um atalho.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["carga", "descarga", "ambos"],
          description: "Filtra por papel do local na viagem (default: ambos)",
        },
        dias: {
          type: "number",
          description: "Janela em dias (default: 30, max: 180)",
        },
      },
    },
  },
  {
    name: "perfil_motorista",
    description:
      "Retorna perfil rico do motorista pra você ter contexto sem buscar tudo: " +
      "nome, placa default, top 5 materiais, top 10 clientes, top 20 locais e top 10 trajetos " +
      "(par carga→descarga→cliente mais frequentes) dos últimos 90 dias. " +
      "Chame UMA VEZ no início se ainda não tiver chamado nesta conversa — assim " +
      "você já 'conhece o universo' desse motorista e raramente precisa buscar. " +
      "Tudo em texto humano (placas, nomes), zero IDs.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "lancar_viagem",
    description:
      "Cria/valida uma viagem usando NOMES HUMANOS (placas, nomes de cliente/material/locais), " +
      "não UUIDs. Você passa o que o motorista falou, o backend resolve fuzzy. " +
      "\n\n**USE EM 2 ETAPAS:**" +
      "\n1. **PRIMEIRO** chame com `dry_run: true` assim que tiver os primeiros dados (mesmo " +
      "   incompletos). O backend valida fuzzy SEM CRIAR e devolve ambiguidades/faltando. " +
      "   Use o retorno pra conversar: oferecer opções, pedir o que falta, confirmar nomes. " +
      "\n2. **SÓ DEPOIS** do motorista confirmar (\"sim/ok/pode\") chame de novo com " +
      "   `dry_run: false` (ou omitido) pra criar de verdade." +
      "\n\nVeículo é opcional (usa o default do motorista). Cliente é opcional (se carga e " +
      "descarga forem comuns, o backend infere). Data aceita 'hoje', 'ontem' ou ISO. " +
      "\n\nRetorno: " +
      "\n- `{ok: true, dry_run: true, viagem: {...}}` — tudo resolvido na simulação, monte " +
      "  resumo com os nomes canônicos da viagem e peça \"Confirma?\". " +
      "\n- `{ok: true, ticket, viagem: {...}}` — viagem criada de verdade, anuncie ao motorista. " +
      "\n- `{ok: false, ambiguidades: [...]}` — algum campo tem mais de uma opção, " +
      "  apresente as opções via `oferecer_opcoes` (botões clicáveis). " +
      "\n- `{ok: false, faltando: [...]}` — algum dado essencial não veio, pergunte uma vez " +
      "  só juntando o que falta. " +
      "\n- `{ok: false, erro: '...'}` — erro real (ticket duplicado, etc), explique " +
      "  pro motorista em PT-BR claro, sem dramatização. " +
      "\n\nIdempotente via motorista+ticket+data.",
    input_schema: {
      type: "object",
      properties: {
        material: {
          type: "string",
          description: "Nome do material como o motorista falou (ex: 'CBUQ', 'areia média', 'brita 1').",
        },
        carga: {
          type: "string",
          description: "Local de carga (nome/rua/bairro como o motorista falou).",
        },
        descarga: {
          type: "string",
          description: "Local de descarga (nome/cidade/cliente como o motorista falou).",
        },
        cliente: {
          type: "string",
          description:
            "Nome/código do cliente (opcional — se você omitir e o trajeto for comum, " +
            "backend infere; se houver dúvida, retorna ambiguidade pra você perguntar).",
        },
        veiculo: {
          type: "string",
          description: "Placa (opcional — sem isso usa o veículo padrão do motorista).",
        },
        toneladas: { type: "number", description: "Peso em toneladas." },
        ticket: { type: "string", description: "Número/código do ticket." },
        km: { type: "number", description: "Quilometragem rodada (somente a viagem)." },
        data: {
          type: "string",
          description: "'hoje', 'ontem' ou ISO (ex: 2026-05-08). Default: hoje.",
        },
        valorPedagioTotal: { type: "number", description: "R$ pedágio total (opcional)." },
        observacao: { type: "string", description: "Observação livre (opcional)." },
        dry_run: {
          type: "boolean",
          description:
            "true = só valida (não cria, não duplica). USE primeiro pra checar nomes/ambiguidades " +
            "antes do motorista confirmar. false/omitido = cria a viagem de verdade.",
        },
      },
      required: ["material", "carga", "descarga"],
    },
  },
  {
    name: "local_mais_proximo",
    description:
      "Quando o motorista compartilhar localização pelo WhatsApp (mensagem com " +
      "marcador `[localização: lat, lng]`), use ESTA tool pra achar locais cadastrados " +
      "próximos da coordenada (raio padrão 500m, expandível). Devolve até 5 candidatos " +
      "ordenados por distância. Use o retorno pra:" +
      "\n- Se 1 candidato perto (<100m), confirma direto: \"Você tá na *Pedreira X*?\"" +
      "\n- Se 2-5 candidatos, chame `oferecer_opcoes` com os nomes pra ele escolher." +
      "\n- Se nenhum candidato próximo, ofereça cadastrar como local novo (passa a " +
      "  coordenada pra `lancar_viagem` no campo carga ou descarga e o backend vai " +
      "  marcar como rascunho).",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude (decimal, ex: -25.0945)" },
        lng: { type: "number", description: "Longitude (decimal, ex: -50.1583)" },
        tipo: {
          type: "string",
          enum: ["carga", "descarga", "ambos"],
          description: "Filtra por papel do local (default: ambos)",
        },
        raio_metros: {
          type: "number",
          description: "Raio de busca em metros (default 500, max 5000)",
        },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "oferecer_opcoes",
    description:
      "Envia uma MENSAGEM DE TEXTO NUMERADA (1️⃣ 2️⃣ 3️⃣) com 1 a 5 opções pro " +
      "motorista escolher. Use SEMPRE que `lancar_viagem` retornar `ambiguidades`. " +
      "O motorista responde com o número ('1') ou com o nome — você interpreta " +
      "na próxima mensagem dele e refaz `lancar_viagem` com o nome canônico escolhido. " +
      "\n\nDEPOIS de chamar essa tool, TERMINE O TURNO IMEDIATAMENTE — não escreva " +
      "nenhum texto adicional. A própria tool já enviou a mensagem; texto extra vira " +
      "duplicação chata.",
    input_schema: {
      type: "object",
      properties: {
        pergunta: {
          type: "string",
          description:
            "Texto curto explicando o que escolher (ex: 'Não conheço \"Chumbo\". Qual destas é?'). " +
            "Vai aparecer ANTES da lista numerada.",
        },
        opcoes: {
          type: "array",
          description: "1 a 5 nomes de opções, na ordem de relevância (mais provável primeiro).",
          items: {
            type: "object",
            properties: {
              texto: {
                type: "string",
                description: "Nome humano da opção (sem prefixo numérico — a tool numera).",
              },
            },
            required: ["texto"],
          },
          minItems: 1,
          maxItems: 5,
        },
      },
      required: ["pergunta", "opcoes"],
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

const TOOLS_ADMIN: AgentToolDefinition[] = [
  {
    name: "dashboard_snapshot",
    description:
      "Retorna o snapshot atual do dashboard executivo: hoje, mês, pendências, última atividade, top motoristas/clientes/materiais.",
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

export function construirTools(perfil: "MOTORISTA" | "ADMIN"): AgentToolDefinition[] {
  return perfil === "MOTORISTA"
    ? [...TOOLS_COMUNS, ...TOOLS_MOTORISTA]
    : [...TOOLS_COMUNS, ...TOOLS_ADMIN];
}

// ===== TOOL EXECUTION =====

export async function executarTool(
  nome: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  log.log(`tool=${nome} input=${JSON.stringify(input).slice(0, 300)}`);
  try {
    const out = await executarToolInterno(nome, input, ctx);
    log.log(`tool=${nome} output=${JSON.stringify(out).slice(0, 500)}`);
    return out;
  } catch (e) {
    // Anexa o nome da tool no erro pra subir até o catch do WhatsappService
    // e cair no error_logs com origem ("agente:tool:nome_da_tool").
    const err = e instanceof Error ? e : new Error(String(e));
    (err as { toolName?: string }).toolName = nome;
    log.error(`tool=${nome} falhou: ${err.message}`);
    if (err.stack) log.error(err.stack);
    throw err;
  }
}

async function executarToolInterno(
  nome: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (nome) {
    case "quem_sou_eu":
      return ctx.identidade.tipo === "MOTORISTA"
        ? { tipo: "MOTORISTA", nome: ctx.identidade.nome, motoristaId: ctx.identidade.motoristaId }
        : { tipo: "ADMIN", nome: ctx.identidade.nome };

    case "perfil_motorista": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      return ctx.motorista.perfilParaAgente(ctx.identidade.motoristaId);
    }

    case "buscar_catalogo": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      const tipo = input.tipo as "material" | "cliente" | "local" | "veiculo";
      const q = String(input.q ?? "");
      const ancora = input.ancora_local_id ? String(input.ancora_local_id) : undefined;
      return ctx.motorista.buscarCatalogo(ctx.identidade.motoristaId, tipo, q, ancora);
    }

    case "locais_recentes_do_motorista": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      const tipoUso = (input.tipo as "carga" | "descarga" | "ambos") ?? "ambos";
      const dias = typeof input.dias === "number" ? Math.max(1, Math.min(180, input.dias)) : 30;
      return ctx.motorista.locaisRecentes(ctx.identidade.motoristaId, tipoUso, dias);
    }

    case "inferir_cliente_por_trajeto": {
      if (ctx.identidade.tipo !== "MOTORISTA")
        throw new Error("tool não disponível pra esse perfil");
      const localCargaId = String(input.localCargaId ?? "");
      const localDescargaId = String(input.localDescargaId ?? "");
      if (!localCargaId || !localDescargaId) {
        throw new Error(
          "localCargaId e localDescargaId são obrigatórios — chame buscar_catalogo antes pra resolver os locais.",
        );
      }
      const materialId = input.materialId ? String(input.materialId) : undefined;
      return ctx.motorista.inferirClientePorTrajeto(
        ctx.identidade.motoristaId,
        localCargaId,
        localDescargaId,
        materialId,
      );
    }

    case "lancar_viagem": {
      if (ctx.identidade.tipo !== "MOTORISTA")
        throw new Error("tool não disponível pra esse perfil");

      const dryRun = input.dry_run === true;

      // 1. Resolve nomes humanos → UUIDs no backend (modelo nunca toca em UUID).
      //    Passa sessaoId pro backend usar/popular cache de escolhas pendentes —
      //    mata o loop "perguntou-respondeu-perguntou de novo".
      const resolucao = await ctx.motorista.resolverViagemPorNomes(
        ctx.identidade.motoristaId,
        {
          veiculo: input.veiculo ? String(input.veiculo) : undefined,
          cliente: input.cliente ? String(input.cliente) : undefined,
          material: input.material ? String(input.material) : undefined,
          carga: input.carga ? String(input.carga) : undefined,
          descarga: input.descarga ? String(input.descarga) : undefined,
          data: input.data ? String(input.data) : undefined,
        },
        ctx.identidade.sessaoId,
      );

      // Valida campos numericos/ticket SOMENTE pra criar de verdade — em dry_run
      // a gente quer ajudar o modelo a ver o que ainda falta.
      const faltandoBasicos: string[] = [];
      if (input.toneladas == null || Number.isNaN(Number(input.toneladas)))
        faltandoBasicos.push("toneladas");
      if (!input.ticket || String(input.ticket).trim() === "")
        faltandoBasicos.push("ticket");
      if (input.km == null || Number.isNaN(Number(input.km)))
        faltandoBasicos.push("km");

      if (!resolucao.resolvido || faltandoBasicos.length > 0) {
        const ambig = resolucao.resolvido ? [] : resolucao.ambiguidades;
        const falt = [
          ...(resolucao.resolvido ? [] : resolucao.faltando),
          ...faltandoBasicos,
        ];
        const instrucoes: string[] = [];
        if (ambig.length > 0) {
          instrucoes.push(
            "AÇÃO OBRIGATÓRIA: chame `oferecer_opcoes` AGORA pra cada ambiguidade, " +
              "passando os `candidatos` como botões. NÃO responda em texto listando opções.",
          );
        }
        if (falt.length > 0) {
          instrucoes.push(
            `Pergunte ao motorista, em UMA mensagem só, o que falta: ${falt.join(", ")}.`,
          );
        }
        return {
          ok: false,
          dry_run: dryRun,
          ambiguidades: ambig,
          faltando: falt,
          instrucao: instrucoes.join(" "),
        };
      }

      // Em dry_run, devolve resumo dos nomes canônicos (sem criar)
      if (dryRun) {
        return {
          ok: true,
          dry_run: true,
          viagem: {
            ...resolucao.nomesCanonicos,
            toneladas: Number(input.toneladas),
            km: Number(input.km),
            ticket: String(input.ticket),
          },
          notas: resolucao.notas,
        };
      }

      // Cria a viagem com os IDs resolvidos
      const clientIdInput = {
        ticket: input.ticket,
        clienteId: resolucao.ids.clienteId,
        data: resolucao.ids.data.toISOString(),
      };
      const clientId = derivarClientId(ctx.identidade.motoristaId, clientIdInput);

      try {
        const v = await ctx.viagens.create(ctx.identidade.motoristaId, {
          clientId,
          veiculoId: resolucao.ids.veiculoId,
          clienteId: resolucao.ids.clienteId,
          materialId: resolucao.ids.materialId,
          localCargaId: resolucao.ids.localCargaId,
          localDescargaId: resolucao.ids.localDescargaId,
          data: resolucao.ids.data,
          toneladas: Number(input.toneladas),
          ticket: String(input.ticket),
          km: Number(input.km),
          valorPedagioTotal:
            input.valorPedagioTotal != null ? Number(input.valorPedagioTotal) : undefined,
          observacao: input.observacao ? String(input.observacao) : undefined,
        } as never);
        // Viagem criada — limpa cache de escolhas pra próxima viagem começar limpa.
        ctx.motorista.limparPendenciasSessao(ctx.identidade.sessaoId);
        return {
          ok: true,
          ticket: v?.ticket,
          viagem: {
            ...resolucao.nomesCanonicos,
            toneladas: Number(input.toneladas),
            km: Number(input.km),
          },
          notas: resolucao.notas,
        };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return {
          ok: false,
          erro: err.message,
        };
      }
    }

    case "local_mais_proximo": {
      if (ctx.identidade.tipo !== "MOTORISTA")
        throw new Error("tool não disponível pra esse perfil");
      const lat = Number(input.lat);
      const lng = Number(input.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new Error("lat e lng obrigatórios e numéricos.");
      }
      const tipo = (input.tipo as "carga" | "descarga" | "ambos") ?? "ambos";
      const raio = typeof input.raio_metros === "number"
        ? Math.max(50, Math.min(5000, input.raio_metros))
        : 500;
      const candidatos = await ctx.motorista.locaisMaisProximos(
        ctx.identidade.motoristaId,
        lat,
        lng,
        tipo,
        raio,
      );
      return {
        total: candidatos.length,
        raio_metros: raio,
        candidatos: candidatos.map((c) => ({
          nome: c.nome,
          cidade: c.cidade,
          uf: c.uf,
          distanciaMetros: c.distanciaMetros,
          tipo: c.tipoLocal,
          vezesUsado: c.vezesUsadoMotorista,
        })),
        instrucao:
          candidatos.length === 0
            ? "Nenhum local cadastrado nesse raio. Pergunte ao motorista o nome desse local — você pode passar a coordenada na próxima `lancar_viagem` (campo carga ou descarga) e o backend cria como rascunho."
            : candidatos.length === 1 && candidatos[0].distanciaMetros < 100
              ? `Há 1 candidato muito próximo (${candidatos[0].distanciaMetros}m). Confirme citando o nome: 'Você tá na *${candidatos[0].nome}*?'`
              : `Há ${candidatos.length} candidatos. Chame \`oferecer_opcoes\` passando os nomes pro motorista escolher.`,
      };
    }

    case "oferecer_opcoes": {
      if (ctx.identidade.tipo !== "MOTORISTA")
        throw new Error("tool não disponível pra esse perfil");
      const telefone = ctx.metadata?.telefoneRemetente;
      if (!telefone) throw new Error("Telefone do destinatário ausente no contexto.");
      const pergunta = String(input.pergunta ?? "").trim() || "Qual destas?";
      const opcoesRaw = (input.opcoes as Array<{ texto?: unknown }> | undefined) ?? [];
      const opcoes = opcoesRaw
        .map((o) => String(o?.texto ?? "").trim())
        .filter((t) => t.length > 0)
        .slice(0, 5);
      if (opcoes.length === 0) {
        throw new Error("oferecer_opcoes precisa de pelo menos 1 opção válida.");
      }

      // Texto numerado formatado pro WhatsApp. Botões interativos via Baileys
      // não renderizam em clientes WhatsApp normais (só Cloud API oficial),
      // então usamos texto formatado bonito que funciona em qualquer cliente.
      const numeros = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
      const linhas = opcoes.map((t, i) => `${numeros[i] ?? `${i + 1}.`}  *${t}*`);
      const mensagem =
        `${pergunta}\n\n${linhas.join("\n")}\n\n_Responde com o número ou o nome._`;

      await ctx.evolution.enviarTexto(telefone, mensagem);

      // Persiste a mensagem enviada como SAIDA (assim o histórico do agente
      // já vê isso na próxima mensagem do motorista).
      await ctx.prisma.whatsappMensagem.create({
        data: {
          sessaoId: ctx.identidade.sessaoId,
          telefone,
          direcao: "SAIDA",
          conteudo: mensagem,
          tipo: "TEXTO",
        },
      });

      return {
        enviado: true,
        instrucao:
          "Mensagem com opções enviada. TERMINE O TURNO AGORA SEM RESPONDER TEXTO. Aguarde o motorista mandar o número ou o nome.",
      };
    }

    case "consultar_minhas_viagens": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      const desde = (input.desde as string) ?? "hoje";
      const inicio = inicioJanela(desde);
      const lista = await ctx.prisma.viagem.findMany({
        where: {
          motoristaId: ctx.identidade.motoristaId,
          // Não reporta viagem incompleta (em andamento ou aguardando peso/ticket).
          status: { notIn: STATUS_FORA_FECHAMENTO },
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
          cliente: { select: { nome: true } },
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
          material: v.material?.nome ?? null,
          cliente: v.cliente?.nome ?? null,
          de: v.localCarga?.nome ?? null,
          para: v.localDescarga?.nome ?? null,
          placa: v.veiculo.placa,
          status: v.status,
        })),
      };
    }

    case "anexar_foto_ultima_viagem": {
      if (ctx.identidade.tipo !== "MOTORISTA") throw new Error("tool não disponível pra esse perfil");
      // Só prosseguir se a mensagem ATUAL é uma imagem — IA às vezes chama essa tool
      // após confirmação de viagem ("sim") mesmo sem foto.
      if (ctx.metadata?.tipoMidia !== "imagem") {
        throw new Error("A mensagem atual não contém imagem. Peça ao motorista pra mandar a foto e tente de novo.");
      }
      const payload = ctx.metadata?.evolutionPayload;
      if (!payload) throw new Error("Payload da mensagem indisponível — não dá pra baixar a mídia.");

      const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const ultimaViagem = await ctx.prisma.viagem.findFirst({
        where: {
          motoristaId: ctx.identidade.motoristaId,
          // Não anexa foto numa viagem em andamento (tem fluxo de foto próprio).
          status: { not: "EM_ANDAMENTO" },
          sincronizadoEm: { gte: seisHorasAtras },
        },
        orderBy: { sincronizadoEm: "desc" },
        select: { id: true, ticket: true, fotos: { select: { id: true } } },
      });
      if (!ultimaViagem) {
        throw new Error("Não achei viagem recente sua nas últimas 6h pra anexar foto.");
      }

      const midia = await ctx.evolution.baixarMidia(payload);
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
      // Agente do WhatsApp fala com admin da Schaba, não com gestor de frota:
      // sem recorte por transportadora.
      return ctx.dashboard.snapshot(null);
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
  const chave = `${motoristaId}|${input.ticket ?? ""}|${input.clienteId ?? ""}|${input.data ?? ""}`;
  if (input.ticket && input.clienteId) {
    const hex = createHash("sha256").update(chave).digest("hex");
    // Formato UUID v4-ish (não é v4 real, mas é único e estável)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  return randomUUID();
}

/**
 * Início da janela de consulta, ancorado na data civil de Brasília (UTC-3) —
 * NÃO no fuso do container (que roda em UTC). Retorna meia-noite UTC da data BR,
 * que é o formato que casa com a coluna `viagem.data` (@db.Date).
 * Sem isso, das 21h às 23h59 de Brasília o "hoje" pula pro dia seguinte e some.
 */
function inicioJanela(desde: string): Date {
  const [y, m, dia] = ymdSaoPaulo();
  if (desde === "ontem") return new Date(Date.UTC(y, m - 1, dia - 1));
  if (desde === "semana") return new Date(Date.UTC(y, m - 1, dia - 7));
  if (desde === "mes") return new Date(Date.UTC(y, m - 1, 1));
  return new Date(Date.UTC(y, m - 1, dia)); // hoje
}
