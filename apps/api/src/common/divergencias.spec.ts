import { describe, it, expect, vi } from "vitest";
import { MotivoDivergencia, StatusViagem } from "@prisma/client";
import {
  aplicarDivergencias,
  Divergencias,
  FRASE_PADRAO,
  resolverDivergenciasSupridas,
} from "./divergencias";

/** Dublê do client do Prisma só com o que estas funções tocam. */
function fakeDb(existentes: Array<{ id: string; motivo: MotivoDivergencia }> = []) {
  const criados: Array<Record<string, unknown>> = [];
  const atualizados: Array<Record<string, unknown>> = [];
  return {
    criados,
    atualizados,
    client: {
      viagemDivergencia: {
        findMany: vi.fn().mockResolvedValue(existentes),
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          criados.push(args.data);
          return args.data;
        }),
        updateMany: vi.fn(async (args: Record<string, unknown>) => {
          atualizados.push(args);
          return { count: 1 };
        }),
      },
    } as unknown as Parameters<typeof aplicarDivergencias>[0] & {
      viagemDivergencia: { findMany: ReturnType<typeof vi.fn> };
    },
  };
}

describe("Divergencias — o que segura a viagem e o que só sinaliza", () => {
  it("sem carimbo nenhum, o status desejado passa intacto", () => {
    const d = new Divergencias();
    expect(d.vazio).toBe(true);
    expect(d.statusFinal(StatusViagem.ENVIADA)).toBe(StatusViagem.ENVIADA);
  });

  it("falta de dado essencial manda a viagem pra INCOMPLETA", () => {
    const d = new Divergencias();
    d.add(MotivoDivergencia.FALTA_TONELADAS);
    expect(d.bloqueia).toBe(true);
    expect(d.statusFinal(StatusViagem.ENVIADA)).toBe(StatusViagem.INCOMPLETA);
  });

  it("carimbo informativo NÃO tira a viagem do fluxo normal", () => {
    // Uma viagem que ficou aberta é sinalizada, mas continua faturável: o
    // conferente decide, o sistema não segura o dinheiro do motorista por isso.
    const d = new Divergencias();
    d.add(MotivoDivergencia.VIAGEM_ANTERIOR_ABERTA);
    expect(d.bloqueia).toBe(false);
    expect(d.statusFinal(StatusViagem.ENVIADA)).toBe(StatusViagem.ENVIADA);
  });

  it("status de fluxo vence o INCOMPLETA — a diária precisa saber que espera a saída", () => {
    const d = new Divergencias();
    d.add(MotivoDivergencia.FALTA_KM);
    expect(d.statusFinal(StatusViagem.AGUARDANDO_SAIDA)).toBe(StatusViagem.AGUARDANDO_SAIDA);
    expect(d.statusFinal(StatusViagem.AGUARDANDO_PESO)).toBe(StatusViagem.AGUARDANDO_PESO);
    expect(d.statusFinal(StatusViagem.EM_ANDAMENTO)).toBe(StatusViagem.EM_ANDAMENTO);
  });

  it("o mesmo motivo carimbado duas vezes vira um só (o unique do banco depende disso)", () => {
    const d = new Divergencias();
    d.add(MotivoDivergencia.FALTA_MATERIAL, { origem: "primeira" });
    d.add(MotivoDivergencia.FALTA_MATERIAL, { origem: "segunda" });
    expect(d.lista).toHaveLength(1);
    expect(d.lista[0]!.dados).toEqual({ origem: "primeira" });
  });

  it("usa a frase padrão do motivo quando o chamador não escreve uma", () => {
    const d = new Divergencias();
    d.add(MotivoDivergencia.FALTA_KM);
    expect(d.lista[0]!.detalhe).toBe(FRASE_PADRAO.FALTA_KM);
  });

  it("detalhe próprio do chamador ganha da frase padrão", () => {
    const d = new Divergencias();
    d.add(MotivoDivergencia.CADASTRO_LOCAL_SUMIU, { lado: "carga" }, "Local de carga sumiu.");
    expect(d.lista[0]!.detalhe).toBe("Local de carga sumiu.");
  });

  it("sem carimbo, não emite bloco de create (nada de chave vazia no data)", () => {
    expect(new Divergencias().paraCreateAninhado()).toBeUndefined();
  });
});

