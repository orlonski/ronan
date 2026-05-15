import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type CatalogoTipo = "material" | "obra" | "local" | "veiculo";

export type CatalogoMatch = {
  id: string;
  nome: string;
  score: number;       // ranking combinado (sim + uso + recência + proximidade)
  simTextual: number;  // 0..1+ — só similaridade de texto (sem boosts)
  motivo: string[];
  // campos extras por tipo (cidade/uf/tipo pra local, placa/modelo pra veiculo, etc)
  extras?: Record<string, unknown>;
};

type CampoViagem = "veiculo" | "obra" | "material" | "carga" | "descarga";

type EscolhaPendente = {
  campo: CampoViagem;
  candidatos: Array<{ id: string; nome: string; nomeNormalizado: string }>;
  criadoEm: number;
};

const ESCOLHA_TTL_MS = 30 * 60 * 1000; // 30 min

@Injectable()
export class MotoristaService {
  /**
   * Cache de pendências por sessão WhatsApp. Quando lancar_viagem retorna
   * ambiguidade, guardamos os candidatos COM IDs aqui. Se o motorista
   * escolher e o agente refizer lancar_viagem com o nome canônico, o
   * resolverCampo usa direto sem refazer fuzzy (que poderia voltar a errar).
   */
  private escolhasPendentes = new Map<string, EscolhaPendente[]>();

  constructor(private readonly prisma: PrismaService) {}

  private normalizar(s: string): string {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // remove acentos
      .replace(/\s+/g, " ")
      .trim();
  }

  private salvarPendencia(
    sessaoId: string,
    campo: CampoViagem,
    candidatos: Array<{ id: string; nome: string }>,
  ): void {
    const lista = this.escolhasPendentes.get(sessaoId) ?? [];
    // Remove pendência antiga do mesmo campo (substituição)
    const filtrada = lista.filter((p) => p.campo !== campo);
    filtrada.push({
      campo,
      candidatos: candidatos.map((c) => ({
        ...c,
        nomeNormalizado: this.normalizar(c.nome),
      })),
      criadoEm: Date.now(),
    });
    this.escolhasPendentes.set(sessaoId, filtrada);
  }

  private buscarPendencia(
    sessaoId: string,
    campo: CampoViagem,
    valorBuscado: string,
  ): { id: string; nome: string } | null {
    const lista = this.escolhasPendentes.get(sessaoId);
    if (!lista) return null;
    const agora = Date.now();
    // Limpa pendências expiradas
    const validas = lista.filter((p) => agora - p.criadoEm < ESCOLHA_TTL_MS);
    if (validas.length !== lista.length) {
      this.escolhasPendentes.set(sessaoId, validas);
    }
    const pend = validas.find((p) => p.campo === campo);
    if (!pend) return null;
    const alvo = this.normalizar(valorBuscado);
    const match = pend.candidatos.find((c) => c.nomeNormalizado === alvo);
    return match ? { id: match.id, nome: match.nome } : null;
  }

  /** Limpa cache de pendências da sessão (chamado após viagem criada). */
  limparPendenciasSessao(sessaoId: string): void {
    this.escolhasPendentes.delete(sessaoId);
  }

