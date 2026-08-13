import { test, expect, request as playwrightRequest } from "@playwright/test";

/**
 * O motorista que roda pra DUAS empresas não pode ver o dado de uma pela outra.
 *
 * Este é o caso que mais assusta no multi-empresa: é a MESMA PESSOA, com o mesmo
 * CPF, a mesma senha e o mesmo celular. Tudo convida a misturar — e misturar
 * aqui é o cliente A enxergando a operação do cliente B.
 *
 * Bate direto na API, como o irmão `isolamento-contas`: se o dado veio no JSON,
 * já vazou, mesmo que a tela não desenhe.
 *
 * Pré-requisitos (além dos do README):
 *   E2E_API_URL         (default http://localhost:3000)
 *   E2E_PLATAFORMA_EMAIL / E2E_PLATAFORMA_PASS  — criar empresa é ação de plataforma
 * Sem o usuário de plataforma o teste pula: é ambiente incompleto, não regressão.
 */

const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_PLATAFORMA_EMAIL ?? "admin@ronan.local";
const SENHA = process.env.E2E_PLATAFORMA_PASS ?? "ronan_admin_2026";

type Ctx = Awaited<ReturnType<typeof playwrightRequest.newContext>>;

async function loginAdmin(api: Ctx, email: string, senha: string): Promise<string | null> {
  const r = await api.post(`${API}/admin/auth/login`, { data: { email, senha } });
  if (!r.ok()) return null;
  return (await r.json()).accessToken as string;
}

async function criarEmpresa(api: Ctx, tokenPlataforma: string, nome: string, sufixo: string) {
  const r = await api.post(`${API}/admin/contas`, {
    headers: { authorization: `Bearer ${tokenPlataforma}` },
    data: {
      nome,
      adminNome: "Admin Teste",
      adminEmail: `motorista-iso-${sufixo}@exemplo.local`,
      adminSenha: "senha-de-teste-123",
    },
  });
  return { ok: r.ok(), status: r.status(), texto: await r.text(), email: `motorista-iso-${sufixo}@exemplo.local` };
}

