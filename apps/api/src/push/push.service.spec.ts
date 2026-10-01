import { describe, expect, it, vi } from "vitest";
import { PushService } from "./push.service";

/**
 * O push alcança a PESSOA, não o cadastro.
 *
 * O caso que motivou: o dono tinha cadastro de motorista em duas empresas,
 * excluiu um, e o que sobrou ficou sem token — o app gravava o token só no
 * cadastro da empresa ativa. O aviso entrava no sininho do app e o push nunca
 * chegava no celular.
 */
const T_PESSOA = "ExponentPushToken[pessoa]";
const T_OUTRO = "ExponentPushToken[outro-cadastro]";
const T_CADASTRO = "ExponentPushToken[cadastro]";

function montar(dados: {
  tokenCadastro?: string | null;
  tokenPessoa?: string | null;
  outros?: string[];
  ticket?: (token: string) => { status: "ok"; id: string } | { status: "error"; message: string; details?: { error: string } };
}) {
  const atualizarEntrega = vi.fn(async () => {});
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    motorista: {
      findUnique: vi.fn(async (q: { select: Record<string, boolean> }) =>
        q.select.aceitaPush
          ? { aceitaPush: true }
          : { identidadeId: "pessoa-1", cpf: "52998224725", expoPushToken: dados.tokenCadastro ?? null },
      ),
      findMany: vi.fn(async () => (dados.outros ?? []).map((t) => ({ expoPushToken: t }))),
      updateMany,
    },
    motoristaIdentidade: {
      findFirst: vi.fn(async () => ({ expoPushToken: dados.tokenPessoa ?? null })),
      updateMany,
    },
  };
  const notificacoes = {
    registrar: vi.fn(async () => ({ id: "notif-1" })),
    atualizarEntrega,
  };
  const s = new PushService(prisma as never, notificacoes as never);
  const enviados: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  (s as unknown as { expo: unknown }).expo = {
    sendPushNotificationsAsync: vi.fn(async ([m]: [{ to: string }]) => {
      enviados.push(m.to);
      payloads.push((m as unknown as { data: Record<string, unknown> }).data);
      return [dados.ticket ? dados.ticket(m.to) : { status: "ok", id: `t-${m.to}` }];
    }),
    getPushNotificationReceiptsAsync: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { status: "ok" }])),
    ),
  };
  vi.useFakeTimers();
  return { s, enviados, payloads, atualizarEntrega, updateMany };
}

async function enviar(s: PushService, token: string) {
  const p = s.enviar({ motoristaId: "m-1", token, titulo: "t", corpo: "c" });
  await vi.runAllTimersAsync();
  return p;
}

describe("PushService — alcança a pessoa, não o cadastro", () => {
  it("cadastro SEM token: chega pelo token da pessoa (o caso do dono)", async () => {
    const { s, enviados, atualizarEntrega } = montar({ tokenCadastro: null, tokenPessoa: T_PESSOA });
    const r = await enviar(s, "");
    expect(r.enviado).toBe(true);
    expect(enviados).toEqual([T_PESSOA]);
    expect(atualizarEntrega).toHaveBeenLastCalledWith("notif-1", { entregaStatus: "ENTREGUE" });
  });

  it("chega pelo token de outro cadastro da mesma pessoa (outra empresa)", async () => {
    const { s, enviados } = montar({ tokenCadastro: null, tokenPessoa: null, outros: [T_OUTRO] });
    expect((await enviar(s, "")).enviado).toBe(true);
    expect(enviados).toEqual([T_OUTRO]);
  });

  it("mesmo aparelho em vários lugares: um push só", async () => {
    const { s, enviados } = montar({ tokenCadastro: T_CADASTRO, tokenPessoa: T_CADASTRO, outros: [T_CADASTRO] });
    await enviar(s, T_CADASTRO);
    expect(enviados).toEqual([T_CADASTRO]);
  });

  it("aparelhos diferentes: vai pra todos", async () => {
    const { s, enviados } = montar({ tokenCadastro: T_CADASTRO, tokenPessoa: T_PESSOA, outros: [T_OUTRO] });
    await enviar(s, T_CADASTRO);
    expect(new Set(enviados)).toEqual(new Set([T_CADASTRO, T_PESSOA, T_OUTRO]));
  });

  it("nenhum aparelho: grava na central e diz o porquê", async () => {
    const { s, enviados, atualizarEntrega } = montar({ tokenCadastro: null, tokenPessoa: null });
    const r = await enviar(s, "");
    expect(r.enviado).toBe(false);
    expect(enviados).toEqual([]);
    expect(atualizarEntrega).toHaveBeenCalledWith("notif-1", { entregaStatus: "ERRO", entregaErro: "SemAparelho" });
  });

  it("aparelho que não existe mais sai de todo lugar, e o outro ainda recebe", async () => {
    const { s, enviados, updateMany } = montar({
      tokenCadastro: T_CADASTRO,
      tokenPessoa: T_PESSOA,
      ticket: (t) =>
        t === T_CADASTRO
          ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
          : { status: "ok", id: `t-${t}` },
    });
    const r = await enviar(s, T_CADASTRO);
    expect(r.enviado).toBe(true);
    expect(enviados).toEqual([T_CADASTRO, T_PESSOA]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { expoPushToken: T_CADASTRO },
      data: { expoPushToken: null, pushTokenAtualizadoEm: null },
    });
  });

  it("todo push diz de qual cadastro é — o toque troca pra empresa certa", async () => {
    const { s, payloads } = montar({ tokenCadastro: T_CADASTRO, tokenPessoa: T_PESSOA });
    await enviar(s, T_CADASTRO);
    expect(payloads).toHaveLength(2);
    for (const d of payloads) expect(d).toMatchObject({ paraCadastro: "m-1", notificacaoId: "notif-1" });
  });
});
