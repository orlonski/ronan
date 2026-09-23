import { describe, expect, it } from "vitest";
import { comConta } from "../common/conta/conta-context";
import { ViagensMotoristaService } from "./viagens.service";

/**
 * O LANÇAMENTO GUIADO RESPEITA O MODO DE SERVIÇO.
 *
 * ⚠️ O "Começar viagem" nasceu antes dos modos e ignorava o cadastro: o
 * finalizar carimbava FALTA_MATERIAL/FALTA_KM/FALTA_LOCAL_DESCARGA e cobrava
 * ticket sempre, mesmo em conta cujo modo não pede nada disso — a viagem caía
 * em INCOMPLETA por campo que o app nem mostrava. E a viagem ficava sem
 * tipoServicoId, então preço amarrado a um modo nunca casava com ela.
 *
 * E o material que o motorista mandou era jogado fora quando o modo não o
 * exigia. Não exigir é não cobrar, não é apagar.
 */

type Modo = {
  id: string;
  padrao?: boolean;
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
};

const MODO_SEM_NADA: Modo = {
  id: "modo-leve",
  padrao: true,
  exigeMaterial: false,
  exigeTicket: false,
  exigeLocalDescarga: false,
  exigeKm: false,
};

const MODO_CLASSICO: Modo = {
  id: "modo-frete",
  padrao: true,
  exigeMaterial: true,
  exigeTicket: true,
  exigeLocalDescarga: true,
  exigeKm: true,
};

function montar(estado: {
  modos: Modo[];
  viagem: Record<string, unknown>;
  material?: { exigeTicket?: boolean } | null;
}) {
  const updates: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  const carimbos: string[] = [];

  const viagemGravada = (data: Record<string, unknown>) => ({
    id: "v1",
    ...estado.viagem,
    ...data,
    toneladas: data.toneladas ?? null,
    km: data.km ?? null,
    cliente: null,
    material: null,
  });

  const prisma: Record<string, unknown> = {
    viagem: {
      findUnique: async () => estado.viagem,
      findFirst: async () => null,
      findMany: async () => [],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return viagemGravada(data);
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return { ...viagemGravada(data), eventosViagem: [] };
      },
    },
    tipoServico: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        estado.modos.find((m) => m.id === where.id) ?? null,
      findFirst: async () => estado.modos.find((m) => m.padrao) ?? null,
    },
    cliente: {
      findUnique: async () => ({ id: "cli1", empresaId: "emp1" }),
    },
    material: {
      findUnique: async () =>
        estado.material === null
          ? null
          : {
              nome: "Brita",
              exigeTicket: estado.material?.exigeTicket ?? true,
              permiteBotaFora: false,
              temComprovanteFoto: true,
              dispensaConferencia: false,
            },
    },
    conta: { findUnique: async () => ({ exigeFotoViagem: false }) },
    regraMinimo: { findMany: async () => [] },
    viagemDivergencia: {
      findMany: async () => [],
      create: async ({ data }: { data: { motivo: string } }) => {
        carimbos.push(data.motivo);
        return data;
      },
    },
    veiculo: {
      findUnique: async () => ({ id: "vei1", placa: "ABC1D23" }),
      findFirst: async () => ({ id: "vei1", placa: "ABC1D23" }),
    },
    local: { findUnique: async () => ({ id: "loc1" }) },
    motorista: { findUnique: async () => ({ id: "mot1", nome: "Joao" }) },
  };

  const nada = new Proxy(
    {},
    { get: () => async () => undefined },
  ) as never;

  const service = new ViagensMotoristaService(
    prisma as never,
    nada, // uploads
    nada, // validacao
    nada, // auditoria
    nada, // eventos
    nada, // roteamento
    nada, // inbox
    nada, // kmReprocessamento
    nada, // avisos
    nada, // kmAtipico
    nada, // conferencia
    nada, // precificacao
    nada, // programacao
    nada, // mensagens
    nada, // resgates
  );
  return { service, updates, creates, carimbos };
}

const FINALIZAR_MINIMO = {
  data: new Date("2026-09-20"),
  toneladas: 30,
};

const emConta = <T>(fn: () => Promise<T>) => comConta("conta1", fn);

