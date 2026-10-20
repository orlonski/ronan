import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { EscritorioSnapshotSchema } from "@ronan/shared-types";
import {
  montarSnapshotEscritorio,
  JANELA_EVENTOS_MS,
  LIMITE_EVENTOS,
  EscritorioSnapshotService,
  TTL_SNAPSHOT_MS,
  TTL_TRAVADA_MS,
  VALIDADE_STALE_MS,
  PAUSA_APOS_FALHA_MS,
  MAX_CALCULOS_SIMULTANEOS,
  TIMEOUT_TRANSACAO_MS,
  type EntradaSnapshot,
} from "./escritorio-snapshot";
import { comConta } from "../common/conta/conta-context";

const AGORA = new Date("2026-10-20T15:00:00.000Z");
const atras = (ms: number) => new Date(AGORA.getTime() - ms);

const VAZIO: EntradaSnapshot = {
  agora: AGORA,
  robo: { ativo: true, modoSombra: true },
  fila: 0,
  validadas24h: 0,
  devolvidas: 0,
  ajustadas: 0,
  travadas: 0,
  travadaMaisAntigaDesde: null,
  chegadas: [],
  veredictos: [],
};

describe("montarSnapshotEscritorio", () => {
  it("vazio: zeros, sem eventos e válido no contrato", () => {
    const s = montarSnapshotEscritorio(VAZIO);
    expect(EscritorioSnapshotSchema.parse(s)).toEqual(s);
    expect(s.contagens).toEqual({ fila: 0, validadas24h: 0, devolvidas: 0, ajustadas: 0, travadas: 0 });
    expect(s.travadaMaisAntigaMin).toBeNull();
    expect(s.chegadas).toEqual([]);
    expect(s.veredictos).toEqual([]);
  });

  it("travada antiga: idade em minutos inteiros", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, travadas: 2, travadaMaisAntigaDesde: atras(195 * 60_000 + 30_000) });
    expect(s.travadaMaisAntigaMin).toBe(195);
  });

  it("sem travadas a idade é null, mesmo que haja uma data sobrando", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, travadas: 0, travadaMaisAntigaDesde: atras(60_000) });
    expect(s.travadaMaisAntigaMin).toBeNull();
  });

  it("travada sem leitura registrada não inventa idade", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, travadas: 1, travadaMaisAntigaDesde: null });
    expect(s.travadaMaisAntigaMin).toBeNull();
  });

  it("janela de tempo: evento fora dos 10 min não entra, o da borda entra", () => {
    const s = montarSnapshotEscritorio({
      ...VAZIO,
      chegadas: [
        { id: "velha", em: atras(JANELA_EVENTOS_MS + 1) },
        { id: "borda", em: atras(JANELA_EVENTOS_MS) },
        { id: "nova", em: atras(1000) },
      ],
    });
    expect(s.chegadas.map((c) => c.id)).toEqual(["nova", "borda"]);
  });

  it("limite de 50, mais recentes primeiro", () => {
    const chegadas = Array.from({ length: 80 }, (_, i) => ({ id: `v${i}`, em: atras(i * 1000) }));
    const s = montarSnapshotEscritorio({ ...VAZIO, chegadas });
    expect(s.chegadas).toHaveLength(LIMITE_EVENTOS);
    expect(s.chegadas[0].id).toBe("v0");
    expect(s.chegadas[49].id).toBe("v49");
    expect(EscritorioSnapshotSchema.parse(s)).toBeTruthy();
  });

  it("veredito: segunda leitura quando passou de 1 passada ou escalou", () => {
    const base = { viagemId: "x", em: atras(1000), veredito: "DIVERGE" as const, acao: "AVISOU_MOTORISTA" };
    const s = montarSnapshotEscritorio({
      ...VAZIO,
      veredictos: [
        { ...base, id: "a", passadas: 1, escalouEm: null },
        { ...base, id: "b", em: atras(2000), passadas: 2, escalouEm: null },
        { ...base, id: "c", em: atras(3000), passadas: 1, escalouEm: atras(3500) },
      ],
    });
    expect(s.veredictos.map((v) => [v.id, v.segundaLeitura])).toEqual([["a", false], ["b", true], ["c", true]]);
    expect(EscritorioSnapshotSchema.parse(s)).toBeTruthy();
  });

  it("repassa o modo do robô (sombra tem que aparecer)", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, robo: { ativo: false, modoSombra: true } });
    expect(s.robo).toEqual({ ativo: false, modoSombra: true });
  });
});


