import { describe, expect, it, vi } from "vitest";
import { ResumoMotoristaService } from "./resumo-motorista.service";

/**
 * O resumo das 20h e a conferência diária conversam com o MESMO motorista no
 * mesmo dia: quem acabou de responder "Não tive" não pode receber logo depois
 * "hoje você fez 0 viagens". Pendência de peso/divergência, por outro lado, é
 * dinheiro parado e sai sempre.
 */
function montar(opts: {
  cfg?: { ativo: boolean; suprimirResumoQuemRecebeuPergunta: boolean } | null;
  perguntados?: string[];
  viagensHoje?: number;
  aguardandoPeso?: number;
  divergente?: number;
}) {
  const enviarOuFalhar = vi.fn(async (_e: unknown) => ({ enviado: true }));
  const prisma = {
    motorista: {
      findMany: vi.fn(async () => [
        { id: "m1", cpf: "1", telefone: "42991088125", conta: { nome: "A" } },
        { id: "m2", cpf: "2", telefone: "42991088126", conta: { nome: "A" } },
      ]),
    },
    configuracaoConferenciaDiaria: {
      findFirst: vi.fn(async () =>
        opts.cfg === undefined ? { ativo: true, suprimirResumoQuemRecebeuPergunta: true } : opts.cfg,
      ),
    },
    conferenciaDiaria: {
      findMany: vi.fn(async (_a: { where: { estado: { in: string[] } } }) =>
        (opts.perguntados ?? []).map((motoristaId) => ({ motoristaId })),
      ),
    },
    viagem: {
      count: vi.fn(async (a: { where: { status?: string } }) => {
        if (a.where.status === "AGUARDANDO_PESO") return opts.aguardandoPeso ?? 0;
        if (a.where.status === "DIVERGENTE") return opts.divergente ?? 0;
        return opts.viagensHoje ?? 2;
      }),
      aggregate: vi.fn(async () => ({ _sum: { toneladas: 10, km: 100 } })),
    },
  };
  const svc = new ResumoMotoristaService(
    prisma as never,
    { disponivel: vi.fn(async () => ({ ok: true })), enviarOuFalhar } as never,
  );
  return { svc, enviarOuFalhar, prisma };
}

const rodar = (s: ResumoMotoristaService) => (s as unknown as { enviarDiarioDaVez(): Promise<void> }).enviarDiarioDaVez();

describe("resumo diário x conferência diária", () => {
  it("quem recebeu a pergunta hoje NÃO recebe o resumo genérico; o outro recebe", async () => {
    const t = montar({ perguntados: ["m1"] });
    await rodar(t.svc);
    expect(t.enviarOuFalhar).toHaveBeenCalledOnce();
    const dest = (t.enviarOuFalhar.mock.calls[0]![0] as { destino: { numero: string } }).destino.numero;
    expect(dest).toBe("5542991088126");
  });

  it("pendência de peso sai SEMPRE, mesmo pra quem recebeu a pergunta", async () => {
    const t = montar({ perguntados: ["m1", "m2"], aguardandoPeso: 1 });
    await rodar(t.svc);
    expect(t.enviarOuFalhar).toHaveBeenCalledTimes(2);
  });

  it("divergência também sai sempre", async () => {
    const t = montar({ perguntados: ["m1", "m2"], divergente: 2 });
    await rodar(t.svc);
    expect(t.enviarOuFalhar).toHaveBeenCalledTimes(2);
  });

  it("opção desligada: todo mundo recebe como antes", async () => {
    const t = montar({ cfg: { ativo: true, suprimirResumoQuemRecebeuPergunta: false }, perguntados: ["m1", "m2"] });
    await rodar(t.svc);
    expect(t.enviarOuFalhar).toHaveBeenCalledTimes(2);
  });

  it("empresa que não usa a conferência não muda em nada", async () => {
    const t = montar({ cfg: null, perguntados: ["m1", "m2"] });
    await rodar(t.svc);
    expect(t.enviarOuFalhar).toHaveBeenCalledTimes(2);
    expect(t.prisma.conferenciaDiaria.findMany).not.toHaveBeenCalled();
  });

  it("conferência desligada não suprime nada (nenhuma pergunta saiu)", async () => {
    const t = montar({ cfg: { ativo: false, suprimirResumoQuemRecebeuPergunta: true }, perguntados: ["m1"] });
    await rodar(t.svc);
    expect(t.enviarOuFalhar).toHaveBeenCalledTimes(2);
  });

  it("só conta pergunta que SAIU hoje (ENVIADA, RESPONDIDA, EXPIRADA) — sombra e falha não suprimem", async () => {
    const t = montar({ perguntados: [] });
    await rodar(t.svc);
    const q = t.prisma.conferenciaDiaria.findMany.mock.calls[0]![0];
    expect(q.where.estado.in.sort()).toEqual(["ENVIADA", "EXPIRADA", "RESPONDIDA"]);
  });
});
