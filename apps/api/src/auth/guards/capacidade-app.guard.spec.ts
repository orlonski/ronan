import { describe, expect, it } from "vitest";
import { Controller, ForbiddenException, Get } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CapacidadeLivre, RequerCapacidade } from "../../common/acesso-app/capacidade.decorator";
import { comConta } from "../../common/conta/conta-context";
import { AcessoMotorista } from "../decorators/acesso-motorista.decorator";
import { Public } from "../decorators/public.decorator";
import { CapacidadeAppGuard, declaracaoDoHandler } from "./capacidade-app.guard";

/**
 * O guard que vai BARRAR GENTE quando a plataforma travar uma capacidade.
 * Cada caso aqui é um jeito de barrar quem não devia, ou de deixar passar quem
 * a empresa tirou.
 */

@CapacidadeLivre("classe livre")
@Controller("m/livre")
class ClasseLivre {
  @Get() lerTudo() {}
  @RequerCapacidade("app.chat.usar") @Get("x") exige() {}
}

@RequerCapacidade("app.acertos.ver")
@Controller("m/acertos")
class ClasseExige {
  @Get() ver() {}
  @CapacidadeLivre("método livre") @Get("x") livre() {}
  @RequerCapacidade({ algum: ["app.ponto.bater", "app.ponto.espelho"] }) @Get("y") algum() {}
  @Public() @Get("z") publico() {}
}

@Controller("m/antigo")
class ClasseAntiga {
  @AcessoMotorista("podeLancarPedagio") @Get() lancar() {}
  @Get("x") semNada() {}
}

@Controller("admin/qualquer")
class ForaDoApp {
  @RequerCapacidade("app.chat.usar") @Get() algo() {}
}

const reflector = new Reflector();
const decl = (c: Function, m: string) =>
  declaracaoDoHandler(reflector, (c.prototype as Record<string, Function>)[m]!, c);

describe("o método vence a classe, nos dois sentidos", () => {
  it("classe livre com método que exige → exige", () => {
    expect(decl(ClasseLivre, "exige")).toEqual({ tipo: "exige", exige: "app.chat.usar" });
    expect(decl(ClasseLivre, "lerTudo").tipo).toBe("livre");
  });
  it("classe que exige com método livre → livre", () => {
    expect(decl(ClasseExige, "livre").tipo).toBe("livre");
    expect(decl(ClasseExige, "ver")).toEqual({ tipo: "exige", exige: "app.acertos.ver" });
  });
  it("o @AcessoMotorista antigo vale pela coluna que a capacidade espelha", () => {
    expect(decl(ClasseAntiga, "lancar")).toEqual({ tipo: "exige", exige: "app.pedagio.lancar" });
    expect(decl(ClasseAntiga, "semNada").tipo).toBe("nada");
  });
});

function guardCom(opts: { efetivo: string[] | null; travadas: string[] }) {
  const sombras: unknown[] = [];
  const prisma = {
    acessoEfetivoApp: {
      findUnique: async () => (opts.efetivo ? { capacidades: opts.efetivo } : null),
    },
    configuracaoAcessoApp: {
      findUnique: async () => ({ capacidadesTravadas: opts.travadas }),
    },
    logAcessoApp: {
      create: async (a: unknown) => {
        sombras.push(a);
        return {};
      },
    },
  };
  return { guard: new CapacidadeAppGuard(reflector, prisma as never), sombras };
}

function ctx(classe: Function, metodo: string, kind = "MOTORISTA") {
  return {
    getType: () => "http",
    getClass: () => classe,
    getHandler: () => (classe.prototype as Record<string, Function>)[metodo]!,
    switchToHttp: () => ({
      getRequest: () => ({
        method: "GET",
        route: { path: `/${metodo}` },
        user: { kind, id: "m1", cpf: "123.456.789-00", contaId: "c1" },
      }),
    }),
  } as never;
}

const rodar = (g: CapacidadeAppGuard, c: unknown) => comConta("c1", async () => g.canActivate(c as never));

describe("sombra: registra e deixa passar", () => {
  it("sem a capacidade e sem trava → passa e grava a sombra", async () => {
    const { guard, sombras } = guardCom({ efetivo: ["app.chat.usar"], travadas: [] });
    await expect(rodar(guard, ctx(ClasseExige, "ver"))).resolves.toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(sombras).toHaveLength(1);
  });
  it("com a capacidade → passa sem sombra", async () => {
    const { guard, sombras } = guardCom({ efetivo: ["app.acertos.ver"], travadas: ["app.acertos.ver"] });
    await expect(rodar(guard, ctx(ClasseExige, "ver"))).resolves.toBe(true);
    expect(sombras).toHaveLength(0);
  });
});

describe("travada: barra com 403 CAPACIDADE_DESLIGADA", () => {
  it("sem a capacidade e travada → 403 com código", async () => {
    const { guard } = guardCom({ efetivo: [], travadas: ["app.acertos.ver"] });
    const erro = await rodar(guard, ctx(ClasseExige, "ver")).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as ForbiddenException).getResponse()).toMatchObject({ code: "CAPACIDADE_DESLIGADA" });
  });
  it("`algum` só barra com TODAS as opções travadas", async () => {
    const umaTravada = guardCom({ efetivo: [], travadas: ["app.ponto.bater"] });
    await expect(rodar(umaTravada.guard, ctx(ClasseExige, "algum"))).resolves.toBe(true);
    const todas = guardCom({ efetivo: [], travadas: ["app.ponto.bater", "app.ponto.espelho"] });
    await expect(rodar(todas.guard, ctx(ClasseExige, "algum"))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("o que nunca barra", () => {
  it("pessoa sem acesso calculado ainda (não sei ≠ não pode)", async () => {
    const { guard } = guardCom({ efetivo: null, travadas: ["app.acertos.ver"] });
    await expect(rodar(guard, ctx(ClasseExige, "ver"))).resolves.toBe(true);
  });
  it("método livre, rota pública e rota fora do /m/*", async () => {
    const { guard } = guardCom({ efetivo: [], travadas: ["app.acertos.ver", "app.chat.usar"] });
    await expect(rodar(guard, ctx(ClasseExige, "livre"))).resolves.toBe(true);
    await expect(rodar(guard, ctx(ClasseExige, "publico"))).resolves.toBe(true);
    await expect(rodar(guard, ctx(ForaDoApp, "algo"))).resolves.toBe(true);
  });
  it("token de admin ou de identidade pura (os @Roles de cada controller cuidam)", async () => {
    const { guard } = guardCom({ efetivo: [], travadas: ["app.acertos.ver"] });
    await expect(rodar(guard, ctx(ClasseExige, "ver", "ADMIN_USER"))).resolves.toBe(true);
    await expect(rodar(guard, ctx(ClasseExige, "ver", "IDENTIDADE"))).resolves.toBe(true);
  });
});
