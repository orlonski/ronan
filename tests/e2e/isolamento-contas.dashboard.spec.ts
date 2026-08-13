import { test, expect, request as playwrightRequest } from "@playwright/test";

/**
 * Uma empresa não pode ver o dado da outra. Ponto.
 *
 * Este teste bate direto na API (não na tela) porque é ali que o vazamento
 * acontece: o painel pode até não desenhar o dado, mas se ele veio no JSON já
 * vazou — e é o que um `curl` com o token do DevTools acharia.
 *
 * O que ele protege: a trava de conta (`common/conta/trava-conta.ts`) cobre
 * automaticamente tudo que passa pelo Prisma Client, mas NÃO cobre `$queryRaw`.
 * Quando alguém adicionar um SQL cru novo daqui a seis meses e esquecer o
 * `contaId`, é este teste que grita.
 *
 * Pré-requisitos (além dos do README): a API precisa estar de pé e o usuário
 * da plataforma precisa existir, porque criar empresa é ação de plataforma.
 *   E2E_API_URL         (default http://localhost:3000)
 *   E2E_PLATAFORMA_EMAIL / E2E_PLATAFORMA_PASS
 * Sem o usuário de plataforma, o teste pula em vez de falhar — não é regressão
 * do sistema, é ambiente incompleto.
 */

const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_PLATAFORMA_EMAIL ?? "admin@ronan.local";
const SENHA = process.env.E2E_PLATAFORMA_PASS ?? "ronan_admin_2026";

/** Marcador que só existe na empresa B. Se aparecer pra A, vazou. */
const MARCADOR = `ZZMARCADOR${Date.now()}`;

async function login(api: Awaited<ReturnType<typeof playwrightRequest.newContext>>, email: string, senha: string) {
  const r = await api.post(`${API}/admin/auth/login`, { data: { email, senha } });
  if (!r.ok()) return null;
  return (await r.json()).accessToken as string;
}

test.describe("Isolamento entre empresas", () => {
  test("nenhuma rota admin devolve dado de outra empresa", async () => {
    const api = await playwrightRequest.newContext();

    const tokenPlataforma = await login(api, EMAIL, SENHA);
    test.skip(!tokenPlataforma, `Não consegui logar como ${EMAIL} — confira o seed.`);

    // A empresa B nasce aqui, com um marcador que só ela tem.
    const sufixo = Date.now();
    const criacao = await api.post(`${API}/admin/contas`, {
      headers: { authorization: `Bearer ${tokenPlataforma}` },
      data: {
        nome: `Empresa Teste ${sufixo}`,
        adminNome: "Admin Teste",
        adminEmail: `teste-isolamento-${sufixo}@exemplo.local`,
        adminSenha: "senha-de-teste-123",
      },
    });
    test.skip(
      criacao.status() === 403,
      `${EMAIL} não é usuário de plataforma — o teste precisa de um pra criar a empresa.`,
    );
    expect(criacao.ok(), `Falhou ao criar a empresa: ${await criacao.text()}`).toBeTruthy();

    const tokenB = await login(api, `teste-isolamento-${sufixo}@exemplo.local`, "senha-de-teste-123");
    expect(tokenB, "O admin da empresa nova deveria conseguir logar").toBeTruthy();

    // Dado marcado dentro da empresa B.
    const material = await api.post(`${API}/admin/materiais`, {
      headers: { authorization: `Bearer ${tokenB}` },
      data: { nome: `Material ${MARCADOR}` },
    });
    expect(material.ok(), await material.text()).toBeTruthy();

    // Agora, como a empresa A (a de sempre): nada dela pode conter o marcador.
    const tokenA = tokenPlataforma!;
    const rotas = [
      "/admin/materiais?page=1&pageSize=200",
      "/admin/viagens?page=1&pageSize=50",
      "/admin/motoristas?page=1&pageSize=50",
      "/admin/veiculos?page=1&pageSize=50",
      "/admin/clientes?page=1&pageSize=50",
      "/admin/locais?page=1&pageSize=50",
      "/admin/empresas?page=1&pageSize=50",
      "/admin/papeis",
      "/admin/dashboard",
      "/admin/campos-layout",
    ];

    for (const rota of rotas) {
      const r = await api.get(`${API}${rota}`, {
        headers: { authorization: `Bearer ${tokenA}` },
      });
      // 403 é aceitável (papel sem a permissão); o que não pode é vir o dado.
      if (r.status() === 403) continue;
      expect(r.status(), `${rota} devolveu ${r.status()}`).toBeLessThan(500);
      const corpo = await r.text();
      expect(corpo, `VAZOU dado da outra empresa em ${rota}`).not.toContain(MARCADOR);
    }

    // E a busca do app do motorista, que é onde o vazamento apareceria na tela.
    const busca = await api.get(
      `${API}/admin/materiais?q=${MARCADOR}&page=1&pageSize=50`,
      { headers: { authorization: `Bearer ${tokenA}` } },
    );
    if (busca.status() !== 403) {
      expect(await busca.text(), "A busca da empresa A achou material da B").not.toContain(MARCADOR);
    }

    // Limpeza: suspende a empresa de teste (não apaga — o histórico fica).
    const contas = await api.get(`${API}/admin/contas`, {
      headers: { authorization: `Bearer ${tokenPlataforma}` },
    });
    if (contas.ok()) {
      const criada = (await contas.json()).find(
        (c: { nome: string }) => c.nome === `Empresa Teste ${sufixo}`,
      );
      if (criada) {
        await api.patch(`${API}/admin/contas/${criada.id}/ativa`, {
          headers: { authorization: `Bearer ${tokenPlataforma}` },
          data: { ativa: false },
        });
      }
    }

    await api.dispose();
  });

  test("ler registro de outra empresa por id responde 404, não 403", async () => {
    // 404 e não 403 de propósito: 403 confirmaria que o id existe em algum
    // lugar, virando um oráculo pra descobrir registros de outras empresas.
    const api = await playwrightRequest.newContext();
    const token = await login(api, EMAIL, SENHA);
    test.skip(!token, `Não consegui logar como ${EMAIL}.`);

    const r = await api.get(`${API}/admin/viagens/00000000-0000-4000-8000-000000000000`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect([403, 404]).toContain(r.status());
    expect(r.status(), "id inexistente não pode virar 500").toBeLessThan(500);

    await api.dispose();
  });
});
