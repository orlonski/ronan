import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { PedagiosRodoviaConsultaService } from "./pedagios-rodovia-consulta.service";
import { PedagiosRodoviaService } from "./pedagios-rodovia.service";
import { RoteamentoService } from "../../roteamento/roteamento.service";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * A lista de viagens usa `pedagiosDasViagens` (lote) e o detalhe usa
 * `pedagiosDaViagem` (uma por vez). Se as duas divergirem, a lista acusa
 * "pedágio sem valor" numa viagem que o detalhe diz não ter — então a regra
 * aqui é uma só: o lote devolve, viagem a viagem, o mesmo que a consulta
 * individual com `somenteCache`.
 */

function encode(pontos: Array<[number, number]>): string {
  let out = "";
  let pLat = 0;
  let pLng = 0;
  const num = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of pontos) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    num(iLat - pLat);
    num(iLng - pLng);
    pLat = iLat;
    pLng = iLng;
  }
  return out;
}

// Uma "rodovia" reta pra leste, uma pra norte, e as praças em cima delas.
const LESTE = encode([
  [-25.0, -50.0],
  [-25.0, -49.8],
]);
const NORTE = encode([
  [-25.0, -49.8],
  [-24.8, -49.8],
]);
const ESCOLHIDA = encode([
  [-25.0, -50.0],
  [-25.1, -50.0],
]);
const PRACAS = [
  { id: "p-leste", nome: "Praça Leste", lat: -25.0, lng: -49.9 },
  { id: "p-norte", nome: "Praça Norte", lat: -24.9, lng: -49.8 },
  { id: "p-longe", nome: "Praça Longe", lat: -23.0, lng: -47.0 },
].map((p) => ({
  ...p,
  rodovia: "BR-000",
  concessionaria: null,
  ativo: true,
  valorBase: new Prisma.Decimal("12.3"),
}));

const agora = new Date();
const velho = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
const CACHE = [
  { localOrigemId: "A", localDestinoId: "B", geometria: LESTE, versaoRoteador: 4, calculadoEm: agora },
  { localOrigemId: "B", localDestinoId: "C", geometria: NORTE, versaoRoteador: 4, calculadoEm: agora },
  // Roteador antigo e cache vencido: "não sei", nos dois caminhos.
  { localOrigemId: "A", localDestinoId: "D", geometria: LESTE, versaoRoteador: 1, calculadoEm: agora },
  { localOrigemId: "A", localDestinoId: "E", geometria: LESTE, versaoRoteador: 4, calculadoEm: velho },
];

const bota = (localId: string, ordem: number) => ({ tipo: "RETORNO_BOTA_FORA", localId, ordem });
const VIAGENS = [
  { id: "v-cache", localCargaId: "A", localDescargaId: "B", rotaGeometria: null, trechos: [] },
  { id: "v-escolhida", localCargaId: "A", localDescargaId: "B", rotaGeometria: ESCOLHIDA, trechos: [] },
  { id: "v-bota", localCargaId: "A", localDescargaId: "B", rotaGeometria: null, trechos: [bota("C", 1)] },
  { id: "v-bota-sem-cache", localCargaId: "A", localDescargaId: "B", rotaGeometria: null, trechos: [bota("Z", 1)] },
  { id: "v-sem-cache", localCargaId: "X", localDescargaId: "Y", rotaGeometria: null, trechos: [] },
  { id: "v-roteador-velho", localCargaId: "A", localDescargaId: "D", rotaGeometria: null, trechos: [] },
  { id: "v-vencido", localCargaId: "A", localDescargaId: "E", rotaGeometria: null, trechos: [] },
  { id: "v-andamento", localCargaId: "A", localDescargaId: null, rotaGeometria: null, trechos: [] },
  { id: "v-mesmo-local", localCargaId: "A", localDescargaId: "A", rotaGeometria: null, trechos: [] },
];