/**
 * O service roda em polling de toda aba aberta. A 1ª versão (9 consultas em
 * paralelo, 3 sem índice) travou o banco da produção — estes testes seguram o
 * que a corrigiu: uma execução por conta, uma transação, e erro que não vira
 * rajada.
 */
describe("EscritorioSnapshotService: cache, single-flight e transação única", () => {
  function montar(opcoes: { falha?: () => boolean; travadas?: number; ligado?: boolean } = {}) {
    const tx = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => [{ desde: new Date("2026-10-20T10:00:00.000Z") }]),
      conta: { findUnique: vi.fn(async () => ({ iaConferenciaTicket: true })) },
      conferenciaTicket: { count: vi.fn(async () => 2), findMany: vi.fn(async () => []) },
      viagem: {
        count: vi.fn(async (args: { where: { status: unknown } }) => (args.where.status === "EM_CONFERENCIA" ? (opcoes.travadas ?? 1) : 4)),
        findMany: vi.fn(async () => []),
      },
    };
    const prisma = {
      configuracaoPlataforma: {
        findUnique: vi.fn(async () => ({ escritorioAtivo: opcoes.ligado ?? true })),
        upsert: vi.fn(async () => ({})),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
        if (opcoes.falha?.()) throw new Error("statement timeout");
        return fn(tx);
      }),
    };
    const svc = new EscritorioSnapshotService(prisma as never, { habilitado: true, modoSombra: true } as never);
    return { svc, prisma, tx };
  }
  const como = <T,>(conta: string, fn: () => Promise<T>) => comConta(conta, fn);

  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-20T15:00:00.000Z"), toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("todo o snapshot roda numa transação só, com statement_timeout, e valida no contrato", async () => {
    const { svc, prisma, tx } = montar();
    const snap = await como("c1", () => svc.snapshot());
    expect(EscritorioSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringMatching(/SET LOCAL statement_timeout = \d+/));
  });

  it("várias abas ao mesmo tempo disparam UM cálculo (single-flight)", async () => {
    const { svc, prisma } = montar();
    const r = await Promise.all(Array.from({ length: 12 }, () => como("c1", () => svc.snapshot())));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(new Set(r.map((x) => x.geradoEm)).size).toBe(1);
  });

  it("dentro do TTL serve do cache; passado o TTL recalcula", async () => {
    const { svc, prisma } = montar();
    await como("c1", () => svc.snapshot());
    vi.setSystemTime(Date.now() + TTL_SNAPSHOT_MS - 1);
    await como("c1", () => svc.snapshot());
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2);
    await como("c1", () => svc.snapshot());
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("cache é por conta: uma empresa nunca recebe o snapshot de outra", async () => {
    const { svc, prisma } = montar();
    await como("c1", () => svc.snapshot());
    await como("c2", () => svc.snapshot());
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("se o cálculo falha e há snapshot recente, serve o velho; sem cache, propaga o erro", async () => {
    let falhar = false;
    const { svc } = montar({ falha: () => falhar });
    await expect((async () => { falhar = true; return como("c9", () => svc.snapshot()); })()).rejects.toThrow("statement timeout");
    falhar = false;
    const bom = await como("c1", () => svc.snapshot());
    falhar = true;
    vi.setSystemTime(Date.now() + TTL_SNAPSHOT_MS + 1);
    expect(await como("c1", () => svc.snapshot())).toEqual({ ...bom, desatualizado: true });
    vi.setSystemTime(Date.now() + VALIDADE_STALE_MS);
    await expect(como("c1", () => svc.snapshot())).rejects.toThrow("statement timeout");
  });

  it("a travada mais antiga tem TTL próprio e só é medida quando há travadas", async () => {
    const { svc, tx } = montar({ travadas: 0 });
    await como("c1", () => svc.snapshot());
    expect(tx.$queryRaw).not.toHaveBeenCalled();

    const m = montar({ travadas: 3 });
    await como("c1", () => m.svc.snapshot());
    vi.setSystemTime(Date.now() + TTL_SNAPSHOT_MS + 1);
    await como("c1", () => m.svc.snapshot());
    expect(m.tx.$queryRaw).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + TTL_TRAVADA_MS);
    await como("c1", () => m.svc.snapshot());
    expect(m.tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("o SQL cru da travada leva o contaId explícito (a trava não filtra raw)", async () => {
    const { svc, tx } = montar({ travadas: 1 });
    await como("conta-xyz", () => svc.snapshot());
    const sql = (tx.$queryRaw.mock.calls as unknown[][])[0]?.[0] as { values?: unknown[] };
    expect(sql?.values).toContain("conta-xyz");
  });

  it("interruptor desligado: 404 na hora, sem abrir transação nem tocar nas tabelas", async () => {
    const { svc, prisma } = montar({ ligado: false });
    await expect(como("c1", () => svc.snapshot())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("se nem o interruptor consegue ser lido, trata como desligado (falha fechada)", async () => {
    const { svc, prisma } = montar();
    prisma.configuracaoPlataforma.findUnique.mockRejectedValueOnce(new Error("banco fora"));
    await expect(como("c1", () => svc.snapshot())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("o interruptor é lido do banco no máximo a cada TTL, e desligar vale na hora", async () => {
    const { svc, prisma } = montar();
    await como("c1", () => svc.snapshot());
    vi.setSystemTime(Date.now() + TTL_SNAPSHOT_MS + 1);
    await como("c1", () => svc.snapshot());
    expect(prisma.configuracaoPlataforma.findUnique).toHaveBeenCalledTimes(2);
    await svc.definirAtivo(false);
    await expect(como("c1", () => svc.snapshot())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("depois de uma falha não martela o banco: dentro da pausa responde sem nova transação", async () => {
    let falhar = true;
    const { svc, prisma } = montar({ falha: () => falhar });
    await expect(como("c1", () => svc.snapshot())).rejects.toThrow("statement timeout");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    await expect(como("c1", () => svc.snapshot())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    falhar = false;
    vi.setSystemTime(Date.now() + PAUSA_APOS_FALHA_MS + 1);
    await expect(como("c1", () => svc.snapshot())).resolves.toBeTruthy();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("limita os cálculos simultâneos do servidor inteiro; o excedente leva 503 sem tocar no banco", async () => {
    const { svc, prisma } = montar();
    const r = await Promise.allSettled(["c1", "c2", "c3", "c4"].map((c) => como(c, () => svc.snapshot())));
    expect(prisma.$transaction).toHaveBeenCalledTimes(MAX_CALCULOS_SIMULTANEOS);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(MAX_CALCULOS_SIMULTANEOS);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(4 - MAX_CALCULOS_SIMULTANEOS);
  });

  it("a conexão nunca fica presa mais que o teto da transação", async () => {
    const { svc, prisma } = montar();
    await como("c1", () => svc.snapshot());
    const opcoes = (prisma.$transaction.mock.calls as unknown[][])[0]?.[1] as { timeout: number };
    expect(opcoes.timeout).toBe(TIMEOUT_TRANSACAO_MS);
    expect(TIMEOUT_TRANSACAO_MS).toBeLessThanOrEqual(8_000);
  });
});
