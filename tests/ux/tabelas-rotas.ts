import fs from "node:fs";
import path from "node:path";
import { API } from "./ambiente";
import type { Rota } from "./rotas";

/**
 * Telas com lista/tabela medidas e capturadas na fatia 5 (tabelas como cartões + filtros no celular).
 * `dataTable` = usa o <DataTable>; `crua` = <table> escrita à mão na tela.
 */
export interface RotaTabela extends Rota {
  tipo: "dataTable" | "crua";
}

const ARQUIVO_IDS = path.join(__dirname, ".stack", "seed-ids.json");
const seed: Record<string, string> = (() => {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_IDS, "utf8"));
  } catch {
    return {};
  }
})();
const id = (k: string) => seed[k] ?? "00000000-0000-0000-0000-000000000000";

/** ids que o seed-ids.json não traz: funcionário do ponto e fechamento (qualquer um serve). */
export async function idsExtras(): Promise<{ funcionario: string; fechamento: string }> {
  const r = await fetch(`${API}/admin/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: seed.adminEmail, senha: seed.senha }),
  });
  const t = (await r.json()) as { accessToken: string };
  const h = { authorization: `Bearer ${t.accessToken}` };
  const f = (await (await fetch(`${API}/admin/ponto/funcionarios?pageSize=1`, { headers: h })).json()) as { id: string }[];
  const fe = (await (await fetch(`${API}/admin/fechamentos?pageSize=1`, { headers: h })).json()) as { data: { id: string }[] };
  return { funcionario: f[0]?.id ?? "", fechamento: fe.data[0]?.id ?? "" };
}

export function rotasTabelas(extras: { funcionario: string; fechamento: string }): RotaTabela[] {
  const d = (idr: string, rotulo: string, url: string): RotaTabela => ({ id: idr, rotulo, url, tipo: "dataTable" });
  const c = (idr: string, rotulo: string, url: string): RotaTabela => ({ id: idr, rotulo, url, tipo: "crua" });
  return [
    d("viagens", "Viagens", "/viagens"),
    d("motoristas", "Motoristas", "/motoristas"),
    d("veiculos", "Veículos", "/veiculos"),
    d("clientes", "Clientes (obras)", "/clientes"),
    d("empresas", "Empresas (clientes)", "/empresas"),
    d("locais", "Locais", "/locais"),
    d("locais-em-validacao", "Locais em validação", "/locais/em-validacao"),
    d("local-viagens", "Local (viagens do local)", `/locais/${id("local")}`),
    d("materiais", "Materiais", "/materiais"),
    d("modalidades", "Modalidades", "/modalidades"),
    d("tipos-servico", "Tipos de serviço", "/tipos-servico"),
    d("transportadoras", "Transportadoras", "/transportadoras"),
    d("usuarios", "Usuários", "/usuarios"),
    d("abastecimentos", "Abastecimentos", "/abastecimentos"),
    d("acertos", "Acertos", "/acertos"),
    d("envios", "Envios", "/envios"),
    d("fechamentos", "Fechamentos", "/fechamentos"),
    d("pedagios-rodovia", "Pedágios de rodovia", "/pedagios-rodovia"),
    d("pedidos", "Pedidos", "/pedidos"),
    d("regras-minimo", "Regras de mínimo", "/regras-minimo"),
    d("tabelas-preco", "Tabelas de preço", "/tabelas-preco"),
    c("relatorios-viagens", "Relatório de viagens", "/relatorios/viagens"),
    c("relatorios-abastecimentos", "Relatório de abastecimentos", "/relatorios/abastecimentos"),
    c("relatorios-conferencia", "Relatório de conferência", "/relatorios/conferencia"),
    c("relatorios-consumo", "Relatório de consumo", "/relatorios/consumo"),
    c("local-ver", "Local (ver)", `/locais/${id("local")}/ver`),
    c("tipos-evento-viagem", "Tipos de evento da viagem", "/tipos-evento-viagem"),
    c("campos-layout", "Campos do layout", "/configuracoes/campos-layout"),
    c("ponto-espelho", "Espelho de ponto", `/ponto/espelho/${extras.funcionario}`),
    c("ponto-competencia", "Ponto (competência)", "/ponto/competencia"),
    c("erros", "Erros", "/erros"),
    c("notificacoes", "Notificações", "/notificacoes"),
    c("importacao", "Importação", "/importacao"),
    c("empresa-layout-envio", "Empresa (layout de envio)", `/empresas/${id("empresa")}/layout-envio`),
    c("empresa-layout-import", "Empresa (layout de importação)", `/empresas/${id("empresa")}/layout-import`),
    c("fechamento-detalhe", "Fechamento (linhas)", `/fechamentos/${extras.fechamento}`),
  ];
}
