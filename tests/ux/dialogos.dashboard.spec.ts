import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, abrirRota, estabilizar, entrarComo } from "./ambiente";

/**
 * Janelas do painel (Leva 1, fatia 3): abre cada diálogo/folha PELO GATILHO REAL (botão), captura e mede.
 * Só abre e olha: NUNCA confirma nada (e o contexto já aborta qualquer escrita).
 *
 * `UX_FASE=antes|depois` escolhe a pasta de saída (tests/ux/resultados/dialogos/<fase>/<viewport>/).
 * O `mobile` mede a folha de baixo; os outros três viewports gravam as mesmas capturas pra provar que
 * MacBook e ultrawide não mudaram (compare antes x depois com tests/ux/comparar-dialogos.py).
 */
// Captura pesada (minutos por viewport): fora do `pnpm ux`. Rode com `pnpm ux:janelas` (UX_FASE=antes|depois).
test.beforeEach(() => test.skip(!process.env.UX_JANELAS, "captura de janelas/banner: só com UX_JANELAS=1 (pnpm ux:janelas)"));
const FASE = process.env.UX_FASE ?? "depois";
const RAIZ = path.join(__dirname, "resultados", "dialogos", FASE);
const ids = JSON.parse(fs.readFileSync(path.join(__dirname, ".stack", "seed-ids.json"), "utf8")) as Record<string, string>;

type Abrir = (page: Page) => Promise<void>;
interface Cenario {
  id: string;
  url: string;
  usuario?: "admin" | "super";
  abrir: Abrir;
}
const botao = (nome: string | RegExp, nth = 0): Abrir => async (p) => {
  await p.getByRole("button", { name: nome }).nth(nth).click();
};
const linkOuBotao = (nome: string | RegExp): Abrir => async (p) => {
  await p.getByRole("button", { name: nome }).or(p.getByRole("link", { name: nome })).first().click();
};

export const CENARIOS: Cenario[] = [
  { id: "motoristas-convidar-cpf", url: "/motoristas", abrir: botao("Convidar por CPF") },
  { id: "motoristas-documentos", url: "/motoristas", abrir: botao("Documentos") },
  { id: "motoristas-push", url: "/motoristas", abrir: botao("Enviar notificação push") },
  { id: "motoristas-convite-whatsapp", url: "/motoristas", abrir: botao("Gerar convite WhatsApp") },
  { id: "motoristas-excluir", url: "/motoristas", abrir: botao(/Excluir o motorista/) },
  { id: "veiculos-excluir", url: "/veiculos", abrir: botao(/Excluir o veículo/) },
  { id: "veiculos-novo", url: "/veiculos", abrir: linkOuBotao("Novo veículo") },
  { id: "clientes-nova-obra", url: "/clientes", abrir: linkOuBotao("Nova obra") },
  { id: "locais-novo", url: "/locais", abrir: linkOuBotao("Novo local") },
  { id: "locais-excluir", url: "/locais", abrir: botao(/Excluir o local/) },
  { id: "locais-validacao-homologar", url: "/locais/em-validacao", abrir: botao("Homologar") },
  { id: "locais-validacao-mesclar", url: "/locais/em-validacao", abrir: botao("Mesclar") },
  { id: "torre-ocorrencia", url: "/torre", abrir: botao("Registrar ocorrência") },
  { id: "envios-novo", url: "/envios", abrir: linkOuBotao("Novo envio") },
  { id: "fechamentos-novo", url: "/fechamentos", abrir: linkOuBotao("Novo fechamento") },
  { id: "usuarios-novo", url: "/usuarios", abrir: linkOuBotao("Novo usuário") },
  { id: "permissoes-modelo", url: "/configuracoes/permissoes", abrir: botao("Usar um modelo") },
  { id: "permissoes-novo-papel", url: "/configuracoes/permissoes", abrir: botao("Novo papel") },
  { id: "permissoes-publicar-modelo", url: "/configuracoes/permissoes", abrir: botao("Publicar como modelo") },
  { id: "contas-modulos", url: "/contas", usuario: "super", abrir: botao("Módulos") },
  { id: "contas-ia", url: "/contas", usuario: "super", abrir: botao("Modelos de IA") },
  { id: "contas-teto", url: "/contas", usuario: "super", abrir: botao("Permissões liberadas") },
  { id: "contas-nova-empresa", url: "/contas", usuario: "super", abrir: linkOuBotao("Nova empresa") },
  { id: "contas-mensalidades", url: "/contas", usuario: "super", abrir: botao(/Mensalidades/) },
  { id: "contas-tabela-preco", url: "/contas", usuario: "super", abrir: botao(/Tabela de preço/) },
  { id: "contas-excluir", url: "/contas", usuario: "super", abrir: botao("Excluir", 0) },
  { id: "contas-permissoes-padrao", url: "/contas", usuario: "super", abrir: botao("Permissões padrão") },
  { id: "documentos-exigir", url: "/documentos-exigidos", abrir: botao("Exigir um documento") },
  { id: "motorista-enviar-pergunta", url: `/motoristas/${ids.motorista}`, abrir: botao("Enviar pergunta de teste") },
  { id: "motorista-ver-celular", url: `/motoristas/${ids.motorista}`, abrir: botao("Ver o celular dele") },
  { id: "motorista-gerar-link", url: `/motoristas/${ids.motorista}`, abrir: botao("Gerar link") },
  { id: "viagem-compartilhar", url: `/viagens/${ids.viagem}`, abrir: botao("Compartilhar") },
  { id: "viagem-excluir", url: `/viagens/${ids.viagem}`, abrir: botao("Excluir", 0) },
  { id: "viagem-escolher-rota", url: `/viagens/${ids.viagem}`, abrir: botao("Escolher a estrada") },
  { id: "viagem-mensagem-motorista", url: `/viagens/${ids.viagem}`, abrir: botao("Enviar mensagem ao motorista") },
  { id: "viagem-divergente", url: `/viagens/${ids.viagem}`, abrir: botao("Marcar como divergente") },
  { id: "acesso-app-ver-celular", url: "/acesso-app", abrir: botao("Ver o celular") },
  { id: "acesso-app-configurar", url: "/acesso-app", abrir: botao("Configurar por aqui") },
  { id: "programacao-programar", url: "/programacao", abrir: botao("Programar") },
  { id: "relatorios-detalhe-grupo", url: "/relatorios/viagens?agruparPor=MOTORISTA", abrir: async (p) => { await p.locator("tbody tr").first().click(); } },
  { id: "relatorios-abastecimentos-grupo", url: "/relatorios/abastecimentos", abrir: async (p) => { await p.locator("tbody tr").first().click(); } },
];

