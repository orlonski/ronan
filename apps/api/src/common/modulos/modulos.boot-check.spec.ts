import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { MetadataScanner, Reflector } from "@nestjs/core";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { Public } from "../../auth/decorators/public.decorator";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { ModulosBootCheck } from "./modulos.boot-check";

function rodar(...classes: (new () => object)[]) {
  const discovery = {
    getControllers: () => classes.map((c) => ({ instance: new c(), metatype: c })),
  };
  new ModulosBootCheck(discovery as never, new MetadataScanner(), new Reflector()).onModuleInit();
}

describe("boot-check dos módulos", () => {
  it("pega handler admin sem permissão em controller `admin/*`", () => {
    @Controller("admin/x")
    class C {
      @Roles("ADMIN_USER") @Get() lista() {}
    }
    expect(() => rodar(C)).toThrow(/C\.lista/);
  });

  it("pega handler de ADMIN_USER em `@Controller()` sem prefixo (caminho no handler)", () => {
    // O ponto cego: `WhatsappController` e `EventosController` declaravam
    // `@Get("admin/whatsapp/...")` no handler, o prefixo do controller era "" e
    // a varredura por prefixo pulava a classe inteira.
    @Controller()
    class Whatsapp {
      @Roles("ADMIN_USER") @Get("admin/whatsapp/qrcode") qrcodeDoBoot() {}
    }
    expect(() => rodar(Whatsapp)).toThrow(/Whatsapp\.qrcodeDoBoot/);
  });

  it("pega handler de ADMIN_USER em prefixo qualquer (`errors`)", () => {
    @Controller("errors")
    class Erros {
      @Roles("ADMIN_USER") @Get() listaDeErros() {}
    }
    expect(() => rodar(Erros)).toThrow(/Erros\.listaDeErros/);
  });

  it("não cobra permissão de rota de motorista nem pública", () => {
    @Controller("m/coisa")
    class Motorista {
      @Roles("MOTORISTA") @Get() lista() {}
    }
    @Controller()
    class Publica {
      @Public() @Get("publico/x") x() {}
    }
    expect(() => rodar(Motorista, Publica)).not.toThrow();
  });

  it("aceita handler com permissão de recurso que pertence a módulo", () => {
    @Controller()
    class Ok {
      @Roles("ADMIN_USER") @RequerPermissao("ponto.ver") @Get("admin/ok") ok() {}
    }
    expect(() => rodar(Ok)).not.toThrow();
  });

  it("aceita controller fechado por PlataformaGuard", () => {
    @UseGuards(PlataformaGuard)
    @Controller("admin/plataforma")
    class Fechado {
      @Roles("ADMIN_USER") @Get() x() {}
    }
    expect(() => rodar(Fechado)).not.toThrow();
  });

  it("pega permissão que não pertence a módulo nenhum", () => {
    @Controller("admin/y")
    class Orfa {
      @Roles("ADMIN_USER") @RequerPermissao("recurso-que-nao-existe.ver") @Get() y() {}
    }
    expect(() => rodar(Orfa)).toThrow(/recurso-que-nao-existe/);
  });
});