describe("aplicarDivergencias — reenvio do outbox não pode reabrir caso resolvido", () => {
  it("cria só o que ainda não existe naquela viagem", async () => {
    const db = fakeDb([{ id: "d1", motivo: MotivoDivergencia.FALTA_KM }]);
    const d = new Divergencias();
    d.add(MotivoDivergencia.FALTA_KM); // já existe → ignorado
    d.add(MotivoDivergencia.FALTA_TONELADAS); // novo → criado

    await aplicarDivergencias(db.client, "v1", d);

    expect(db.criados).toHaveLength(1);
    expect(db.criados[0]!.motivo).toBe(MotivoDivergencia.FALTA_TONELADAS);
  });

  it("nunca derruba quem chamou: a viagem já entrou e é ela que importa", async () => {
    const db = fakeDb();
    db.client.viagemDivergencia.findMany = vi.fn().mockRejectedValue(new Error("banco fora"));
    const d = new Divergencias();
    d.add(MotivoDivergencia.FALTA_KM);

    await expect(aplicarDivergencias(db.client, "v1", d)).resolves.toBeUndefined();
  });
});

describe("resolverDivergenciasSupridas — o painel resolve preenchendo o campo", () => {
  const viagemBase = {
    id: "v1",
    status: StatusViagem.INCOMPLETA,
    materialId: null,
    localDescargaId: null,
    km: null,
    toneladas: null,
    ticket: null,
    clienteId: null,
  };

  it("preencher o campo que faltava fecha o carimbo e libera a viagem", async () => {
    const db = fakeDb([{ id: "d1", motivo: MotivoDivergencia.FALTA_TONELADAS }]);

    const novoStatus = await resolverDivergenciasSupridas(
      db.client,
      { ...viagemBase, toneladas: 32.5 },
      "user-1",
    );

    expect(db.atualizados).toHaveLength(1);
    expect(novoStatus).toBe(StatusViagem.ENVIADA);
  });

  it("ainda faltando outro campo, a viagem continua fora do fechamento", async () => {
    const db = fakeDb([
      { id: "d1", motivo: MotivoDivergencia.FALTA_TONELADAS },
      { id: "d2", motivo: MotivoDivergencia.FALTA_KM },
    ]);

    const novoStatus = await resolverDivergenciasSupridas(db.client, {
      ...viagemBase,
      toneladas: 32.5, // supriu esta
      // km segue null
    });

    expect(novoStatus).toBeNull();
  });

  it("carimbo informativo pendente não impede a viagem de ser liberada", async () => {
    const db = fakeDb([
      { id: "d1", motivo: MotivoDivergencia.FALTA_KM },
      { id: "d2", motivo: MotivoDivergencia.VIAGEM_ANTERIOR_ABERTA },
    ]);

    const novoStatus = await resolverDivergenciasSupridas(db.client, {
      ...viagemBase,
      km: 120,
    });

    expect(novoStatus).toBe(StatusViagem.ENVIADA);
  });

  it("viagem já normal não é mexida por engano", async () => {
    const db = fakeDb([]);
    const novoStatus = await resolverDivergenciasSupridas(db.client, {
      ...viagemBase,
      status: StatusViagem.OK,
    });
    expect(novoStatus).toBeNull();
  });

  it("INCOMPLETA sem carimbo aberto nenhum volta pro fluxo normal", async () => {
    const db = fakeDb([]);
    const novoStatus = await resolverDivergenciasSupridas(db.client, viagemBase);
    expect(novoStatus).toBe(StatusViagem.ENVIADA);
  });
});
