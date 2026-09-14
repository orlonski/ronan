// Gera um clipe com o MiniMax Hailuo (texto → vídeo).
//
//   node marketing/reels/gerar-clipe-minimax.mjs <arquivo-de-prompt> [saida.mp4]
//
// POR QUE ESTE, e não o Veo: o Veo custou **R$ 18 por clipe de 8 segundos**
// (medido, não estimado — ver PLAYBOOK.md), e um Reel de 20s saía por uns R$ 55.
// O Hailuo faz 6 segundos por cerca de R$ 1,50. Doze vezes mais barato, e a
// chave já existe no projeto (usada pra ler ticket).
//
// O QUE SE PERDE: o Hailuo **não gera áudio**. A peça tem que funcionar muda,
// com texto queimado — o que a pesquisa diz ser o normal mesmo (cerca de 60%
// assiste sem som).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const MODELO = "MiniMax-Hailuo-2.3";
// O `.io` é o endpoint global; `api.minimaxi.com` é o da China. Mesma decisão
// (e mesma env) do cliente de IA da API — ver ia/cliente-ia.ts.
const BASE = (process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1").replace(/\/+$/, "");

// ---- TRAVA DE GASTO ----
//
// Este script gasta dinheiro de verdade a cada execução. Nada automático pode
// chamá-lo: nem o cron da pauta, nem o agente, nem um script de esteira.
//
// A proteção não pode ser acidental ("o container não tem .env"), porque
// acidente muda sem avisar. É explícita: sem PERMITIR_GASTO_VIDEO=sim na
// chamada, o script recusa e diz por quê.
if (process.env.PERMITIR_GASTO_VIDEO !== "sim") {
  console.error(
    "Recusado: gerar vídeo custa dinheiro por clipe (~R$ 1,50 por clipe de 6s).\n" +
      "Se é você, na mão, e sabe quanto vai gastar:\n" +
      "  PERMITIR_GASTO_VIDEO=sim node " + process.argv[1].split("/").pop() + " <prompt> [saida.mp4]",
  );
  process.exit(1);
}

const [arquivoPrompt, saidaArg] = process.argv.slice(2);
if (!arquivoPrompt) {
  console.error("uso: node gerar-clipe-minimax.mjs <arquivo-de-prompt> [saida.mp4]");
  process.exit(1);
}

/** A chave mora no .env da API. Nunca em argumento nem em log. */
async function chave() {
  const env = await readFile(join(raiz, "../../apps/api/.env"), "utf8");
  const linha = env.split("\n").find((l) => l.startsWith("MINIMAX_API_KEY="));
  const valor = linha?.slice("MINIMAX_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) { console.error("MINIMAX_API_KEY ausente em apps/api/.env"); process.exit(1); }
  return valor;
}

const texto = (await readFile(arquivoPrompt, "utf8")).trim();
if (!texto) { console.error(`${arquivoPrompt} está vazio.`); process.exit(1); }
if (texto.length > 2000) {
  console.error(`O prompt tem ${texto.length} caracteres; o teto do Hailuo é 2000.`);
  process.exit(1);
}

const API_KEY = await chave();
const H = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function chamar(caminho, opcoes = {}) {
  const r = await fetch(`${BASE}${caminho}`, { ...opcoes, headers: { ...H, ...(opcoes.headers ?? {}) } });
  const corpo = await r.json().catch(() => ({}));
  // O MiniMax devolve HTTP 200 mesmo em erro de negócio: quem manda é o
  // `base_resp.status_code`. Confiar no status HTTP aqui esconde falha.
  const cod = corpo?.base_resp?.status_code;
  if (!r.ok || (cod !== undefined && cod !== 0)) {
    const conhecidos = {
      1002: "limite de taxa",
      1008: "saldo insuficiente",
      1026: "conteúdo recusado pelo filtro",
      2013: "parâmetro inválido",
    };
    throw new Error(`${conhecidos[cod] ?? corpo?.base_resp?.status_msg ?? `HTTP ${r.status}`} (code ${cod})`);
  }
  return corpo;
}

console.log(`gerando com ${MODELO}…`);
const criado = await chamar("/video_generation", {
  method: "POST",
  body: JSON.stringify({
    model: MODELO,
    prompt: texto,
    duration: 6,
    resolution: "1080P",
    // Desligado de propósito: o otimizador reescreve o prompt, e o nosso carrega
    // uma lista de negativas e um bloco de luz que precisam sair intactos — é o
    // que mantém os clipes parecendo o mesmo filme.
    prompt_optimizer: false,
  }),
});

const tarefa = criado.task_id;
if (!tarefa) throw new Error(`resposta sem task_id: ${JSON.stringify(criado).slice(0, 300)}`);
console.log(`tarefa ${tarefa} — costuma levar poucos minutos`);

let arquivoId = null;
const limite = Date.now() + 12 * 60 * 1000;
while (Date.now() < limite) {
  await new Promise((r) => setTimeout(r, 10_000));
  // A consulta NÃO é /video_generation/{id} (isso dá 404, e a documentação de
  // terceiros erra nisso). É /query/video_generation?task_id=…
  const st = await chamar(`/query/video_generation?task_id=${encodeURIComponent(tarefa)}`, { method: "GET" });
  // O status vem capitalizado ("Processing", "Success", "Fail").
  const estado = String(st.status ?? "").toLowerCase();
  if (estado === "success") { arquivoId = st.file_id; break; }
  if (estado === "fail" || estado === "failed") {
    throw new Error(`a geração falhou: ${JSON.stringify(st).slice(0, 300)}`);
  }
  process.stdout.write(".");
}
process.stdout.write("\n");
if (!arquivoId) throw new Error("passou de 12 minutos sem terminar");

const arq = await chamar(`/files/retrieve?file_id=${encodeURIComponent(arquivoId)}`, { method: "GET" });
const url = arq?.file?.download_url;
if (!url) throw new Error(`sem download_url: ${JSON.stringify(arq).slice(0, 300)}`);

const bin = await fetch(url);
if (!bin.ok) throw new Error(`download falhou: HTTP ${bin.status}`);
const saida = saidaArg ?? join(raiz, "clipes", `mm-${Date.now()}.mp4`);
await mkdir(dirname(saida), { recursive: true });
await writeFile(saida, Buffer.from(await bin.arrayBuffer()));
console.log(`pronto: ${saida}`);
