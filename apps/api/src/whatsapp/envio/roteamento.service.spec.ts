import { describe, it, expect, vi } from "vitest";
import { RoteamentoWhatsappService } from "./roteamento.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import type { PrismaService } from "../../prisma/prisma.service";

function servico(
  linha: { rotas?: unknown; telefonesTeste?: string[] } | null,
  plataforma: { rotas?: unknown } | null = null,
) {
  const findFirst = vi.fn(async () => linha);
  const findUnique = vi.fn(async () => plataforma);
  const prisma = {
    configuracaoRoteamentoWhatsapp: { findFirst },
    configuracaoRoteamentoPlataforma: { findUnique },
  } as unknown as PrismaService;
  return { s: new RoteamentoWhatsappService(prisma), findFirst, findUnique };
}

const naConta = <T>(fn: () => Promise<T>) => comConta("conta-1", fn);

describe("rota da empresa", () => {
  it("sem nada configurado, vai pelo padrão — que hoje é a Meta", async () => {
    // Era `evolution`. Virou `meta` quando o número do Evolution foi banido: o
    // padrão antigo passaria a fazer toda transportadora NOVA nascer apontada
    // pra um canal morto, sem ninguém mexer em nada.
    const { s } = servico(null);
    const r = await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    expect(r.provedor).toBe("meta");
    expect(r.motivo).toBe("padrão do sistema");
  });

  it("respeita a escolha gravada pra empresa", async () => {
    const { s } = servico({ rotas: { RESUMO_MOTORISTA: "evolution" } });
    const r = await naConta(() => s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }));
    expect(r.provedor).toBe("evolution");
    expect(r.motivo).toContain("empresa");
  });

  it("cada empresa pode estar num provedor diferente — é o que permite migrar uma de cada vez", async () => {
    const { s: a } = servico({ rotas: { RESUMO_MOTORISTA: "evolution" } });
    const { s: b } = servico({ rotas: { RESUMO_MOTORISTA: "meta" } });
    const ra = await comConta("conta-a", () =>
      a.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }),
    );
    const rb = await comConta("conta-b", () =>
      b.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false }),
    );
    expect([ra.provedor, rb.provedor]).toEqual(["evolution", "meta"]);
  });
});