const JANELA = '[role="dialog"]:not([aria-label="Passo a passo"]), [role="alertdialog"], div.fixed.inset-0.z-50:not([data-state])';

test.describe.configure({ mode: "serial" });
test("janelas: abre cada uma pelo gatilho, captura e mede", async ({ page }, info) => {
  test.setTimeout(900_000);
  const vp = info.project.name;
  const pasta = path.join(RAIZ, vp);
  fs.mkdirSync(pasta, { recursive: true });
  const filtro = process.env.UX_SO ? new RegExp(process.env.UX_SO) : null;
  const medidas: Record<string, unknown> = {};
  for (const c of CENARIOS) {
    if (filtro && !filtro.test(c.id)) continue;
    try {
      await entrarComo(page, c.usuario ?? "admin");
      await abrirRota(page, { id: c.id, rotulo: c.id, url: c.url, usuario: c.usuario });
      const pular = page.getByRole("button", { name: "Pular" });
      if (await pular.count()) await pular.click();
      await c.abrir(page);
      await page.waitForTimeout(900);
      const janela = page.locator(JANELA).first();
      const abriu = await janela.isVisible().catch(() => false);
      if (!abriu) {
        medidas[c.id] = { abriu: false, url: page.url().replace(/^.*:3101/, "") };
        continue;
      }
      await estabilizar(page);
      await page.screenshot({ path: path.join(pasta, `${c.id}.png`), scale: "css", animations: "disabled", caret: "hide" });
      medidas[c.id] = await janela.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const btns = Array.from(el.querySelectorAll("button, a")).filter((b) => (b as HTMLElement).offsetParent !== null);
        const fecha = btns.find((b) => /fechar/i.test(b.textContent ?? "") || /fechar/i.test(b.getAttribute("aria-label") ?? ""));
        const fr = fecha?.getBoundingClientRect();
        const ultimo = btns[btns.length - 1]?.getBoundingClientRect();
        return {
          abriu: true,
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw, vh,
          dentroDaTela: r.top >= -1 && r.bottom <= vh + 1 && r.left >= -1 && r.right <= vw + 1,
          rolagemInterna: el.scrollHeight > el.clientHeight + 1,
          fecharPx: fr ? `${Math.round(fr.width)}x${Math.round(fr.height)}` : null,
          ultimoBotaoVisivel: ultimo ? ultimo.bottom <= vh + 1 && ultimo.top >= 0 : null,
          alvosPequenos: btns.filter((b) => { const q = b.getBoundingClientRect(); return q.width < 44 || q.height < 44; }).length,
        };
      });
    } catch (e) {
      medidas[c.id] = { erro: String(e).slice(0, 160) };
    }
  }
  fs.writeFileSync(path.join(RAIZ, `${vp}.json`), JSON.stringify(medidas, null, 1));
  expect(Object.keys(medidas).length).toBeGreaterThan(0);
});