describe("finalizar da viagem guiada respeita o modo", () => {
  const viagemAberta = {
    id: "v1",
    motoristaId: "mot1",
    status: "EM_ANDAMENTO",
    clienteId: "cli1",
    localCargaId: "loc1",
    tipoServicoId: "modo-leve",
  };

  it("modo que não pede material/km/descarga/ticket não carimba falta nenhuma", async () => {
    const { service, updates, carimbos } = montar({
      modos: [MODO_SEM_NADA],
      viagem: viagemAberta,
    });
    await emConta(() => service.finalizar("mot1", "cid1", FINALIZAR_MINIMO as never));
    expect(carimbos).toEqual([]);
    expect(updates[0]!.status).toBe("ENVIADA");
    expect(updates[0]!.tipoServicoId).toBe("modo-leve");
  });

  it("modo clássico segue cobrando material, km, descarga e ticket", async () => {
    const { service, updates, carimbos } = montar({
      modos: [MODO_CLASSICO],
      viagem: { ...viagemAberta, tipoServicoId: "modo-frete" },
    });
    await emConta(() => service.finalizar("mot1", "cid1", FINALIZAR_MINIMO as never));
    expect(carimbos.sort()).toEqual(
      ["FALTA_KM", "FALTA_LOCAL_DESCARGA", "FALTA_MATERIAL", "FALTA_TICKET"].sort(),
    );
    expect(updates[0]!.status).toBe("INCOMPLETA");
  });

  it("ticket só é cobrado quando o modo pede", async () => {
    const semTicket = { ...MODO_CLASSICO, exigeTicket: false };
    const { service, carimbos } = montar({
      modos: [semTicket],
      viagem: { ...viagemAberta, tipoServicoId: "modo-frete" },
    });
    await emConta(() =>
      service.finalizar("mot1", "cid1", {
        ...FINALIZAR_MINIMO,
        materialId: "mat1",
        km: 40,
        localDescargaId: "loc2",
      } as never),
    );
    expect(carimbos).not.toContain("FALTA_TICKET");

    const classico = montar({
      modos: [MODO_CLASSICO],
      viagem: { ...viagemAberta, tipoServicoId: "modo-frete" },
    });
    await emConta(() =>
      classico.service.finalizar("mot1", "cid1", {
        ...FINALIZAR_MINIMO,
        materialId: "mat1",
        km: 40,
        localDescargaId: "loc2",
      } as never),
    );
    expect(classico.carimbos).toContain("FALTA_TICKET");
  });

  it("viagem aberta por app antigo (sem modo) usa o padrão da conta e grava ele", async () => {
    const { service, updates, carimbos } = montar({
      modos: [MODO_SEM_NADA],
      viagem: { ...viagemAberta, tipoServicoId: null },
    });
    await emConta(() => service.finalizar("mot1", "cid1", FINALIZAR_MINIMO as never));
    expect(carimbos).toEqual([]);
    expect(updates[0]!.tipoServicoId).toBe("modo-leve");
  });

  it("guarda o material que veio mesmo quando o modo não exige", async () => {
    const { service, updates } = montar({
      modos: [MODO_SEM_NADA],
      viagem: viagemAberta,
    });
    await emConta(() =>
      service.finalizar("mot1", "cid1", { ...FINALIZAR_MINIMO, materialId: "mat1" } as never),
    );
    expect(updates[0]!.materialId).toBe("mat1");
  });
});

describe("completar o peso respeita o modo da viagem", () => {
  const aguardando = {
    id: "v1",
    motoristaId: "mot1",
    status: "AGUARDANDO_PESO",
    materialId: "mat1",
    tipoServicoId: "modo-leve",
    cliente: { empresaId: "emp1" },
  };

  it("modo sem ticket não carimba FALTA_TICKET", async () => {
    const { service, updates, carimbos } = montar({
      modos: [MODO_SEM_NADA],
      viagem: aguardando,
    });
    await emConta(() => service.completarPeso("mot1", "v1", { toneladas: 30 }));
    expect(carimbos).not.toContain("FALTA_TICKET");
    expect(updates[0]!.status).toBe("ENVIADA");
  });

  it("modo clássico segue cobrando o ticket", async () => {
    const { service, carimbos } = montar({
      modos: [MODO_CLASSICO],
      viagem: { ...aguardando, tipoServicoId: "modo-frete" },
    });
    await emConta(() => service.completarPeso("mot1", "v1", { toneladas: 30 }));
    expect(carimbos).toContain("FALTA_TICKET");
  });

  it("viagem sem modo gravado herda o padrão e passa a tê-lo", async () => {
    const { service, updates, carimbos } = montar({
      modos: [MODO_SEM_NADA],
      viagem: { ...aguardando, tipoServicoId: null },
    });
    await emConta(() => service.completarPeso("mot1", "v1", { toneladas: 30 }));
    expect(carimbos).not.toContain("FALTA_TICKET");
    expect(updates[0]!.tipoServicoId).toBe("modo-leve");
  });
});

describe("iniciar grava o modo da viagem", () => {
  it("usa o modo escolhido no app", async () => {
    const outro = { ...MODO_CLASSICO, id: "modo-outro", padrao: false };
    const { service, creates } = montar({
      modos: [MODO_SEM_NADA, outro],
      viagem: null as never,
    });
    await emConta(() =>
      service.iniciar("mot1", {
        clientId: "cid1",
        veiculoId: "vei1",
        clienteId: "cli1",
        tipoServicoId: "modo-outro",
        iniciadoEm: new Date(),
      }),
    );
    expect(creates[0]!.tipoServicoId).toBe("modo-outro");
  });

  it("app antigo (sem tipoServicoId) grava o padrão da conta", async () => {
    const { service, creates } = montar({ modos: [MODO_SEM_NADA], viagem: null as never });
    await emConta(() =>
      service.iniciar("mot1", {
        clientId: "cid1",
        veiculoId: "vei1",
        clienteId: "cli1",
        iniciadoEm: new Date(),
      }),
    );
    expect(creates[0]!.tipoServicoId).toBe("modo-leve");
  });
});

describe("lançamento de viagem feita guarda o material", () => {
  it("modo sem material não joga fora o material que veio", async () => {
    const { service, creates, carimbos } = montar({
      modos: [MODO_SEM_NADA],
      viagem: null as never,
    });
    await emConta(() =>
      service.create("mot1", {
        clientId: "cid1",
        veiculoId: "vei1",
        clienteId: "cli1",
        materialId: "mat1",
        data: new Date("2026-09-20"),
        toneladas: 30,
        localCargaId: "loc1",
      } as never),
    );
    expect(creates[0]!.materialId).toBe("mat1");
    expect(carimbos).toEqual([]);
  });
});