describe("rota da plataforma", () => {
  /**
   * O bug que isto impede, encontrado em produção em 21/08/2026: a senha é da
   * PESSOA e propaga por todos os cadastros do CPF, mas o roteamento era da
   * EMPRESA. Um motorista com cadastro em duas transportadoras redefinindo a
   * mesma senha recebia o código por caminhos diferentes conforme qual cadastro
   * vencia o desempate — e por um canal morto se a empresa sorteada ainda
   * estivesse no Evolution.
   */
  it("ignora a escolha da empresa e usa a da plataforma", async () => {
    const { s } = servico(
      { rotas: { OTP_SENHA: "evolution" } },
      { rotas: { OTP_SENHA: "meta" } },
    );
    const r = await naConta(() => s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    expect(r.provedor).toBe("meta");
    expect(r.motivo).toContain("plataforma");
  });

  it("duas empresas em provedores diferentes dão a MESMA resposta", async () => {
    const { s: a } = servico({ rotas: { OTP_SENHA: "evolution" } }, { rotas: { OTP_SENHA: "meta" } });
    const { s: b } = servico({ rotas: { OTP_SENHA: "meta" } }, { rotas: { OTP_SENHA: "meta" } });
    const ra = await comConta("conta-a", () => a.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    const rb = await comConta("conta-b", () => b.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    expect(ra.provedor).toBe(rb.provedor);
  });

  it("nem lê a config da empresa — não é só empate, é escopo", async () => {
    const { s, findFirst } = servico({ rotas: {} }, { rotas: { OTP_CADASTRO: "meta" } });
    await naConta(() => s.resolver({ rota: "OTP_CADASTRO", destinoEhGrupo: false }));
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("allowlist de teste da empresa não desvia rota de plataforma", async () => {
    // Senão dava pra fazer UM motorista receber o código por outro caminho,
    // que é exatamente a incoerência que o escopo existe pra matar.
    const { s } = servico(
      { rotas: {}, telefonesTeste: ["5541999998888"] },
      { rotas: { OTP_SENHA: "meta" } },
    );
    const r = await naConta(() =>
      s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false, telefone: "5541999998888" }),
    );
    expect(r.motivo).toContain("plataforma");
  });

  it("sem linha de plataforma cai no padrão", async () => {
    const { s } = servico({ rotas: {} }, null);
    const r = await naConta(() => s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    expect(r.provedor).toBe("meta");
    expect(r.motivo).toBe("padrão da plataforma");
  });

  it("SEM CONTA no contexto resolve igual — é o caminho do código de senha", async () => {
    // `redefinicao-senha` resolve o CPF dentro de comoSistema. Antes, rodar sem
    // conta devolvia config vazia e caía no padrão; agora a resposta é a mesma
    // COM e SEM conta, que é o ponto.
    const { s } = servico({ rotas: { OTP_SENHA: "evolution" } }, { rotas: { OTP_SENHA: "meta" } });
    const semConta = await comoSistema(() => s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    const comConta_ = await naConta(() => s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    expect(semConta.provedor).toBe(comConta_.provedor);
  });

  it("banco fora do ar cai no padrão em vez de derrubar o login", async () => {
    const findUnique = vi.fn(async () => {
      throw new Error("conexão recusada");
    });
    const prisma = {
      configuracaoRoteamentoWhatsapp: { findFirst: vi.fn() },
      configuracaoRoteamentoPlataforma: { findUnique },
    } as unknown as PrismaService;
    const s = new RoteamentoWhatsappService(prisma);
    const r = await naConta(() => s.resolver({ rota: "OTP_CADASTRO", destinoEhGrupo: false }));
    expect(r.provedor).toBe("meta");
  });

  it("cacheia, e invalidarPlataforma força releitura", async () => {
    const { s, findUnique } = servico({ rotas: {} }, { rotas: { OTP_SENHA: "meta" } });
    await naConta(() => s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    await naConta(() => s.resolver({ rota: "OTP_CADASTRO", destinoEhGrupo: false }));
    expect(findUnique).toHaveBeenCalledOnce();
    s.invalidarPlataforma();
    await naConta(() => s.resolver({ rota: "OTP_SENHA", destinoEhGrupo: false }));
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("travas que não são configuração", () => {
  it("grupo vai pro Evolution mesmo gravado como meta", async () => {
    // A Cloud API não posta em grupo. Se isso virasse configuração, o aviso de
    // motorista novo simplesmente sumiria no dia em que alguém trocasse a rota.
    const { s } = servico({ rotas: { AVISO_GRUPO: "meta" } });
    const r = await naConta(() => s.resolver({ rota: "AVISO_GRUPO", destinoEhGrupo: true }));
    expect(r.provedor).toBe("evolution");
    expect(r.motivo).toContain("grupo");
  });

  it("ignora provedor que o catálogo diz não atender a rota", async () => {
    const { s } = servico({ rotas: { AVISO_GRUPO: "meta" } });
    const r = await naConta(() => s.resolver({ rota: "AVISO_GRUPO", destinoEhGrupo: false }));
    expect(r.provedor).toBe("evolution");
  });
});

describe("allowlist de teste", () => {
  it("aponta pra META, não pra 'o outro provedor'", async () => {
    // Eram a mesma coisa enquanto o padrão era o Evolution. Viraram opostos no
    // dia em que o padrão mudou: "o outro" passaria a significar o canal banido.
    const { s } = servico({ rotas: { RESUMO_MOTORISTA: "evolution" }, telefonesTeste: ["5541999998888"] });
    const r = await naConta(() =>
      s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false, telefone: "5541999998888" }),
    );
    expect(r.provedor).toBe("meta");
    expect(r.motivo).toContain("allowlist");
  });

  it("telefone fora da allowlist segue a rota da empresa", async () => {
    const { s } = servico({ rotas: { RESUMO_MOTORISTA: "evolution" }, telefonesTeste: ["5541999998888"] });
    const r = await naConta(() =>
      s.resolver({ rota: "RESUMO_MOTORISTA", destinoEhGrupo: false, telefone: "5541000000000" }),
    );
    expect(r.provedor).toBe("evolution");
  });
});

describe("cache por conta", () => {
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
