import fs from "node:fs";
import path from "node:path";
import type { Rota } from "./rotas";
import { API } from "./ambiente";

/**
 * Formulários de página (criar/editar) cobertos pela fatia 6. Os ids vêm do seed (`.stack/seed-ids.json`);
 * o abastecimento não está lá: usa `UX_ABASTECIMENTO` ou o primeiro que a API devolver.
 */
function ids(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, ".stack", "seed-ids.json"), "utf8"));
  } catch {
    return {};
  }
}

/** O seed não grava o id do abastecimento (e os ids mudam a cada seed): pergunta pra API, só leitura. */
async function idDoAbastecimento(): Promise<string> {
  const seed = ids();
  const login = await fetch(`${API}/admin/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: seed.adminEmail, senha: seed.senha }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const r = await fetch(`${API}/admin/abastecimentos?pageSize=1`, { headers: { authorization: `Bearer ${accessToken}` } });
  const j = (await r.json()) as { data: { id: string }[] };
  return j.data[0]!.id;
}

export async function rotasDeFormulario(): Promise<Rota[]> {
  const s = ids();
  const abastecimento = process.env.UX_ABASTECIMENTO ?? (await idDoAbastecimento());
  const id = (k: string) => s[k] ?? "00000000-0000-0000-0000-000000000000";
  return [
    { id: "motorista-novo", rotulo: "Motorista (novo)", url: "/motoristas/novo" },
    { id: "motorista-editar", rotulo: "Motorista (editar)", url: `/motoristas/${id("motorista")}/editar` },
    { id: "veiculo-novo", rotulo: "Veículo (novo)", url: "/veiculos/novo" },
    { id: "cliente-novo", rotulo: "Cliente (novo)", url: "/clientes/novo" },
    { id: "local-novo", rotulo: "Local (novo)", url: "/locais/novo" },
    { id: "abastecimento-editar", rotulo: "Abastecimento (editar)", url: `/abastecimentos/${abastecimento}/editar` },
    { id: "empresa-novo", rotulo: "Empresa (novo)", url: "/empresas/novo" },
    { id: "transportadora-novo", rotulo: "Transportadora (novo)", url: "/transportadoras/novo" },
    { id: "usuario-novo", rotulo: "Usuário (novo)", url: "/usuarios/novo" },
    { id: "envio-novo", rotulo: "Envio (novo)", url: "/envios/novo" },
  ];
}