  async me(id: string) {
    const m = await this.prisma.motorista.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        nome: true,
        cpf: true,
        telefone: true,
        veiculoDefaultId: true,
        veiculoDefault: { select: { id: true, placa: true, modelo: true } },
        veiculos: {
          select: { veiculo: { select: { id: true, placa: true, modelo: true } } },
          orderBy: { veiculo: { placa: "asc" } },
        },
        ultimoLoginEm: true,
      },
    });
    const { veiculos, ...rest } = m;
    return { ...rest, veiculos: veiculos.map((v) => v.veiculo) };
  }

  /**
   * Perfil rico pro agente IA do WhatsApp ter contexto sem precisar buscar
   * tudo a cada turno. Devolve só nomes/placas (zero UUIDs) — o objetivo é
   * que o modelo "saiba o universo provável" desse motorista de cara.
   */
  async perfilParaAgente(motoristaId: string) {
    const m = await this.me(motoristaId);

    type LinhaTop = { nome: string; vezes: bigint; ultima: Date };
    type LinhaTrajeto = {
      carga: string;
      cargaCidade: string;
      descarga: string;
      descargaCidade: string;
      obra: string;
      vezes: bigint;
      ultima: Date;
    };

    const [topMateriais, topObras, topLocais, topTrajetos] = await Promise.all([
      this.prisma.$queryRaw<LinhaTop[]>`
        SELECT mat.nome AS nome, COUNT(*)::bigint AS vezes, MAX(v.data) AS ultima
        FROM viagens v
        JOIN materiais mat ON mat.id = v."materialId"
        WHERE v."motoristaId" = ${motoristaId}
          AND v.data >= now() - interval '90 days'
          AND mat.ativo = true
        GROUP BY mat.nome
        ORDER BY vezes DESC, ultima DESC
        LIMIT 5
      `,
      this.prisma.$queryRaw<LinhaTop[]>`
        SELECT o.nome AS nome, COUNT(*)::bigint AS vezes, MAX(v.data) AS ultima
        FROM viagens v
        JOIN obras o ON o.id = v."obraId"
        WHERE v."motoristaId" = ${motoristaId}
          AND v.data >= now() - interval '90 days'
          AND o.ativa = true
        GROUP BY o.nome
        ORDER BY vezes DESC, ultima DESC
        LIMIT 10
      `,
      this.prisma.$queryRaw<(LinhaTop & { cidade: string; uf: string })[]>`
        WITH usos AS (
          SELECT "localCargaId" AS id FROM viagens
            WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '90 days'
          UNION ALL
          SELECT "localDescargaId" AS id FROM viagens
            WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '90 days'
        ),
        agg AS (
          SELECT id, COUNT(*)::bigint AS vezes
          FROM usos GROUP BY id
        )
        SELECT l.nome AS nome, l.cidade AS cidade, l.uf AS uf,
               a.vezes AS vezes, MAX(v.data) AS ultima
        FROM agg a
        JOIN locais l ON l.id = a.id AND l.ativo = true
        JOIN viagens v ON (v."localCargaId" = a.id OR v."localDescargaId" = a.id)
                       AND v."motoristaId" = ${motoristaId}
        GROUP BY l.nome, l.cidade, l.uf, a.vezes
        ORDER BY vezes DESC, ultima DESC
        LIMIT 20
      `,
      this.prisma.$queryRaw<LinhaTrajeto[]>`
        SELECT lc.nome AS carga, lc.cidade AS "cargaCidade",
               ld.nome AS descarga, ld.cidade AS "descargaCidade",
               o.nome AS obra,
               COUNT(*)::bigint AS vezes, MAX(v.data) AS ultima
        FROM viagens v
        JOIN locais lc ON lc.id = v."localCargaId"
        JOIN locais ld ON ld.id = v."localDescargaId"
        JOIN obras o ON o.id = v."obraId" AND o.ativa = true
        WHERE v."motoristaId" = ${motoristaId}
          AND v.data >= now() - interval '90 days'
        GROUP BY lc.nome, lc.cidade, ld.nome, ld.cidade, o.nome
        ORDER BY vezes DESC, ultima DESC
        LIMIT 10
      `,
    ]);

    const formatTop = (arr: LinhaTop[]) =>
      arr.map((r) => ({
        nome: r.nome,
        vezes: Number(r.vezes),
        ultimaData: r.ultima.toISOString().slice(0, 10),
      }));

    return {
      motorista: {
        nome: m.nome,
        cpf: m.cpf,
        veiculoDefault: m.veiculoDefault
          ? { placa: m.veiculoDefault.placa, modelo: m.veiculoDefault.modelo }
          : null,
        outrosVeiculos: m.veiculos
          .filter((v) => v.id !== m.veiculoDefaultId)
          .map((v) => ({ placa: v.placa, modelo: v.modelo })),
      },
      janela_dias: 90,
      topMateriais: formatTop(topMateriais),
      topObras: formatTop(topObras),
      topLocais: topLocais.map((r) => ({
        nome: r.nome,
        cidade: r.cidade,
        uf: r.uf,
        vezes: Number(r.vezes),
        ultimaData: r.ultima.toISOString().slice(0, 10),
      })),
      topTrajetos: topTrajetos.map((r) => ({
        de: `${r.carga} (${r.cargaCidade})`,
        para: `${r.descarga} (${r.descargaCidade})`,
        obra: r.obra,
        vezes: Number(r.vezes),
        ultimaData: r.ultima.toISOString().slice(0, 10),
      })),
    };
  }

  /**
   * Resolve nomes/placas humanos pra UUIDs antes de criar a viagem.
   * Tira o UUID do contrato com o modelo IA — ele só fala em texto livre.
   *
   * Detecção: string com 36 chars no formato UUID = ID direto; senao busca
   * fuzzy. Auto-aceita top candidato se score >= 0.6 E diferenca pra top2
   * >= 0.2 OU se top2 nem existe. Senao marca como ambiguidade.
   *
   * Veículo: se nao passar, usa veiculoDefault. Data: se nao passar ou for
   * "hoje"/"ontem", interpreta. Obra: se nao passar mas carga+descarga
   * resolverem, tenta inferir pelo trajeto.
   *
   * Retorna {resolvido: true, ids, nomesCanonicos} OU
   * {resolvido: false, ambiguidades: [{campo, candidatos, mensagem}], faltando: [...]}.
   */
  async resolverViagemPorNomes(
    motoristaId: string,
    input: {
      veiculo?: string;
      obra?: string;
      material?: string;
      carga?: string;
      descarga?: string;
      data?: string;
    },
    sessaoId?: string,
  ): Promise<
    | {
        resolvido: true;
        ids: {
          veiculoId: string;
          obraId: string;
          materialId: string;
          localCargaId: string;
          localDescargaId: string;
          data: Date;
        };
        nomesCanonicos: {
          veiculo: string;
          obra: string;
          material: string;
          carga: string;
          descarga: string;
          dataLegivel: string;
        };
        notas: string[];
      }
    | {
        resolvido: false;
        ambiguidades: Array<{
          campo: string;
          mensagem: string;
          candidatos: Array<{ nome: string; motivo: string[] }>;
        }>;
        faltando: string[];
      }
  > {
    const ambiguidades: Array<{
      campo: string;
      mensagem: string;
      candidatos: Array<{ nome: string; motivo: string[] }>;
    }> = [];
    const faltando: string[] = [];
    const notas: string[] = [];
    const ids: Partial<{
      veiculoId: string;
      obraId: string;
      materialId: string;
      localCargaId: string;
      localDescargaId: string;
    }> = {};
    const nomes: Partial<{
      veiculo: string;
      obra: string;
      material: string;
      carga: string;
      descarga: string;
    }> = {};

    // VEÍCULO
    if (input.veiculo) {
      const r = await this.resolverCampo("veiculo", input.veiculo, motoristaId, undefined, sessaoId, "veiculo");
      if (r.tipo === "ok") {
        ids.veiculoId = r.id;
        nomes.veiculo = r.nome;
      } else if (r.tipo === "ambiguo") {
        if (sessaoId) this.salvarPendencia(sessaoId, "veiculo", r.candidatos);
        ambiguidades.push({
          campo: "veiculo",
          mensagem: `Tem mais de uma placa parecida com "${input.veiculo}".`,
          candidatos: r.candidatos.map((c) => ({ nome: c.nome, motivo: c.motivo })),
        });
      } else {
        faltando.push("veiculo");
      }
    } else {
      const me = await this.me(motoristaId);
      if (me.veiculoDefault) {
        ids.veiculoId = me.veiculoDefault.id;
        nomes.veiculo = me.veiculoDefault.placa;
        notas.push(`veículo: usei seu padrão ${me.veiculoDefault.placa}`);
      } else {
        faltando.push("veiculo");
      }
    }

    // MATERIAL
    if (input.material) {
      const r = await this.resolverCampo("material", input.material, motoristaId, undefined, sessaoId, "material");
      if (r.tipo === "ok") {
        ids.materialId = r.id;
        nomes.material = r.nome;
      } else if (r.tipo === "ambiguo") {
        if (sessaoId) this.salvarPendencia(sessaoId, "material", r.candidatos);
        ambiguidades.push({
          campo: "material",
          mensagem: `Achei mais de um material que casa com "${input.material}".`,
          candidatos: r.candidatos.map((c) => ({ nome: c.nome, motivo: c.motivo })),
        });
      } else {
        // Sem match fuzzy — sugere top usados (motorista→empresa→catálogo)
        const top = await this.topUsadosRecentes(motoristaId, "material");
        if (top.length > 0) {
          if (sessaoId) this.salvarPendencia(sessaoId, "material", top.map((t) => ({ id: t.id, nome: t.nome })));
          ambiguidades.push({
            campo: "material",
            mensagem: motivoSugestao(input.material, "material", top[0].fonte),
            candidatos: top.map((t) => ({
              nome: t.nome,
              motivo: motivoCandidato(t.vezes, t.fonte),
            })),
          });
        } else {
          faltando.push("material");
        }
      }
    } else {
      faltando.push("material");
    }

    // CARGA
    if (input.carga) {
      const r = await this.resolverCampo("local", input.carga, motoristaId, undefined, sessaoId, "carga");
      if (r.tipo === "ok") {
        ids.localCargaId = r.id;
        nomes.carga = r.nome;
      } else if (r.tipo === "ambiguo") {
        if (sessaoId) this.salvarPendencia(sessaoId, "carga", r.candidatos);
        ambiguidades.push({
          campo: "carga",
          mensagem: `Tem mais de um local de carga parecido com "${input.carga}".`,
          candidatos: r.candidatos.map((c) => ({ nome: c.nome, motivo: c.motivo })),
        });
      } else {
        const top = await this.topUsadosRecentes(motoristaId, "carga");
        if (top.length > 0) {
          if (sessaoId) this.salvarPendencia(sessaoId, "carga", top.map((t) => ({ id: t.id, nome: t.nome })));
          ambiguidades.push({
            campo: "carga",
            mensagem: motivoSugestao(input.carga, "local de carga", top[0].fonte),
            candidatos: top.map((t) => ({
              nome: t.nome,
              motivo: motivoCandidato(t.vezes, t.fonte),
            })),
          });
        } else {
          faltando.push("carga");
        }
      }
    } else {
      faltando.push("carga");
    }

    // DESCARGA (com âncora na carga, se resolvida)
    if (input.descarga) {
      const r = await this.resolverCampo(
        "local",
        input.descarga,
        motoristaId,
        ids.localCargaId,
        sessaoId,
        "descarga",
      );
      if (r.tipo === "ok") {
        ids.localDescargaId = r.id;
        nomes.descarga = r.nome;
      } else if (r.tipo === "ambiguo") {
        if (sessaoId) this.salvarPendencia(sessaoId, "descarga", r.candidatos);
        ambiguidades.push({
          campo: "descarga",
          mensagem: `Tem mais de um local de descarga parecido com "${input.descarga}".`,
          candidatos: r.candidatos.map((c) => ({ nome: c.nome, motivo: c.motivo })),
        });
      } else {
        const top = await this.topUsadosRecentes(motoristaId, "descarga");
        if (top.length > 0) {
          if (sessaoId) this.salvarPendencia(sessaoId, "descarga", top.map((t) => ({ id: t.id, nome: t.nome })));
          ambiguidades.push({
            campo: "descarga",
            mensagem: motivoSugestao(input.descarga, "local de descarga", top[0].fonte),
            candidatos: top.map((t) => ({
              nome: t.nome,
              motivo: motivoCandidato(t.vezes, t.fonte),
            })),
          });
        } else {
          faltando.push("descarga");
        }
      }
    } else {
      faltando.push("descarga");
    }

    // OBRA — se nao veio mas carga+descarga resolveram, tenta inferir trajeto
    if (input.obra) {
      const r = await this.resolverCampo("obra", input.obra, motoristaId, undefined, sessaoId, "obra");
      if (r.tipo === "ok") {
        ids.obraId = r.id;
        nomes.obra = r.nome;
      } else if (r.tipo === "ambiguo") {
        if (sessaoId) this.salvarPendencia(sessaoId, "obra", r.candidatos);
        ambiguidades.push({
          campo: "obra",
          mensagem: `Achei mais de uma obra parecida com "${input.obra}".`,
          candidatos: r.candidatos.map((c) => ({ nome: c.nome, motivo: c.motivo })),
        });
      } else {
        const top = await this.topUsadosRecentes(motoristaId, "obra");
        if (top.length > 0) {
          if (sessaoId) this.salvarPendencia(sessaoId, "obra", top.map((t) => ({ id: t.id, nome: t.nome })));
          ambiguidades.push({
            campo: "obra",
            mensagem: motivoSugestao(input.obra, "obra", top[0].fonte),
            candidatos: top.map((t) => ({
              nome: t.nome,
              motivo: motivoCandidato(t.vezes, t.fonte),
            })),
          });
        } else {
          faltando.push("obra");
        }
      }
    } else if (ids.localCargaId && ids.localDescargaId) {
      const inf = await this.inferirObraPorTrajeto(
        motoristaId,
        ids.localCargaId,
        ids.localDescargaId,
        ids.materialId,
      );
      if (inf.auto_selecionavel && inf.candidatos[0]) {
        ids.obraId = inf.candidatos[0].obraId;
        nomes.obra = inf.candidatos[0].nome;
        notas.push(`obra: deduzi pelo trajeto (${inf.candidatos[0].motivo.join(", ")})`);
      } else if (inf.candidatos.length > 0) {
        if (sessaoId) {
          this.salvarPendencia(
            sessaoId,
            "obra",
            inf.candidatos.slice(0, 3).map((c) => ({ id: c.obraId, nome: c.nome })),
          );
        }
        ambiguidades.push({
          campo: "obra",
          mensagem: "Esse trajeto já rodou pra mais de uma obra. Qual é?",
          candidatos: inf.candidatos.slice(0, 3).map((c) => ({
            nome: c.nome,
            motivo: c.motivo,
          })),
        });
      } else {
        faltando.push("obra");
      }
    } else {
      faltando.push("obra");
    }

    // DATA
    let data = new Date();
    if (input.data) {
      const lower = input.data.toLowerCase().trim();
      if (lower === "hoje" || lower === "agora") {
        // já é now
      } else if (lower === "ontem") {
        data.setDate(data.getDate() - 1);
      } else {
        const parsed = new Date(input.data);
        if (!isNaN(parsed.getTime())) data = parsed;
      }
    }

    if (ambiguidades.length > 0 || faltando.length > 0) {
      return { resolvido: false, ambiguidades, faltando };
    }

    return {
      resolvido: true,
      ids: {
        veiculoId: ids.veiculoId!,
        obraId: ids.obraId!,
        materialId: ids.materialId!,
        localCargaId: ids.localCargaId!,
        localDescargaId: ids.localDescargaId!,
        data,
      },
      nomesCanonicos: {
        veiculo: nomes.veiculo!,
        obra: nomes.obra!,
        material: nomes.material!,
        carga: nomes.carga!,
        descarga: nomes.descarga!,
        dataLegivel: data.toISOString().slice(0, 10),
      },
      notas,
    };
  }

  private async resolverCampo(
    tipo: CatalogoTipo,
    valor: string,
    motoristaId: string,
    ancora?: string,
    sessaoId?: string,
    campoLogico?: CampoViagem,
  ): Promise<
    | { tipo: "ok"; id: string; nome: string }
    | { tipo: "ambiguo"; candidatos: Array<{ id: string; nome: string; motivo: string[] }> }
    | { tipo: "vazio" }
  > {
    // UUID direto (string com 36 chars formato UUID): aceita sem buscar.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor.trim())) {
      const id = valor.trim();
      const nome = await this.lookupNomeById(tipo, id);
      if (nome) return { tipo: "ok", id, nome };
      return { tipo: "vazio" };
    }

    // Cache de pendências: se a sessão já viu esse nome ser oferecido como
    // opção pra esse campo, usa direto. Mata o loop "perguntou-respondeu-
    // ressurgiu". Vide salvarPendencia em resolverViagemPorNomes.
    if (sessaoId && campoLogico) {
      const cached = this.buscarPendencia(sessaoId, campoLogico, valor);
      if (cached) {
        return { tipo: "ok", id: cached.id, nome: cached.nome };
      }
    }

    const matchesRaw = await this.buscarCatalogo(motoristaId, tipo, valor, ancora);
    if (matchesRaw.length === 0) return { tipo: "vazio" };

    // Reordena: match textual quase-exato (>=0.95) sobe pra topo absoluto
    // mesmo que outros tenham score combinado maior por uso/recência.
    // Caso real: motorista digita "Casa" (existe local "Casa" — texto 1.0)
    // mas o backend tinha "Castro" com texto 0.33 + uso alto vencendo.
    const matches = [...matchesRaw].sort((a, b) => {
      const aExato = a.simTextual >= 0.95 ? 1 : 0;
      const bExato = b.simTextual >= 0.95 ? 1 : 0;
      if (aExato !== bExato) return bExato - aExato;
      return b.score - a.score;
    });

    const top = matches[0];
    const segundo = matches[1];

    // Match textual quase-exato: vence sempre, sem ambiguidade.
    if (top.simTextual >= 0.95) {
      return { tipo: "ok", id: top.id, nome: top.nome };
    }

    // Top forte textualmente E sem competidor textual decente: ok direto.
    if (top.simTextual >= 0.7 && (!segundo || segundo.simTextual < 0.5)) {
      return { tipo: "ok", id: top.id, nome: top.nome };
    }

    // Auto-aceita se top combinado é forte E significativamente melhor.
    const margem = segundo ? top.score - segundo.score : Infinity;
    if (top.score >= 0.6 && margem >= 0.3) {
      return { tipo: "ok", id: top.id, nome: top.nome };
    }
    if (matches.length === 1 && top.score >= 0.5) {
      return { tipo: "ok", id: top.id, nome: top.nome };
    }

    // Ambíguo — devolve até 3, FILTRANDO candidatos com sim textual fraco
    // (< 0.4) que aparecem só por uso. Castro (sim 0.33) pra "Casa" não
    // deveria virar opção que confunde o motorista.
    const candidatosFiltrados = matches.filter((m) => m.simTextual >= 0.4);
    const finais = candidatosFiltrados.length > 0 ? candidatosFiltrados : matches;
    return {
      tipo: "ambiguo",
      candidatos: finais.slice(0, 3).map((m) => ({
        id: m.id,
        nome: m.nome,
        motivo: m.motivo,
      })),
    };
  }

  /**
   * Locais cadastrados perto de uma coordenada GPS, ordenados por distância.
   * Usado quando o motorista compartilha localização pelo WhatsApp — agente
   * acha o local mais próximo (carga/descarga/qualquer) sem precisar adivinhar.
   *
   * Bonus: marca quantas vezes o próprio motorista já usou cada local nos
   * últimos 90d (pra agente priorizar familiares).
   */
  async locaisMaisProximos(
    motoristaId: string,
    lat: number,
    lng: number,
    tipoUso: "carga" | "descarga" | "ambos" = "ambos",
    raioMetros = 500,
    limit = 5,
  ): Promise<Array<{
    id: string;
    nome: string;
    cidade: string;
    uf: string;
    distanciaMetros: number;
    tipoLocal: string;
    vezesUsadoMotorista: number;
  }>> {
    type Row = {
      id: string;
      nome: string;
      cidade: string;
      uf: string;
      distanciaMetros: number;
      tipoLocal: string;
      vezesUsadoMotorista: bigint;
    };
    const raioKm = raioMetros / 1000;
    // Filtro de tipo: "ambos" pega CARGA, DESCARGA e AMBOS; "carga" pega CARGA+AMBOS; etc
    const tiposPermitidos =
      tipoUso === "carga"
        ? Prisma.sql`('CARGA','AMBOS')`
        : tipoUso === "descarga"
          ? Prisma.sql`('DESCARGA','AMBOS')`
          : Prisma.sql`('CARGA','DESCARGA','AMBOS')`;

    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH hist AS (
        SELECT local_id, COUNT(*)::bigint AS n FROM (
          SELECT "localCargaId" AS local_id FROM viagens
            WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '90 days'
          UNION ALL
          SELECT "localDescargaId" AS local_id FROM viagens
            WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '90 days'
        ) t GROUP BY local_id
      )
      SELECT
        l.id, l.nome, l.cidade, l.uf,
        l.tipo::text AS "tipoLocal",
        ROUND(earth_distance(ll_to_earth(${lat}, ${lng}), ll_to_earth(l.lat, l.lng))) AS "distanciaMetros",
        COALESCE(h.n, 0) AS "vezesUsadoMotorista"
      FROM locais l
      LEFT JOIN hist h ON h.local_id = l.id
      WHERE l.ativo = true
        AND l.lat IS NOT NULL AND l.lng IS NOT NULL
        AND l.tipo::text IN ${tiposPermitidos}
        AND earth_distance(ll_to_earth(${lat}, ${lng}), ll_to_earth(l.lat, l.lng)) <= ${raioKm * 1000}
      ORDER BY
        earth_distance(ll_to_earth(${lat}, ${lng}), ll_to_earth(l.lat, l.lng)) ASC,
        COALESCE(h.n, 0) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      cidade: r.cidade,
      uf: r.uf,
      distanciaMetros: Number(r.distanciaMetros),
      tipoLocal: r.tipoLocal,
      vezesUsadoMotorista: Number(r.vezesUsadoMotorista),
    }));
  }

  /**
   * Top N nomes mais usados como sugestão quando o fuzzy não acha match.
   * Tenta primeiro do próprio motorista (90d). Se ele não tem histórico,
   * cai pro top global da empresa (180d). Se a empresa também não tem,
   * pega top do catálogo (alfabético). SEMPRE retorna algo se houver
   * registros — o agente nunca fica sem opções pra mostrar.
   */
  private async topUsadosRecentes(
    motoristaId: string,
    tipo: "material" | "obra" | "carga" | "descarga",
    limit = 3,
  ): Promise<Array<{ id: string; nome: string; vezes: number; fonte: "motorista" | "empresa" | "catalogo" }>> {
    type Row = { id: string; nome: string; vezes: bigint };

    const queryUso = async (
      filtroMotorista: boolean,
      diasJanela: number,
    ): Promise<Row[]> => {
      const desde = new Date();
      desde.setDate(desde.getDate() - diasJanela);
      const motoristaFilter = filtroMotorista ? motoristaId : null;
      if (tipo === "material") {
        return this.prisma.$queryRaw<Row[]>`
          SELECT mat.id, mat.nome, COUNT(*)::bigint AS vezes
          FROM viagens v JOIN materiais mat ON mat.id = v."materialId"
          WHERE (${motoristaFilter}::text IS NULL OR v."motoristaId" = ${motoristaFilter})
            AND v.data >= ${desde}
            AND mat.ativo = true
          GROUP BY mat.id, mat.nome
          ORDER BY COUNT(*) DESC, MAX(v.data) DESC
          LIMIT ${limit}
        `;
      }
      if (tipo === "obra") {
        return this.prisma.$queryRaw<Row[]>`
          SELECT o.id, o.nome, COUNT(*)::bigint AS vezes
          FROM viagens v JOIN obras o ON o.id = v."obraId"
          WHERE (${motoristaFilter}::text IS NULL OR v."motoristaId" = ${motoristaFilter})
            AND v.data >= ${desde}
            AND o.ativa = true
          GROUP BY o.id, o.nome
          ORDER BY COUNT(*) DESC, MAX(v.data) DESC
          LIMIT ${limit}
        `;
      }
      const colunaLocal = tipo === "carga" ? `"localCargaId"` : `"localDescargaId"`;
      // Prisma.sql precisa pra coluna dinâmica
      const sql = Prisma.sql`
        SELECT l.id, l.nome, COUNT(*)::bigint AS vezes
        FROM viagens v JOIN locais l ON l.id = v.${Prisma.raw(colunaLocal)}
        WHERE (${motoristaFilter}::text IS NULL OR v."motoristaId" = ${motoristaFilter})
          AND v.data >= ${desde}
          AND l.ativo = true
        GROUP BY l.id, l.nome
        ORDER BY COUNT(*) DESC, MAX(v.data) DESC
        LIMIT ${limit}
      `;
      return this.prisma.$queryRaw<Row[]>(sql);
    };

    // 1. tenta do motorista (90d)
    let rows = await queryUso(true, 90);
    let fonte: "motorista" | "empresa" | "catalogo" = "motorista";

    // 2. fallback: empresa toda (180d)
    if (rows.length === 0) {
      rows = await queryUso(false, 180);
      fonte = "empresa";
    }

    // 3. último recurso: top do catálogo (alfabético) — só pra material/obra
    //    onde o universo é fechado. Locais cadastrados podem ser dezenas de
    //    milhares — não vale a pena listar aleatoriamente.
    if (rows.length === 0 && (tipo === "material" || tipo === "obra")) {
      if (tipo === "material") {
        const cat = await this.prisma.material.findMany({
          where: { ativo: true },
          select: { id: true, nome: true },
          orderBy: { nome: "asc" },
          take: limit,
        });
        rows = cat.map((c) => ({ id: c.id, nome: c.nome, vezes: BigInt(0) }));
      } else {
        const cat = await this.prisma.obra.findMany({
          where: { ativa: true },
          select: { id: true, nome: true },
          orderBy: { nome: "asc" },
          take: limit,
        });
        rows = cat.map((c) => ({ id: c.id, nome: c.nome, vezes: BigInt(0) }));
      }
      fonte = "catalogo";
    }

    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      vezes: Number(r.vezes),
      fonte,
    }));
  }

  private async lookupNomeById(tipo: CatalogoTipo, id: string): Promise<string | null> {
    if (tipo === "obra") {
      const r = await this.prisma.obra.findUnique({ where: { id }, select: { nome: true } });
      return r?.nome ?? null;
    }
    if (tipo === "material") {
      const r = await this.prisma.material.findUnique({ where: { id }, select: { nome: true } });
      return r?.nome ?? null;
    }
    if (tipo === "local") {
      const r = await this.prisma.local.findUnique({ where: { id }, select: { nome: true } });
      return r?.nome ?? null;
    }
    if (tipo === "veiculo") {
      const r = await this.prisma.veiculo.findUnique({ where: { id }, select: { placa: true } });
      return r?.placa ?? null;
    }
    return null;
  }

  async catalogos(motoristaId: string) {
    // Motorista vê só as placas vinculadas a ele (relação N:N).
    // Se não tem nenhuma vinculada, mostra a frota inteira como fallback
    // (motorista escolhe e admin completa o vínculo depois).
    const vinculos = await this.prisma.motoristaVeiculo.findMany({
      where: { motoristaId },
      select: { veiculoId: true },
    });
    const vinculadosIds = vinculos.map((v) => v.veiculoId);
    const veiculosWhere =
      vinculadosIds.length > 0
        ? { ativo: true, id: { in: vinculadosIds } }
        : { ativo: true };

    const [veiculos, materiais, obras, locais] = await Promise.all([
      this.prisma.veiculo.findMany({
        where: veiculosWhere,
        select: { id: true, placa: true, modelo: true },
        orderBy: { placa: "asc" },
      }),
      this.prisma.material.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
      this.prisma.obra.findMany({
        where: { ativa: true },
        select: {
          id: true,
          nome: true,
          empresaCliente: { select: { id: true, nome: true } },
        },
        orderBy: { nome: "asc" },
      }),
      this.prisma.local.findMany({
        where: { ativo: true },
        select: {
          id: true,
          nome: true,
          logradouro: true,
          numero: true,
          bairro: true,
          cidade: true,
          uf: true,
          pontoReferencia: true,
          tipo: true,
          obraId: true,
          lat: true,
          lng: true,
        },
        orderBy: { nome: "asc" },
      }),
    ]);
    return { veiculos, materiais, obras, locais };
  }

  /**
   * Busca fuzzy ranqueada por catálogos. Usada pela IA do WhatsApp pra
   * resolver referências naturais ("pedrera souza" → localId) tolerantes a
   * typo, acento, abreviação e apelido.
   *
   * Ranking combina:
   *  - similaridade textual (pg_trgm sobre nome + logradouro + bairro + apelidos)
   *  - histórico de uso do motorista (60d, cap em 20)
   *  - recência (boost até +0.3 se usou hoje)
   *  - proximidade geográfica (boost até +0.4 se passar ancoraLocalId)
   *
   * Retorna até 8 candidatos com `score` e `motivo[]` legível pra IA
   * justificar a escolha pro motorista em PT-BR.
   */
  async buscarCatalogo(
    motoristaId: string,
    tipo: CatalogoTipo,
    q: string,
    ancoraLocalId?: string,
  ): Promise<CatalogoMatch[]> {
    const termo = q.trim();
    if (!termo) return [];
    if (tipo === "local") return this.buscarLocal(motoristaId, termo, ancoraLocalId);
    if (tipo === "material") return this.buscarMaterial(motoristaId, termo);
    if (tipo === "obra") return this.buscarObra(motoristaId, termo);
    if (tipo === "veiculo") return this.buscarVeiculo(motoristaId, termo);
    return [];
  }

  /**
   * Locais que esse motorista mais usou recentemente (carga, descarga ou
   * ambos). Atalho pra "lança igual ontem" / "mesma de sempre" — IA chama
   * isso ANTES de buscar_catalogo quando o motorista é vago.
   */
  async locaisRecentes(
    motoristaId: string,
    tipoUso: "carga" | "descarga" | "ambos" = "ambos",
    dias = 30,
  ) {
    type Row = {
      id: string;
      nome: string;
      cidade: string;
      uf: string;
      tipo: string;
      vezesUsado: bigint;
      ultimaUsoEm: Date;
      comoCarga: bigint;
      comoDescarga: bigint;
    };
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const inclCarga = tipoUso !== "descarga";
    const inclDescarga = tipoUso !== "carga";
    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH usos AS (
        SELECT "localCargaId" AS local_id, data, 'carga'::text AS papel
        FROM viagens
        WHERE "motoristaId" = ${motoristaId}
          AND data >= ${desde}
          AND ${inclCarga}
        UNION ALL
        SELECT "localDescargaId" AS local_id, data, 'descarga'::text AS papel
        FROM viagens
        WHERE "motoristaId" = ${motoristaId}
          AND data >= ${desde}
          AND ${inclDescarga}
      ),
      agg AS (
        SELECT
          local_id,
          COUNT(*) AS vezes,
          MAX(data) AS ultima,
          COUNT(*) FILTER (WHERE papel = 'carga')    AS como_carga,
          COUNT(*) FILTER (WHERE papel = 'descarga') AS como_descarga
        FROM usos
        GROUP BY local_id
      )
      SELECT
        l.id, l.nome, l.cidade, l.uf, l.tipo::text AS tipo,
        a.vezes AS "vezesUsado", a.ultima AS "ultimaUsoEm",
        a.como_carga AS "comoCarga", a.como_descarga AS "comoDescarga"
      FROM agg a
      JOIN locais l ON l.id = a.local_id
      WHERE l.ativo = true
      ORDER BY a.vezes DESC, a.ultima DESC
      LIMIT 10
    `;
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      cidade: r.cidade,
      uf: r.uf,
      tipo: r.tipo,
      vezesUsado: Number(r.vezesUsado),
      comoCarga: Number(r.comoCarga),
      comoDescarga: Number(r.comoDescarga),
      ultimaUsoEm: r.ultimaUsoEm,
    }));
  }

  /**
   * Infere candidatos a obra a partir do par (localCargaId, localDescargaId)
   * olhando o histórico de viagens da empresa toda nos últimos 180d. Usado
   * pelo agente do WhatsApp pra economizar uma pergunta quando o motorista
   * descreve uma viagem sem citar a obra.
   *
   * Escopo: empresa inteira (mais sinal); bonus pra viagens do próprio
   * motorista no score.
   *
   * `auto_selecionavel = true` ⇒ 1 obra única + ≥2 viagens + última ≤90d.
   * Threshold médio: erra menos do que "1 viagem é suficiente", mas ainda
   * dispensa pergunta nas rotas com qualquer recorrência.
   */
  async inferirObraPorTrajeto(
    motoristaId: string,
    localCargaId: string,
    localDescargaId: string,
    materialId?: string,
  ): Promise<{
    total: number;
    auto_selecionavel: boolean;
    janela_dias: number;
    candidatos: Array<{
      obraId: string;
      nome: string;
      empresa: string | null;
      vezesUsado: number;
      vezesPorEsteMotorista: number;
      ultimaData: string;
      diasAtras: number;
      score: number;
      motivo: string[];
    }>;
  }> {
    const JANELA_DIAS = 180;
    const desde = new Date();
    desde.setDate(desde.getDate() - JANELA_DIAS);

    type Row = {
      obraId: string;
      nome: string;
      empresaNome: string | null;
      vezes: bigint;
      vezesMotorista: bigint;
      vezesMaterial: bigint;
      ultima: Date;
    };

    const matId = materialId ?? null;

    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH viagens_trajeto AS (
        SELECT v."obraId", v."motoristaId", v."materialId", v.data
        FROM viagens v
        WHERE v."localCargaId"    = ${localCargaId}
          AND v."localDescargaId" = ${localDescargaId}
          AND v.data >= ${desde}
      ),
      agg AS (
        SELECT
          "obraId",
          COUNT(*)                                              AS vezes,
          COUNT(*) FILTER (WHERE "motoristaId" = ${motoristaId}) AS vezes_motorista,
          COUNT(*) FILTER (WHERE ${matId}::text IS NOT NULL
                             AND "materialId" = ${matId})        AS vezes_material,
          MAX(data)                                             AS ultima
        FROM viagens_trajeto
        GROUP BY "obraId"
      )
      SELECT
        o.id            AS "obraId",
        o.nome          AS nome,
        ec.nome         AS "empresaNome",
        a.vezes         AS vezes,
        a.vezes_motorista AS "vezesMotorista",
        a.vezes_material  AS "vezesMaterial",
        a.ultima        AS ultima
      FROM agg a
      JOIN obras o            ON o.id = a."obraId"
      LEFT JOIN empresas_cliente ec ON ec.id = o."empresaClienteId"
      WHERE o.ativa = true
      ORDER BY a.vezes DESC, a.ultima DESC
      LIMIT 5
    `;

    const candidatos = rows.map((r) => {
      const vezes = Number(r.vezes);
      const vezesMot = Number(r.vezesMotorista);
      const vezesMat = Number(r.vezesMaterial);
      const diasAtras = Math.floor(
        (Date.now() - r.ultima.getTime()) / (1000 * 60 * 60 * 24),
      );
      return {
        obraId: r.obraId,
        nome: r.nome,
        empresa: r.empresaNome,
        vezesUsado: vezes,
        vezesPorEsteMotorista: vezesMot,
        ultimaData: r.ultima.toISOString().slice(0, 10),
        diasAtras,
        score: scoreInferenciaObra(vezes, vezesMot, vezesMat, diasAtras),
        motivo: motivoInferenciaObra(vezes, vezesMot, vezesMat, diasAtras),
      };
    });

    const autoSelecionavel =
      candidatos.length === 1 &&
      candidatos[0].vezesUsado >= 2 &&
      candidatos[0].diasAtras <= 90;

    return {
      total: candidatos.length,
      auto_selecionavel: autoSelecionavel,
      janela_dias: JANELA_DIAS,
      candidatos,
    };
  }

  // ===== Implementação por tipo =====

  private async buscarLocal(
    motoristaId: string,
    termo: string,
    ancoraLocalId?: string,
  ): Promise<CatalogoMatch[]> {
    type Row = {
      id: string;
      nome: string;
      tipo: string;
      logradouro: string | null;
      cidade: string;
      uf: string;
      simScore: number;
      nUso: bigint;
      ultimaUso: Date | null;
      distanciaKm: number | null;
    };
    const ancoraId = ancoraLocalId ?? null;
    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH sim AS (
        SELECT l.id, GREATEST(
          similarity(f_normalizar(l.nome),                       f_normalizar(${termo})),
          similarity(f_normalizar(coalesce(l.logradouro,'')),    f_normalizar(${termo})) * 0.7,
          similarity(f_normalizar(coalesce(l.bairro,'')),        f_normalizar(${termo})) * 0.6,
          similarity(f_normalizar_array(l.apelidos),             f_normalizar(${termo})) * 1.1
        ) AS sim_score
        FROM locais l
        WHERE l.ativo = true
          AND (
               f_normalizar(l.nome)                    % f_normalizar(${termo})
            OR f_normalizar(coalesce(l.logradouro,'')) % f_normalizar(${termo})
            OR f_normalizar(coalesce(l.bairro,''))     % f_normalizar(${termo})
            OR f_normalizar_array(l.apelidos)          % f_normalizar(${termo})
          )
      ),
      hist AS (
        SELECT local_id, COUNT(*) AS n_uso, MAX(data) AS ultima FROM (
          SELECT "localCargaId" AS local_id, data FROM viagens
            WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '60 days'
          UNION ALL
          SELECT "localDescargaId" AS local_id, data FROM viagens
            WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '60 days'
        ) t GROUP BY local_id
      ),
      ancora AS ( SELECT lat AS alat, lng AS alng FROM locais WHERE id = ${ancoraId} )
      SELECT
        l.id, l.nome, l.tipo::text AS tipo, l.logradouro, l.cidade, l.uf,
        s.sim_score AS "simScore",
        coalesce(h.n_uso, 0) AS "nUso",
        h.ultima             AS "ultimaUso",
        CASE
          WHEN a.alat IS NOT NULL AND l.lat IS NOT NULL
          THEN earth_distance(ll_to_earth(a.alat, a.alng), ll_to_earth(l.lat, l.lng)) / 1000.0
          ELSE NULL
        END AS "distanciaKm"
      FROM sim s
      JOIN locais l ON l.id = s.id
      LEFT JOIN hist h ON h.local_id = l.id
      LEFT JOIN ancora a ON true
      ORDER BY (
        s.sim_score * 1.00
        + LEAST(coalesce(h.n_uso,0), 20) * 0.04
        + CASE
            WHEN h.ultima IS NULL THEN 0
            ELSE GREATEST(0, 0.30 - EXTRACT(epoch FROM (now() - h.ultima)) / 86400 / 60 * 0.30)
          END
        + CASE
            WHEN a.alat IS NULL OR l.lat IS NULL THEN 0
            WHEN earth_distance(ll_to_earth(a.alat, a.alng), ll_to_earth(l.lat, l.lng)) / 1000.0 < 1  THEN 0.40
            WHEN earth_distance(ll_to_earth(a.alat, a.alng), ll_to_earth(l.lat, l.lng)) / 1000.0 < 5  THEN 0.25
            WHEN earth_distance(ll_to_earth(a.alat, a.alng), ll_to_earth(l.lat, l.lng)) / 1000.0 < 20 THEN 0.10
            ELSE 0
          END
      ) DESC
      LIMIT 8
    `;
    return rows.map((r) => {
      const nUso = Number(r.nUso);
      const scoreFinal = scoreLocal(r.simScore, nUso, r.ultimaUso, r.distanciaKm);
      return {
        id: r.id,
        nome: r.nome,
        score: scoreFinal,
        simTextual: r.simScore,
        motivo: motivoLocal(r.simScore, nUso, r.ultimaUso, r.distanciaKm),
        extras: {
          tipo: r.tipo,
          logradouro: r.logradouro,
          cidade: r.cidade,
          uf: r.uf,
        },
      };
    });
  }

  private async buscarMaterial(motoristaId: string, termo: string): Promise<CatalogoMatch[]> {
    type Row = {
      id: string;
      nome: string;
      simScore: number;
      nUso: bigint;
      ultimaUso: Date | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH sim AS (
        SELECT m.id, GREATEST(
          similarity(f_normalizar(m.nome),               f_normalizar(${termo})),
          similarity(f_normalizar_array(m.apelidos),     f_normalizar(${termo})) * 1.1
        ) AS sim_score
        FROM materiais m
        WHERE m.ativo = true
          AND ( f_normalizar(m.nome) % f_normalizar(${termo})
             OR f_normalizar_array(m.apelidos) % f_normalizar(${termo}) )
      ),
      hist AS (
        SELECT "materialId" AS material_id, COUNT(*) AS n_uso, MAX(data) AS ultima
        FROM viagens
        WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '60 days'
        GROUP BY "materialId"
      )
      SELECT m.id, m.nome,
        s.sim_score          AS "simScore",
        coalesce(h.n_uso, 0) AS "nUso",
        h.ultima             AS "ultimaUso"
      FROM sim s
      JOIN materiais m ON m.id = s.id
      LEFT JOIN hist h ON h.material_id = m.id
      ORDER BY (
        s.sim_score * 1.00
        + LEAST(coalesce(h.n_uso,0), 20) * 0.04
        + CASE
            WHEN h.ultima IS NULL THEN 0
            ELSE GREATEST(0, 0.30 - EXTRACT(epoch FROM (now() - h.ultima)) / 86400 / 60 * 0.30)
          END
      ) DESC
      LIMIT 8
    `;
    return rows.map((r) => {
      const nUso = Number(r.nUso);
      return {
        id: r.id,
        nome: r.nome,
        score: scoreSimples(r.simScore, nUso, r.ultimaUso),
        simTextual: r.simScore,
        motivo: motivoSimples(r.simScore, nUso, r.ultimaUso),
      };
    });
  }

  private async buscarObra(motoristaId: string, termo: string): Promise<CatalogoMatch[]> {
    type Row = {
      id: string;
      nome: string;
      empresaNome: string | null;
      simScore: number;
      nUso: bigint;
      ultimaUso: Date | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH sim AS (
        SELECT o.id, GREATEST(
          similarity(f_normalizar(o.nome),               f_normalizar(${termo})),
          similarity(f_normalizar_array(o.apelidos),     f_normalizar(${termo})) * 1.1
        ) AS sim_score
        FROM obras o
        WHERE o.ativa = true
          AND ( f_normalizar(o.nome) % f_normalizar(${termo})
             OR f_normalizar_array(o.apelidos) % f_normalizar(${termo}) )
      ),
      hist AS (
        SELECT "obraId" AS obra_id, COUNT(*) AS n_uso, MAX(data) AS ultima
        FROM viagens
        WHERE "motoristaId" = ${motoristaId} AND data >= now() - interval '60 days'
        GROUP BY "obraId"
      )
      SELECT o.id, o.nome,
        ec.nome              AS "empresaNome",
        s.sim_score          AS "simScore",
        coalesce(h.n_uso, 0) AS "nUso",
        h.ultima             AS "ultimaUso"
      FROM sim s
      JOIN obras o ON o.id = s.id
      LEFT JOIN empresas_cliente ec ON ec.id = o."empresaClienteId"
      LEFT JOIN hist h ON h.obra_id = o.id
      ORDER BY (
        s.sim_score * 1.00
        + LEAST(coalesce(h.n_uso,0), 20) * 0.04
        + CASE
            WHEN h.ultima IS NULL THEN 0
            ELSE GREATEST(0, 0.30 - EXTRACT(epoch FROM (now() - h.ultima)) / 86400 / 60 * 0.30)
          END
      ) DESC
      LIMIT 8
    `;
    return rows.map((r) => {
      const nUso = Number(r.nUso);
      return {
        id: r.id,
        nome: r.nome,
        score: scoreSimples(r.simScore, nUso, r.ultimaUso),
        simTextual: r.simScore,
        motivo: motivoSimples(r.simScore, nUso, r.ultimaUso),
        extras: { empresa: r.empresaNome },
      };
    });
  }

  private async buscarVeiculo(motoristaId: string, termo: string): Promise<CatalogoMatch[]> {
    // Universo de veículos é pequeno e filtrado pelo vínculo do motorista —
    // mantém ILIKE simples + similarity como tiebreaker.
    type Row = {
      id: string;
      placa: string;
      modelo: string | null;
      simScore: number;
    };
    const vinculos = await this.prisma.motoristaVeiculo.findMany({
      where: { motoristaId },
      select: { veiculoId: true },
    });
    const vinculadosIds = vinculos.map((v) => v.veiculoId);
    const filtroVinculo = vinculadosIds.length > 0
      ? Prisma.sql`AND v.id IN (${Prisma.join(vinculadosIds)})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT v.id, v.placa, v.modelo,
        GREATEST(
          similarity(f_normalizar(v.placa),                  f_normalizar(${termo})),
          similarity(f_normalizar(coalesce(v.modelo,'')),    f_normalizar(${termo})) * 0.6
        ) AS "simScore"
      FROM veiculos v
      WHERE v.ativo = true
        ${filtroVinculo}
        AND (
             f_normalizar(v.placa) % f_normalizar(${termo})
          OR f_normalizar(coalesce(v.modelo,'')) % f_normalizar(${termo})
        )
      ORDER BY "simScore" DESC
      LIMIT 8
    `;
    return rows.map((r) => ({
      id: r.id,
      nome: r.placa,
      score: r.simScore,
      simTextual: r.simScore,
      motivo: [`texto≈${Math.round(r.simScore * 100)}%`],
      extras: { placa: r.placa, modelo: r.modelo },
    }));
  }
}

// ===== Helpers de score/motivo =====

function scoreLocal(
  sim: number,
  nUso: number,
  ultima: Date | null,
  distanciaKm: number | null,
): number {
  return (
    sim * 1.0 +
    Math.min(nUso, 20) * 0.04 +
    bonusRecencia(ultima) +
    bonusProximidade(distanciaKm)
  );
}

function scoreSimples(sim: number, nUso: number, ultima: Date | null): number {
  return sim * 1.0 + Math.min(nUso, 20) * 0.04 + bonusRecencia(ultima);
}

function bonusRecencia(ultima: Date | null): number {
  if (!ultima) return 0;
  const diasAtras = (Date.now() - ultima.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 0.3 - (diasAtras / 60) * 0.3);
}

function bonusProximidade(distanciaKm: number | null): number {
  if (distanciaKm == null) return 0;
  if (distanciaKm < 1) return 0.4;
  if (distanciaKm < 5) return 0.25;
  if (distanciaKm < 20) return 0.1;
  return 0;
}

function motivoLocal(
  sim: number,
  nUso: number,
  ultima: Date | null,
  distanciaKm: number | null,
): string[] {
  const out: string[] = [`texto≈${Math.round(sim * 100)}%`];
  if (nUso > 0) out.push(`usado ${nUso}x últimos 60d`);
  if (ultima) {
    const dias = Math.floor((Date.now() - ultima.getTime()) / (1000 * 60 * 60 * 24));
    out.push(dias === 0 ? "usado hoje" : `última uso há ${dias}d`);
  }
  if (distanciaKm != null) out.push(`≈ ${distanciaKm.toFixed(1)}km do âncora`);
  return out;
}

function motivoSimples(sim: number, nUso: number, ultima: Date | null): string[] {
  const out: string[] = [`texto≈${Math.round(sim * 100)}%`];
  if (nUso > 0) out.push(`usado ${nUso}x últimos 60d`);
  if (ultima) {
    const dias = Math.floor((Date.now() - ultima.getTime()) / (1000 * 60 * 60 * 24));
    out.push(dias === 0 ? "usado hoje" : `última uso há ${dias}d`);
  }
  return out;
}

function scoreInferenciaObra(
  vezes: number,
  vezesMotorista: number,
  vezesMaterial: number,
  diasAtras: number,
): number {
  const baseFreq = Math.min(vezes, 20) / 20;
  const bonusMotorista = Math.min(vezesMotorista, 5) * 0.05;
  const bonusMaterial = vezesMaterial > 0 ? 0.1 : 0;
  const bonusRecencia = Math.max(0, 0.3 - (diasAtras / 90) * 0.3);
  return baseFreq + bonusMotorista + bonusMaterial + bonusRecencia;
}

function motivoInferenciaObra(
  vezes: number,
  vezesMotorista: number,
  vezesMaterial: number,
  diasAtras: number,
): string[] {
  const out: string[] = [`trajeto: ${vezes}x últimos 180d`];
  if (vezesMotorista > 0) out.push(`você rodou ${vezesMotorista}x`);
  if (vezesMaterial > 0) out.push(`mesmo material ${vezesMaterial}x`);
  out.push(diasAtras === 0 ? "última hoje" : `última há ${diasAtras}d`);
  return out;
}

function motivoSugestao(
  digitado: string,
  tipoLegivel: string,
  fonte: "motorista" | "empresa" | "catalogo",
): string {
  if (fonte === "motorista") {
    return `Não conheço "${digitado}" como ${tipoLegivel}. Talvez seja um destes que você costuma rodar?`;
  }
  if (fonte === "empresa") {
    return `Não conheço "${digitado}" como ${tipoLegivel}. Talvez seja um destes (mais comuns aqui)?`;
  }
  return `Não conheço "${digitado}" como ${tipoLegivel}. Tem estes cadastrados — é algum?`;
}

function motivoCandidato(
  vezes: number,
  fonte: "motorista" | "empresa" | "catalogo",
): string[] {
  if (fonte === "motorista") return [`usado ${vezes}x últimos 90d`];
  if (fonte === "empresa") return [`usado ${vezes}x na empresa`];
  return ["cadastrado no sistema"];
}
