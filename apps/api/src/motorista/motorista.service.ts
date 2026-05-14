import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type CatalogoTipo = "material" | "obra" | "local" | "veiculo";

export type CatalogoMatch = {
  id: string;
  nome: string;
  score: number;
  motivo: string[];
  // campos extras por tipo (cidade/uf/tipo pra local, placa/modelo pra veiculo, etc)
  extras?: Record<string, unknown>;
};

@Injectable()
export class MotoristaService {
  constructor(private readonly prisma: PrismaService) {}

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
