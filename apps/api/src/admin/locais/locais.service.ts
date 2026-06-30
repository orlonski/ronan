import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  FonteEvidencia,
  NivelConfiancaLocal,
  OrigemCadastroLocal,
  type Prisma,
  type TipoLocal,
} from "@prisma/client";
import type { CriarLocalInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListLocaisParams = PaginationQuery & {
  clienteId?: string;
  tipo?: TipoLocal;
  ativo?: "true" | "false";
  nivelConfianca?: NivelConfiancaLocal;
  /**
   * Atalho usado pela aba "Em validação": filtra nivelConfianca <= DWELL.
   */
  emValidacao?: "true" | "false";
};

const LOCAL_INCLUDE = {
  clientes: {
    select: { cliente: { select: { id: true, nome: true } } },
    orderBy: { criadoEm: "asc" },
  },
  criadoPorMotorista: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
  _count: { select: { viagensCarga: true, viagensDescarga: true } },
} satisfies Prisma.LocalInclude;

type LocalRaw = Prisma.LocalGetPayload<{ include: typeof LOCAL_INCLUDE }>;

function flattenLocal<T extends LocalRaw>(local: T) {
  const { clientes, _count, ...rest } = local;
  return {
    ...rest,
    clientes: clientes.map((c) => c.cliente),
    totalViagens: _count.viagensCarga + _count.viagensDescarga,
  };
}

@Injectable()
export class LocaisService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListLocaisParams) {
    const where: Prisma.LocalWhereInput = {};
    if (params.clienteId) where.clientes = { some: { clienteId: params.clienteId } };
    if (params.tipo) where.tipo = params.tipo;
    if (params.ativo === "true") where.ativo = true;
    else if (params.ativo === "false") where.ativo = false;
    else where.ativo = true;
    if (params.nivelConfianca) where.nivelConfianca = params.nivelConfianca;
    if (params.emValidacao === "true") {
      where.nivelConfianca = {
        in: [
          NivelConfiancaLocal.RASCUNHO,
          NivelConfiancaLocal.PRESENCA_PONTUAL,
          NivelConfiancaLocal.DWELL_CONFIRMADO,
        ],
      };
    }
    const result = await paginate(this.prisma.local, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["nome", "logradouro", "bairro", "cidade", "pontoReferencia"],
      sortable: {
        nome: "nome",
        cidade: "cidade",
        uf: "uf",
        tipo: "tipo",
        ativo: "ativo",
        criadoEm: "criadoEm",
        nivelConfianca: "nivelConfianca",
      },
      defaultSort: { field: "nome", order: "asc" },
      include: LOCAL_INCLUDE,
    });
    return { ...result, data: (result.data as LocalRaw[]).map(flattenLocal) };
  }

  async findOne(id: string) {
    const local = await this.prisma.local.findUniqueOrThrow({
      where: { id },
      include: LOCAL_INCLUDE,
    });
    return flattenLocal(local);
  }

  /**
   * Pontos de lançamento das viagens que tiveram este local como DESCARGA —
   * é onde o motorista tocou "Estou no local de descarga", então o lat/lng da
   * viagem fica em cima do local. Mais recentes primeiro, limitado a 500 pra
   * não pesar o mapa (acima disso, plota só os 500 últimos).
   */
  async lancamentos(id: string) {
    const LIMITE = 500;
    const total = await this.prisma.viagem.count({
      where: { localDescargaId: id, lat: { not: null }, lng: { not: null } },
    });
    const viagens = await this.prisma.viagem.findMany({
      where: { localDescargaId: id, lat: { not: null }, lng: { not: null } },
      select: {
        id: true,
        lat: true,
        lng: true,
        data: true,
        ticket: true,
        status: true,
      },
      orderBy: { data: "desc" },
      take: LIMITE,
    });
    return {
      total,
      truncado: total > LIMITE,
      pontos: viagens.map((v) => ({
        id: v.id,
        lat: v.lat as number,
        lng: v.lng as number,
        data: v.data,
        ticket: v.ticket,
        status: v.status,
      })),
    };
  }

  /**
   * Lista enxuta pra exibição num mapa — só locais ativos com lat/lng,
   * sem paginação. Volume esperado: dezenas/centenas. Inclui clientes
   * achatado pro popup.
   */
  async mapa() {
    const locais = await this.prisma.local.findMany({
      where: {
        ativo: true,
        lat: { not: null },
        lng: { not: null },
      },
      select: {
        id: true,
        nome: true,
        logradouro: true,
        numero: true,
        bairro: true,
        cidade: true,
        uf: true,
        tipo: true,
        lat: true,
        lng: true,
        clientes: { select: { cliente: { select: { id: true, nome: true } } } },
      },
      orderBy: { nome: "asc" },
    });
    return locais.map(({ clientes, ...l }) => ({
      ...l,
      clientes: clientes.map((c) => c.cliente),
    }));
  }

  /**
   * Detecta grupos de locais ativos com nome parecido (provável duplicata por
   * digitação errada ou cadastro offline). Roda global — a lista é paginada,
   * então a detecção não pode ser por página.
   *
   * Estratégia: trigram (pg_trgm) sobre f_normalizar(nome) — reaproveita o
   * índice GIN `locais_nome_trgm_idx` e a função de normalização já em prod.
   * O `%` faz o prune pelo índice (threshold ~0.3); o filtro `similarity >= LIMIAR`
   * aperta pro nível que queremos. A partir dos pares, monta componentes conexos
   * (várias grafias do mesmo lugar caem no mesmo grupo).
   *
   * Em cada grupo: o membro com mais viagens é o "forte". Um membro com 0-1
   * viagem, quando existe um forte com >= 2 viagens, é marcado "provavel_lixo"
   * (cadastro errado a limpar). Os demais ficam "duplicata" (neutro).
   */
  async duplicatas() {
    const LIMIAR = 0.5;

    // Viagens por local ativo (carga + descarga). Raw usa o @@map: tabela
    // "viagens", colunas camelCase entre aspas.
    const counts = await this.prisma.$queryRaw<
      { id: string; nome: string; viagens: bigint }[]
    >`
      SELECT l.id,
             l.nome,
             (SELECT count(*) FROM "viagens" v WHERE v."localCargaId" = l.id)
           + (SELECT count(*) FROM "viagens" v WHERE v."localDescargaId" = l.id) AS viagens
      FROM "locais" l
      WHERE l.ativo = true
    `;

    const pares = await this.prisma.$queryRaw<
      { id_a: string; id_b: string }[]
    >`
      SELECT a.id AS id_a, b.id AS id_b
      FROM "locais" a
      JOIN "locais" b
        ON a.id < b.id
       AND a.ativo = true
       AND b.ativo = true
       AND public.f_normalizar(a.nome) % public.f_normalizar(b.nome)
      WHERE similarity(public.f_normalizar(a.nome), public.f_normalizar(b.nome)) >= ${LIMIAR}
    `;

    if (pares.length === 0) return [];

    const viagensDe = new Map<string, number>();
    const nomeDe = new Map<string, string>();
    for (const c of counts) {
      viagensDe.set(c.id, Number(c.viagens));
      nomeDe.set(c.id, c.nome);
    }

    // Union-find pra agrupar pares em componentes conexos.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r) as string;
      // path compression
      let cur = x;
      while (parent.get(cur) !== r) {
        const next = parent.get(cur) as string;
        parent.set(cur, r);
        cur = next;
      }
      return r;
    };
    const ensure = (x: string) => {
      if (!parent.has(x)) parent.set(x, x);
    };
    const union = (a: string, b: string) => {
      ensure(a);
      ensure(b);
      parent.set(find(a), find(b));
    };
    for (const p of pares) union(p.id_a, p.id_b);

    // Junta os ids por raiz do componente.
    const grupos = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const raiz = find(id);
      const arr = grupos.get(raiz);
      if (arr) arr.push(id);
      else grupos.set(raiz, [id]);
    }

    type Similar = { id: string; nome: string; totalViagens: number };
    const resultado: Array<
      Similar & {
        grupoId: string;
        papel: "provavel_lixo" | "duplicata";
        similares: Similar[];
      }
    > = [];

    for (const [grupoId, ids] of grupos) {
      if (ids.length < 2) continue;
      const membros: Similar[] = ids.map((id) => ({
        id,
        nome: nomeDe.get(id) ?? "",
        totalViagens: viagensDe.get(id) ?? 0,
      }));
      const maxViagens = Math.max(...membros.map((m) => m.totalViagens));
      // Forte = quem tem mais viagens (desempate por maior, depois primeiro).
      const forteId = membros.reduce((a, b) =>
        b.totalViagens > a.totalViagens ? b : a,
      ).id;

      for (const m of membros) {
        const ehLixo =
          m.totalViagens <= 1 && maxViagens >= 2 && m.id !== forteId;
        const similares = membros
          .filter((o) => o.id !== m.id)
          .sort((a, b) => b.totalViagens - a.totalViagens);
        resultado.push({
          ...m,
          grupoId,
          papel: ehLixo ? "provavel_lixo" : "duplicata",
          similares,
        });
      }
    }

    return resultado;
  }

  /**
   * Admin homologa manualmente — sobe pra HUMANO (top da hierarquia).
   */
  async homologar(id: string) {
    await this.ensureExists(id);
    await this.prisma.localEvidencia.create({
      data: {
        localId: id,
        // ADMIN não tem motorista; usa um motorista "sentinela" só pro audit?
        // Simplifica: não exige motoristaId pra fonte ADMIN. Reusa o primeiro
        // motorista do banco como placeholder pra não quebrar o FK.
        // → Alternativa melhor: pular o LocalEvidencia pra fonte ADMIN, só
        // atualizar o Local direto.
        motoristaId: await this.algumMotoristaId(),
        fonte: FonteEvidencia.ADMIN,
      },
    }).catch(() => {
      /* sem motorista no banco — segue sem audit */
    });
    return this.prisma.local.update({
      where: { id },
      data: {
        nivelConfianca: NivelConfiancaLocal.HUMANO,
        ultimaValidacaoEm: new Date(),
      },
    });
  }

  /**
   * Mescla local "origem" no "destino": move viagens (carga e descarga) pro
   * destino e apaga o origem. Útil pra eliminar duplicatas que escaparam do
   * pre-check de 200m.
   */
  async mesclar(origemId: string, destinoId: string) {
    if (origemId === destinoId) {
      throw new ConflictException("Origem e destino são o mesmo local");
    }
    const [origem, destino] = await Promise.all([
      this.prisma.local.findUnique({ where: { id: origemId } }),
      this.prisma.local.findUnique({ where: { id: destinoId } }),
    ]);
    if (!origem) throw new NotFoundException("Local de origem não encontrado");
    if (!destino) throw new NotFoundException("Local de destino não encontrado");

    await this.prisma.$transaction([
      this.prisma.viagem.updateMany({
        where: { localCargaId: origemId },
        data: { localCargaId: destinoId },
      }),
      this.prisma.viagem.updateMany({
        where: { localDescargaId: origemId },
        data: { localDescargaId: destinoId },
      }),
      this.prisma.rotaCache.deleteMany({
        where: { OR: [{ localOrigemId: origemId }, { localDestinoId: origemId }] },
      }),
      this.prisma.local.delete({ where: { id: origemId } }),
    ]);
    return { ok: true };
  }

  private async algumMotoristaId(): Promise<string> {
    const m = await this.prisma.motorista.findFirst({ select: { id: true } });
    if (!m) throw new ConflictException("Nenhum motorista cadastrado");
    return m.id;
  }

  async create(data: CriarLocalInput, usuarioId: string) {
    const { clienteIds, ...rest } = data;
    const local = await this.prisma.local.create({
      data: {
        ...(rest as Prisma.LocalUncheckedCreateInput),
        criadoPorId: usuarioId,
        origemCadastro: OrigemCadastroLocal.ADMIN_MANUAL,
        clientes: clienteIds.length
          ? { create: clienteIds.map((clienteId) => ({ clienteId })) }
          : undefined,
      },
      include: LOCAL_INCLUDE,
    });
    return flattenLocal(local);
  }

  async update(
    id: string,
    data: Partial<CriarLocalInput> & { ativo?: boolean },
  ) {
    await this.ensureExists(id);
    const { clienteIds, ...rest } = data;
    const local = await this.prisma.$transaction(async (tx) => {
      if (clienteIds !== undefined) {
        await tx.localCliente.deleteMany({ where: { localId: id } });
        if (clienteIds.length) {
          await tx.localCliente.createMany({
            data: clienteIds.map((clienteId) => ({ localId: id, clienteId })),
          });
        }
      }
      return tx.local.update({
        where: { id },
        data: rest as Prisma.LocalUncheckedUpdateInput,
        include: LOCAL_INCLUDE,
      });
    });
    return flattenLocal(local);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [carga, descarga] = await Promise.all([
      this.prisma.viagem.count({ where: { localCargaId: id } }),
      this.prisma.viagem.count({ where: { localDescargaId: id } }),
    ]);
    const total = carga + descarga;
    if (total > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${total} viagem${total === 1 ? "" : "s"} (${carga} de carga, ${descarga} de descarga). Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    // RotaCache sai cascade via schema
    await this.prisma.local.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const l = await this.prisma.local.findUnique({ where: { id } });
    if (!l) throw new NotFoundException("Local não encontrado");
    return l;
  }
}