function montar() {
  const consultas = { viagem: 0, rotaCache: 0, pedagio: 0 };
  const achaCache = (o: string, d: string) =>
    CACHE.find((c) => c.localOrigemId === o && c.localDestinoId === d) ?? null;
  const naCaixa = (w: { lat: { gte: number; lte: number }; lng: { gte: number; lte: number } }) =>
    PRACAS.filter(
      (p) => p.lat >= w.lat.gte && p.lat <= w.lat.lte && p.lng >= w.lng.gte && p.lng <= w.lng.lte,
    );
  const prisma = {
    viagem: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        consultas.viagem++;
        return VIAGENS.find((v) => v.id === where.id) ?? null;
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        consultas.viagem++;
        return VIAGENS.filter((v) => where.id.in.includes(v.id));
      },
    },
    rotaCache: {
      findUnique: async ({ where }: { where: { localOrigemId_localDestinoId: { localOrigemId: string; localDestinoId: string } } }) => {
        consultas.rotaCache++;
        const k = where.localOrigemId_localDestinoId;
        return achaCache(k.localOrigemId, k.localDestinoId);
      },
      findMany: async ({ where }: { where: { OR: Array<{ localOrigemId: string; localDestinoId: string }> } }) => {
        consultas.rotaCache++;
        return where.OR.map((p) => achaCache(p.localOrigemId, p.localDestinoId)).filter(Boolean);
      },
    },
    pedagioRodovia: {
      findMany: async ({ where }: { where: Parameters<typeof naCaixa>[0] }) => {
        consultas.pedagio++;
        return naCaixa(where);
      },
    },
  } as unknown as PrismaService;
  const servico = new PedagiosRodoviaConsultaService(
    prisma,
    new PedagiosRodoviaService(prisma),
    new RoteamentoService(prisma),
  );
  return { servico, consultas };
}

describe("pedagiosDasViagens (lote da listagem)", () => {
  it("devolve, viagem a viagem, o mesmo que pedagiosDaViagem com somenteCache", async () => {
    const { servico } = montar();
    const lote = await servico.pedagiosDasViagens(VIAGENS.map((v) => v.id));
    for (const v of VIAGENS) {
      const individual = await servico.pedagiosDaViagem(v.id, { somenteCache: true });
      expect(lote.get(v.id), v.id).toEqual(individual);
    }
  });

  it("acerta os casos que a lista usa pra acusar pedágio sem valor", async () => {
    const { servico } = montar();
    const lote = await servico.pedagiosDasViagens(VIAGENS.map((v) => v.id));
    const ids = (id: string) => lote.get(id)?.pedagios?.map((p) => p.id) ?? null;
    expect(ids("v-cache")).toEqual(["p-leste"]);
    // A rota que o motorista escolheu vence o cache do par.
    expect(ids("v-escolhida")).toEqual([]);
    expect(ids("v-bota")?.sort()).toEqual(["p-leste", "p-norte"]);
    // Sem geometria confiável é "não sei" — nunca "sem pedágio".
    for (const id of ["v-bota-sem-cache", "v-sem-cache", "v-roteador-velho", "v-vencido", "v-andamento", "v-mesmo-local"]) {
      expect(ids(id), id).toBeNull();
    }
    expect(lote.get("v-cache")?.pedagios?.[0]?.valorBase).toBe("12.30");
  });

  it("custa um número fixo de consultas, não uma por viagem", async () => {
    const { servico, consultas } = montar();
    await servico.pedagiosDasViagens(VIAGENS.map((v) => v.id));
    expect(consultas).toEqual({ viagem: 1, rotaCache: 1, pedagio: 1 });
  });

  it("lista vazia não consulta nada", async () => {
    const { servico, consultas } = montar();
    expect((await servico.pedagiosDasViagens([])).size).toBe(0);
    expect(consultas).toEqual({ viagem: 0, rotaCache: 0, pedagio: 0 });
  });
});
