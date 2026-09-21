import { describe, expect, it, vi } from "vitest";
import { AppUpdateNotifierService } from "./app-update-notifier.service";
import { contaAtual } from "../../common/conta/conta-context";

/**
 * O AVISO DE VERSÃO NOVA PRECISA RODAR SEM CONTA NO CONTEXTO.
 *
 * ⚠️ Quem chama é `POST /app/deploy/nova-versao`, disparado pelo comando de
 * publicar o OTA. É `@Public()` e se autentica por segredo de header, então
 * não existe conta no contexto — e a trava multi-tenant lança no `findMany`.
 *
 * O defeito era INVISÍVEL: o script de publicar avisa em amarelo e sai com
 * código 0, de propósito, pra uma falha no aviso nunca derrubar um OTA que já
 * foi publicado. Resultado: o endpoint respondia 500, os motoristas deixaram
 * de ser avisados de versão nova, e o único sinal era uma linha amarela no fim
 * de um comando de deploy.
 *
 * Este teste simula a trava: o fake do Prisma RECUSA qualquer consulta que
 * chegue sem conta no contexto, exatamente como o banco faz.
 */

function servico(motoristas: { id: string; expoPushToken: string | null }[]) {
  const enviados: string[] = [];

  const exigirContexto = () => {
    // A trava real deixa passar em dois casos: contexto com conta resolvida
    // (`modo: "request"`), ou contexto de sistema (`modo: "sistema"`, que é o
    // que `comoSistema` abre). Fora de qualquer contexto — que é onde uma rota
    // `@Public()` roda — ela lança.
    const ctx = contaAtual();
    const podeConsultar = ctx?.modo === "sistema" || Boolean(ctx?.contaId);
    if (!podeConsultar) {
      throw new Error("ContaAusenteError: consulta sem conta no contexto");
    }
  };

  const prisma = {
    motorista: {
      findMany: async () => {
        exigirContexto();
        return motoristas;
      },
    },
  };
  const push = {
    enviar: async ({ token }: { token: string }) => {
      exigirContexto();
      enviados.push(token);
      return { ok: true };
    },
  };

  return {
    s: new AppUpdateNotifierService(prisma as never, push as never),
    enviados,
  };
}

describe("avisar os motoristas do OTA", () => {
  it("roda sem conta no contexto — é rota pública", async () => {
    const { s, enviados } = servico([
      { id: "m1", expoPushToken: "tok-1" },
      { id: "m2", expoPushToken: "tok-2" },
    ]);
    const n = await s.notificarTodos();
    expect(n).toBe(2);
    expect(enviados).toEqual(["tok-1", "tok-2"]);
  });

  it("o ENVIO também roda dentro do contexto", async () => {
    // `push.enviar` lê a preferência do motorista e limpa token morto — se só
    // o `findMany` estivesse embrulhado, a lista viria e cada envio quebraria,
    // devolvendo "0 avisados" com a mesma cara de sucesso.
    const { s, enviados } = servico([{ id: "m1", expoPushToken: "tok-1" }]);
    await s.notificarTodos();
    expect(enviados).toHaveLength(1);
  });

  it("token repetido em dois cadastros vira UM push", async () => {
    // O mesmo aparelho em duas empresas não pode receber o aviso duas vezes.
    const { s, enviados } = servico([
      { id: "m1", expoPushToken: "mesmo" },
      { id: "m2", expoPushToken: "mesmo" },
      { id: "m3", expoPushToken: null },
    ]);
    const n = await s.notificarTodos();
    expect(n).toBe(1);
    expect(enviados).toEqual(["mesmo"]);
  });

  it("um token ruim não derruba os outros", async () => {
    const { s } = servico([{ id: "m1", expoPushToken: "tok-1" }]);
    const espiao = vi.spyOn(s as never, "push" as never, "get");
    espiao.mockReturnValue({
      enviar: async () => {
        throw new Error("token inválido");
      },
    } as never);
    await expect(s.notificarTodos()).resolves.toBe(0);
  });
});
