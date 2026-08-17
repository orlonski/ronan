import { describe, it, expect, vi } from "vitest";
import { RoteamentoWhatsappService } from "./roteamento.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import type { PrismaService } from "../../prisma/prisma.service";

function servico(linha: { rotas?: unknown; telefonesTeste?: string[] } | null) {
  const findFirst = vi.fn(async () => linha);
  const prisma = {
    configuracaoRoteamentoWhatsapp: { findFirst },
  } as unknown as PrismaService;
  return { s: new RoteamentoWhatsappService(prisma), findFirst };
}

const naConta = <T>(fn: () => Promise<T>) => comConta("conta-1", fn);

describe("RoteamentoWhatsappService", () => {
  it("sem nada configurado, tudo vai pelo padrão", async () => {
    const { s } = servico(null);
    const r = await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    expect(r.provedor).toBe("evolution");
    expect(r.motivo).toBe("padrão do sistema");
  });

  it("respeita a escolha gravada pra empresa", async () => {
    const { s } = servico({ rotas: { RESUMO_MOTORISTA: "meta" } });
    const r = await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    expect(r.provedor).toBe("meta");
  });

  it("grupo vai pro Evolution mesmo gravado como meta — não é escolha", async () => {
    // A Cloud API não posta em grupo. Se isso virasse configuração, o aviso de
    // motorista novo simplesmente sumiria no dia em que alguém trocasse a rota.
    const { s } = servico({ rotas: { AVISO_GRUPO: "meta" } });
    const r = await naConta(() => s.resolver({ rota: "AVISO_GRUPO", destinoEhGrupo: true }));
    expect(r.provedor).toBe("evolution");
    expect(r.motivo).toContain("grupo");
  });

  it("ignora provedor que o catálogo diz não atender a rota", async () => {
    const { s } = servico({ rotas: { AVISO_GRUPO: "meta" } });
    // Mesmo sem marcar como grupo, o catálogo do AVISO_GRUPO só aceita evolution.
    const r = await naConta(() => s.resolver({ rota: "AVISO_GRUPO", destinoEhGrupo: false }));
    expect(r.provedor).toBe("evolution");
    expect(r.motivo).toBe("padrão do sistema");
  });

  it("telefone na allowlist sai pelo provedor novo antes da rota virar", async () => {
    const { s } = servico({ rotas: {}, telefonesTeste: ["5541999998888"] });
    const r = await naConta(() =>
      s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false, telefone: "5541999998888" }),
    );
    expect(r.provedor).toBe("meta");
    expect(r.motivo).toContain("allowlist");
  });

  it("telefone fora da allowlist não muda de provedor", async () => {
    const { s } = servico({ rotas: {}, telefonesTeste: ["5541999998888"] });
    const r = await naConta(() =>
      s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false, telefone: "5541000000000" }),
    );
    expect(r.provedor).toBe("evolution");
  });

  it("SEM CONTA no contexto não explode — é o caminho do código de senha", async () => {
    // `redefinicao-senha` resolve o CPF dentro de comoSistema, então mandar o
    // código roda sem conta. Ler a config com contaIdAtual() aqui transformaria
    // um endpoint público de login num 500.
    const { s, findFirst } = servico({ rotas: { OTP_SENHA: "meta" } });
    const r = await comoSistema(() => s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    expect(r.provedor).toBe("evolution");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("banco fora do ar cai no padrão em vez de derrubar o envio", async () => {
    const findFirst = vi.fn(async () => {
      throw new Error("conexão recusada");
    });
    const prisma = {
      configuracaoRoteamentoWhatsapp: { findFirst },
    } as unknown as PrismaService;
    const s = new RoteamentoWhatsappService(prisma);
    const r = await naConta(() => s.resolver({ rota: "OTP_CADASTRO", destinoEhGrupo: false }));
    expect(r.provedor).toBe("evolution");
  });

  it("cacheia a leitura — o cron do resumo resolve rota por motorista, em loop", async () => {
    const { s, findFirst } = servico({ rotas: {} });
    await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    await naConta(() => s.resolver({ rota: "AVISO_PESO", destinoEhGrupo: false }));
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("invalidar força a releitura, pra virar a rota valer quase na hora", async () => {
    const { s, findFirst } = servico({ rotas: {} });
    await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    s.invalidar("conta-1");
    await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