/** CPF válido gerado a partir de uma base — o cadastro do painel valida os DVs. */
function cpfValido(base9: string): string {
  const nums = base9.split("").map(Number);
  const dv = (arr: number[]) => {
    const peso = arr.length + 1;
    const soma = arr.reduce((acc, n, i) => acc + n * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(nums);
  const d2 = dv([...nums, d1]);
  return `${base9}${d1}${d2}`;
}

test.describe("Motorista em duas empresas", () => {
  test("cada cadastro só enxerga a empresa dele", async () => {
    const api = await playwrightRequest.newContext();
    const tokenPlataforma = await loginAdmin(api, EMAIL, SENHA);
    test.skip(!tokenPlataforma, `Não consegui logar como ${EMAIL} — confira o seed.`);

    const sufixo = String(Date.now());
    const empresaA = await criarEmpresa(api, tokenPlataforma!, `Empresa A ${sufixo}`, `a${sufixo}`);
    test.skip(
      empresaA.status === 403,
      `${EMAIL} não é usuário de plataforma — o teste precisa de um pra criar empresa.`,
    );
    expect(empresaA.ok, `Falhou ao criar a empresa A: ${empresaA.texto}`).toBeTruthy();
    const empresaB = await criarEmpresa(api, tokenPlataforma!, `Empresa B ${sufixo}`, `b${sufixo}`);
    expect(empresaB.ok, `Falhou ao criar a empresa B: ${empresaB.texto}`).toBeTruthy();

    const adminA = (await loginAdmin(api, empresaA.email, "senha-de-teste-123"))!;
    const adminB = (await loginAdmin(api, empresaB.email, "senha-de-teste-123"))!;
    expect(adminA && adminB, "Os admins das empresas novas deveriam logar").toBeTruthy();

    // A MESMA pessoa, cadastrada nas duas empresas.
    const cpf = cpfValido(String(Date.now()).slice(-9));
    const SENHA_MOTORISTA = "motorista-teste-123";

    const criarA = await api.post(`${API}/admin/motoristas`, {
      headers: { authorization: `Bearer ${adminA}` },
      data: { nome: "Zé das Duas", cpf, senha: SENHA_MOTORISTA, placas: [] },
    });
    expect(criarA.ok(), `Cadastro na A falhou: ${await criarA.text()}`).toBeTruthy();

    // Na segunda empresa a senha NÃO é informada: ele já tem uma (é da pessoa).
    const checa = await api.get(`${API}/admin/motoristas/checar-cpf?cpf=${cpf}`, {
      headers: { authorization: `Bearer ${adminB}` },
    });
    expect(checa.ok()).toBeTruthy();
    expect(
      (await checa.json()).existeEmOutraEmpresa,
      "A empresa B precisa saber que o CPF já tem cadastro (pra não pedir senha)",
    ).toBe(true);

    const criarB = await api.post(`${API}/admin/motoristas`, {
      headers: { authorization: `Bearer ${adminB}` },
      data: { nome: "Zé das Duas", cpf, placas: [] },
    });
    expect(criarB.ok(), `Cadastro na B (sem senha) falhou: ${await criarB.text()}`).toBeTruthy();

    // Um material só da empresa B, pra servir de marcador no catálogo.
    const MARCADOR = `ZZMOTORISTA${sufixo}`;
    const material = await api.post(`${API}/admin/materiais`, {
      headers: { authorization: `Bearer ${adminB}` },
      data: { nome: `Material ${MARCADOR}` },
    });
    expect(material.ok(), await material.text()).toBeTruthy();

    // ---- Login do motorista: uma sessão por empresa ----
    const login = await api.post(`${API}/m/auth/login`, { data: { cpf, senha: SENHA_MOTORISTA } });
    expect(login.ok(), `Login do motorista falhou: ${await login.text()}`).toBeTruthy();
    const corpo = await login.json();

    // Formato antigo preservado — app que ainda não atualizou continua entrando.
    expect(corpo.accessToken, "o login precisa continuar devolvendo accessToken no topo").toBeTruthy();
    expect(Array.isArray(corpo.cadastros), "o login deve devolver a lista de empresas").toBe(true);
    expect(corpo.cadastros.length, "os DOIS cadastros deveriam vir").toBe(2);

    const cadastroA = corpo.cadastros.find((c: { contaNome: string }) =>
      c.contaNome.includes(`Empresa A ${sufixo}`),
    );
    const cadastroB = corpo.cadastros.find((c: { contaNome: string }) =>
      c.contaNome.includes(`Empresa B ${sufixo}`),
    );
    expect(cadastroA && cadastroB, "as duas empresas precisam aparecer com nome").toBeTruthy();
    expect(cadastroA.motoristaId).not.toBe(cadastroB.motoristaId);

    // ---- O catálogo de cada sessão é o da empresa dela ----
    const catA = await api.get(`${API}/m/catalogos`, {
      headers: { authorization: `Bearer ${cadastroA.accessToken}` },
    });
    expect(catA.ok(), await catA.text()).toBeTruthy();
    expect(
      await catA.text(),
      "VAZOU: o catálogo da empresa A trouxe material da empresa B",
    ).not.toContain(MARCADOR);

    const catB = await api.get(`${API}/m/catalogos`, {
      headers: { authorization: `Bearer ${cadastroB.accessToken}` },
    });
    expect(catB.ok()).toBeTruthy();
    expect(await catB.text(), "o material da B tem que aparecer PRA B").toContain(MARCADOR);

    // ---- Push: o aparelho é um só, a empresa ativa também ----
    const TOKEN_DEVICE = `ExponentPushToken[teste-${sufixo}]`;
    await api.post(`${API}/m/push-token`, {
      headers: { authorization: `Bearer ${cadastroA.accessToken}` },
      data: { token: TOKEN_DEVICE },
    });
    await api.post(`${API}/m/push-token`, {
      headers: { authorization: `Bearer ${cadastroB.accessToken}` },
      data: { token: TOKEN_DEVICE },
    });
    // Depois de registrar na B, a A não pode mais ter o token do aparelho —
    // senão as duas empresas empurram aviso na tela dele ao mesmo tempo.
    const motoristasA = await api.get(`${API}/admin/motoristas?page=1&pageSize=50`, {
      headers: { authorization: `Bearer ${adminA}` },
    });
    if (motoristasA.ok()) {
      const item = (await motoristasA.json()).items?.find(
        (m: { cpf: string }) => m.cpf === cpf,
      );
      expect(
        item?.temPushToken,
        "o cadastro da empresa A ficou com o push token depois de trocar pra B",
      ).toBeFalsy();
    }

    // ---- Trocar de empresa sem senha só vale entre cadastros do mesmo CPF ----
    const troca = await api.post(`${API}/m/auth/trocar-empresa`, {
      headers: { authorization: `Bearer ${cadastroA.accessToken}` },
      data: { motoristaId: cadastroB.motoristaId },
    });
    expect(troca.ok(), `Trocar de empresa falhou: ${await troca.text()}`).toBeTruthy();
    expect((await troca.json()).contaId).toBe(cadastroB.contaId);

    // Id de motorista que não é dele: 403, sem confirmar se existe.
    const trocaProibida = await api.post(`${API}/m/auth/trocar-empresa`, {
      headers: { authorization: `Bearer ${cadastroA.accessToken}` },
      data: { motoristaId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(trocaProibida.status(), "trocar pra cadastro de outra pessoa tem que ser barrado").toBe(403);

    // ---- A senha é da pessoa: trocar numa empresa vale nas duas ----
    const NOVA = "motorista-teste-456";
    const trocaSenha = await api.post(`${API}/m/auth/trocar-senha`, {
      headers: { authorization: `Bearer ${cadastroA.accessToken}` },
      data: { senhaAtual: SENHA_MOTORISTA, novaSenha: NOVA },
    });
    expect(trocaSenha.ok(), await trocaSenha.text()).toBeTruthy();

    const loginNovo = await api.post(`${API}/m/auth/login`, { data: { cpf, senha: NOVA } });
    expect(loginNovo.ok(), "a senha nova tem que valer").toBeTruthy();
    expect(
      (await loginNovo.json()).cadastros.length,
      "a senha nova tem que abrir as DUAS empresas — senão ele fica trancado numa",
    ).toBe(2);

    // Limpeza: suspende as empresas de teste (não apaga — histórico fica).
    const contas = await api.get(`${API}/admin/contas`, {
      headers: { authorization: `Bearer ${tokenPlataforma}` },
    });
    if (contas.ok()) {
      // Lê o corpo UMA vez: response já consumida não pode ser lida de novo.
      const lista = (await contas.json()) as Array<{ id: string; nome: string }>;
      for (const nome of [`Empresa A ${sufixo}`, `Empresa B ${sufixo}`]) {
        const criada = lista.find((c) => c.nome === nome);
        if (criada) {
          await api.patch(`${API}/admin/contas/${criada.id}/ativa`, {
            headers: { authorization: `Bearer ${tokenPlataforma}` },
            data: { ativa: false },
          });
        }
      }
    }

    await api.dispose();
  });
});
