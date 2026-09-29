import fs from "node:fs";
import path from "node:path";

/**
 * Rotas representativas medidas pela suíte de UX. `id` é a chave no orçamento e no nome do
 * screenshot; `url` sai do seed (tests/ux/stack/seed.cjs grava .stack/seed-ids.json).
 * Só GET: nada aqui clica em ação destrutiva.
 */
export interface Rota {
  id: string;
  rotulo: string;
  url: string;
  /** Quem abre a tela. Default `admin`; `super` = super admin da plataforma. */
  usuario?: "admin" | "super";
}

const ARQUIVO_IDS = path.join(__dirname, ".stack", "seed-ids.json");

function ids(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_IDS, "utf8"));
  } catch {
    // Sem stack: o arquivo é lido em tempo de carga do spec; o erro amigável vem no fixture.
    return {};
  }
}

const seed = ids();
const id = (k: string) => seed[k] ?? "00000000-0000-0000-0000-000000000000";

export const ROTAS: Rota[] = [
  { id: "home", rotulo: "Início", url: "/" },
  { id: "viagens", rotulo: "Viagens", url: "/viagens" },
  { id: "motoristas", rotulo: "Motoristas (lista)", url: "/motoristas" },
  { id: "motorista-detalhe", rotulo: "Motorista (ficha)", url: `/motoristas/${id("motorista")}` },
  { id: "motorista-editar", rotulo: "Motorista (editar)", url: `/motoristas/${id("motorista")}/editar` },
  { id: "veiculos", rotulo: "Veículos", url: "/veiculos" },
  { id: "clientes", rotulo: "Clientes", url: "/clientes" },
  { id: "local-detalhe", rotulo: "Local (detalhe)", url: `/locais/${id("local")}` },
  { id: "relatorios", rotulo: "Relatórios", url: "/relatorios" },
  { id: "programacao", rotulo: "Programação", url: "/programacao" },
  { id: "torre", rotulo: "Torre de controle", url: "/torre" },
  { id: "ponto", rotulo: "Ponto", url: "/ponto" },
  { id: "conferencia-diaria-config", rotulo: "Configuração da conferência diária", url: "/configuracoes/conferencia-diaria" },
  { id: "whatsapp", rotulo: "WhatsApp", url: "/whatsapp", usuario: "super" },
];
