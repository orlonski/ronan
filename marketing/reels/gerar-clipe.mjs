// Gera um clipe de vídeo com o Veo 3.1 (Gemini API).
//
//   node marketing/reels/gerar-clipe.mjs <arquivo-de-prompt> [saida.mp4]
//
// O prompt vem de ARQUIVO, não da linha de comando: prompt bom tem vírgula,
// acento e várias linhas, e passar isso pelo shell é pedir pra ele comer algo no
// meio (mesma razão da legenda em `enfileirar.mjs`).
//
// A chave sai de apps/api/.env — não se digita chave em linha de comando, que
// fica no histórico do shell.
//
// POR QUE O VEO, e não Sora/Kling/Hailuo:
//   - A API do Sora sai do ar em 24/09/2026 (a OpenAI descontinuou o produto).
//   - O Veo tem áudio NATIVO: som ambiente e voz saem no mesmo clipe, o que
//     resolve o "sem voz" sem contratar serviço de locução sintética.
//   - A conta do projeto já é nível pago do Gemini, que é o requisito.
// O playground do navegador exige plano Ultra; a API, não — só nível pago.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const MODELO = "veo-3.1-generate-preview";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const [arquivoPrompt, saidaArg] = process.argv.slice(2);
if (!arquivoPrompt) {
  console.error("uso: node gerar-clipe.mjs <arquivo-de-prompt> [saida.mp4]");
  process.exit(1);
}

/** A chave mora no .env da API. Nunca em argumento nem em log. */
async function chave() {
  const env = await readFile(join(raiz, "../../apps/api/.env"), "utf8");
  const linha = env.split("\n").find((l) => l.startsWith("GEMINI_API_KEY="));
  const valor = linha?.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) {
    console.error("GEMINI_API_KEY ausente em apps/api/.env");
    process.exit(1);
  }
  return valor;
}

const texto = (await readFile(arquivoPrompt, "utf8")).trim();
if (!texto) { console.error(`${arquivoPrompt} está vazio.`); process.exit(1); }

// O que nunca deve aparecer. Os modelos de vídeo ainda embaralham texto miúdo e
// detalhe fino — placa, número de eixo, letreiro de posto, painel — e é
// exatamente o que caminhoneiro e dono de frota reconhecem de olho fechado. Sai
// em TODO clipe, não é opcional.
const NEGATIVO = [
  "readable license plate", "legible text", "brand logos", "gas station signage",
  "dashboard instrument text", "watermark", "subtitles", "american highway signs",
  "distorted hands", "extra fingers", "warped faces",
].join(", ");

const API_KEY = await chave();

async function chamar(caminho, opcoes = {}) {
  const r = await fetch(`${BASE}${caminho}`, {
    ...opcoes,
    headers: { "x-goog-api-key": API_KEY, "Content-Type": "application/json", ...(opcoes.headers ?? {}) },
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = corpo?.error?.message ?? `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return corpo;
}

console.log(`gerando com ${MODELO}…`);
const inicio = await chamar(`/models/${MODELO}:predictLongRunning`, {
  method: "POST",
  body: JSON.stringify({
    instances: [{ prompt: texto }],
    parameters: {
      // 9:16 porque é Reel. O padrão da API é 16:9 e sai errado calado.
      aspectRatio: "9:16",
      durationSeconds: 8,
      negativePrompt: NEGATIVO,
      // `personGeneration` não é aceito neste modelo ("allow_adult ... not
      // supported"). Os prompts já mantêm rosto fora de quadro por decisão de
      // direção, então não há o que configurar aqui.
      sampleCount: 1,
    },
  }),
});

const operacao = inicio.name;
if (!operacao) throw new Error(`resposta sem operação: ${JSON.stringify(inicio).slice(0, 300)}`);
console.log(`operação ${operacao.split("/").pop()} — geração leva alguns minutos`);

// Poll paciente: vídeo não é foto. Teto de 10 minutos pra não pendurar pra
// sempre se a operação travar do outro lado.
let pronto = null;
const limite = Date.now() + 10 * 60 * 1000;
while (Date.now() < limite) {
  await new Promise((r) => setTimeout(r, 10_000));
  const st = await chamar(`/${operacao}`);
  if (st.error) throw new Error(st.error.message ?? JSON.stringify(st.error).slice(0, 300));
  if (st.done) { pronto = st; break; }
  process.stdout.write(".");
}
process.stdout.write("\n");
if (!pronto) throw new Error("passou de 10 minutos sem terminar");

const amostras = pronto.response?.generateVideoResponse?.generatedSamples
  ?? pronto.response?.generatedSamples ?? [];
const uri = amostras[0]?.video?.uri;
if (!uri) throw new Error(`terminou sem vídeo: ${JSON.stringify(pronto.response ?? {}).slice(0, 400)}`);

const bin = await fetch(uri, { headers: { "x-goog-api-key": API_KEY } });
if (!bin.ok) throw new Error(`download falhou: HTTP ${bin.status}`);
const saida = saidaArg ?? join(raiz, "clipes", `${Date.now()}.mp4`);
await mkdir(dirname(saida), { recursive: true });
await writeFile(saida, Buffer.from(await bin.arrayBuffer()));
console.log(`pronto: ${saida}`);
