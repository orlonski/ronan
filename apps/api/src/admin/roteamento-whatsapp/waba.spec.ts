import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { SalvarMetaWabaInput } from "@ronan/shared-types";
import { describe, expect, it } from "vitest";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { AdminRoteamentoWhatsappController } from "./roteamento-whatsapp.controller";
import { AdminRoteamentoWhatsappService } from "./roteamento-whatsapp.service";

describe("SalvarMetaWabaInput", () => {
  const ok = (v: unknown) => SalvarMetaWabaInput.safeParse({ wabaId: v });

  it("aceita só dígitos de 5 a 30", () => {
    expect(ok("102938475610293").success).toBe(true);
    expect(ok("12345").success).toBe(true);
    expect(ok("1".repeat(30)).success).toBe(true);
    expect(ok("1234").success).toBe(false);
    expect(ok("1".repeat(31)).success).toBe(false);
    expect(ok("12a45678").success).toBe(false);
  });

  it("apara espaços e trata vazio como apagar", () => {
    expect(ok("  123456 ")).toMatchObject({ success: true, data: { wabaId: "123456" } });
    expect(ok("")).toMatchObject({ success: true, data: { wabaId: null } });
    expect(ok("   ")).toMatchObject({ success: true, data: { wabaId: null } });
    expect(ok(null)).toMatchObject({ success: true, data: { wabaId: null } });
  });

  it("recusa número JS e ausência do campo", () => {
    expect(ok(123456).success).toBe(false);
    expect(SalvarMetaWabaInput.safeParse({}).success).toBe(false);
  });
});

describe("controller do WABA", () => {
  it("fica atrás de PlataformaGuard (guard da classe cobre as duas rotas)", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminRoteamentoWhatsappController) as unknown[];
    expect(guards).toContain(PlataformaGuard);
  });

  it("delega leitura e gravação ao service", async () => {
    const chamadas: unknown[] = [];
    const service = {
      pegarWaba: async () => ({ wabaId: "111111" }),
      salvarWaba: async (v: string | null) => {
        chamadas.push(v);
        return { wabaId: v };
      },
    };
    const c = new AdminRoteamentoWhatsappController(service as never);
    expect(await c.pegarWaba()).toEqual({ wabaId: "111111" });
    expect(await c.salvarWaba({ wabaId: null })).toEqual({ wabaId: null });
    expect(chamadas).toEqual([null]);
  });
});

describe("service do WABA", () => {
  function servico(inicial: string | null | undefined) {
    let valor = inicial;
    const prisma = {
      configuracaoPlataforma: {
        findUnique: async () => (valor === undefined ? null : { metaWabaId: valor }),
        upsert: async ({ update }: { update: { metaWabaId: string | null } }) => {
          valor = update.metaWabaId;
          return { metaWabaId: valor };
        },
      },
    };
    return new AdminRoteamentoWhatsappService(prisma as never, {} as never, {} as never, {} as never);
  }

  it("lê null quando não há linha ou valor", async () => {
    expect(await servico(undefined).pegarWaba()).toEqual({ wabaId: null });
    expect(await servico(null).pegarWaba()).toEqual({ wabaId: null });
  });

  it("grava, lê e apaga", async () => {
    const s = servico(null);
    expect(await s.salvarWaba("987654321")).toEqual({ wabaId: "987654321" });
    expect(await s.pegarWaba()).toEqual({ wabaId: "987654321" });
    expect(await s.salvarWaba(null)).toEqual({ wabaId: null });
    expect(await s.pegarWaba()).toEqual({ wabaId: null });
  });
});
