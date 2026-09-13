// Reel 01 — "Sem sinal, o app não para".
//
// Grava o PWA do motorista (apps/motorista) lançando uma viagem OFFLINE DE
// VERDADE: o Playwright corta a rede do contexto, a viagem cai na fila local, e
// quando a rede volta ela sobe sozinha. Nada é encenado — o que aparece na tela
// é o app reagindo.
//
//   pnpm --filter @ronan/motorista dev      # :3002
//   node marketing/reels/01-offline.mjs
//
// Sai em saida/01-offline.mp4, vertical 1080x1920, sem áudio.
import { chromium, devices } from "/Users/orlonski/dev/ronan/node_modules/@playwright/test/index.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const bruto = join(raiz, ".bruto");
const saida = join(raiz, "saida");
rmSync(bruto, { recursive: true, force: true });
mkdirSync(bruto, { recursive: true });
mkdirSync(saida, { recursive: true });

const CAT = {
  veiculos: [{ id: "7a1f2c94-5e63-4b81-9d20-3f6a8c14e5b7", placa: "AZW-4G18", modelo: "Scania R450" }],
  empresas: [{ id: "b3c9d47e-2a15-4f68-8c03-9e7b1d5a2f46", nome: "Transportes Aurora" }],
  clientes: [{ id: "1d84f6a2-9c37-4e50-b1a8-6f2c35d97e01", nome: "Mineração Boa Vista", empresa: { id: "b3c9d47e-2a15-4f68-8c03-9e7b1d5a2f46", nome: "Transportes Aurora" } }],
  materiais: [{ id: "4e72b8d1-3f96-42ac-85b7-0c19d6a4f38e", nome: "Areia Média", exigeTicket: false }],
  locais: [
    { id: "92af5c07-6b41-4d38-a5e9-7c30f1b82d64", nome: "Areal Boa Vista", tipo: "CARGA", cidade: "Balsa Nova", uf: "PR", lat: -25.4921, lng: -49.6312, raioMetros: 300 },
    { id: "5c018e3b-7d92-4a16-93f4-2b85c67e0a19", nome: "Obra Contorno Leste", tipo: "DESCARGA", cidade: "São José dos Pinhais", uf: "PR", lat: -25.5307, lng: -49.2064, raioMetros: 300 },
  ],
};
const VIEW = { width: 390, height: 844 };
const ME = { id: "m1", nome: "Adilson Ferreira", status: "APROVADO", podeLancarViagem: true, empresaId: "b3c9d47e-2a15-4f68-8c03-9e7b1d5a2f46" };

const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  ...devices["iPhone 13"],
  viewport: VIEW,
  deviceScaleFactor: 2,
  locale: "pt-BR",
  permissions: ["geolocation"],
  // Em cima da Obra Contorno Leste: o app acha o local pelo GPS, sem rede.
  geolocation: { latitude: -25.5307, longitude: -49.2064, accuracy: 12 },
  // O canvas do vídeo tem que ser IGUAL ao viewport: o Playwright encaixa a
  // página 1:1 no canto, não escala pra caber. Canvas maior = tela do app num
  // pedaço do quadro e o resto cinza.
  recordVideo: { dir: bruto, size: VIEW },
});

// Nenhuma chamada sai da máquina: /m/* inteiro é respondido aqui.
let recebidas = 0;
await ctx.route("**/m/**", (rota) => {
  const u = rota.request().url();
  const j = (d) => rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
  if (u.includes("/catalogos")) return j(CAT);
  if (u.includes("/me")) return j(ME);
  // A home lista as últimas viagens. Só o ENVELOPE importa aqui: devolver `[]`
  // cru faz a tela dizer "Sem internet e sem viagens em cache", que contradiz
  // um vídeo cuja primeira cena é o app funcionando.
  if (rota.request().method() === "POST" && u.includes("/viagens")) {
    recebidas++;
    return j({ id: "viagem-nova", clientId: "x", status: "AGUARDANDO_PESO" });
  }
  if (u.includes("/viagens?") || u.endsWith("/viagens")) return j({ itens: [], nextCursor: null });
  return j([]);
});

const p = await ctx.newPage();
await p.addInitScript(() => {
  localStorage.setItem("ronan.motorista.tokens", JSON.stringify({ accessToken: "t", refreshToken: "t" }));
  localStorage.setItem("ronan.motorista.status", "APROVADO");
});

/** Legenda fixa no topo — é o que substitui a narração. */
async function legenda(texto, tom = "escuro") {
  await p.evaluate(([t, cor]) => {
    let el = document.getElementById("__reel");
    if (!el) {
      el = document.createElement("div");
      el.id = "__reel";
      el.style.cssText =
        "position:fixed;left:0;right:0;top:0;z-index:99999;padding:18px 16px;" +
        "font:800 25px/1.25 system-ui,-apple-system,sans-serif;text-align:center;" +
        "letter-spacing:-.01em;transition:background .25s";
      document.body.appendChild(el);
    }
    el.style.background = cor === "laranja" ? "#DF7234" : "#0E1730";
    el.style.color = "#fff";
    el.textContent = t;
  }, [texto, tom]);
}

const espera = (ms) => p.waitForTimeout(ms);

await p.goto("http://localhost:3002/", { waitUntil: "networkidle" });
await espera(900);
// O convite de "instalar na tela inicial" é do navegador, não do produto — e
// fala de Safari no meio de um vídeo sobre o app. Dispensa pelo botão dele
// (`ios-install-prompt.tsx`), que é o caminho que o usuário usaria.
const dispensar = p.getByRole("button", { name: "Dispensar" }).first();
await dispensar.waitFor({ timeout: 5000 }).catch(() => {});
await dispensar.click().catch(() => {});
await espera(500);
await legenda("Motorista vai lançar a viagem");
await espera(1300);

// Entra tocando no botão, não por URL. Ao salvar o app faz `navigate(-1)`, e
// com duas URLs abertas na mão isso vira navegação de documento — que offline
// não completa. Pelo botão, o histórico é do react-router e a volta é local.
await p.getByText(/Nova viagem/i).first().click();
await p.waitForURL("**/nova-viagem");
await espera(700);

// ---- corta a rede DE VERDADE ----
await ctx.setOffline(true);
await legenda("Agora sem sinal nenhum ✈", "laranja");
await espera(1600);

async function escolher(rotulo, opcao) {
  await p.getByText(rotulo, { exact: false }).first().click();
  await espera(420);
  await p.getByText(opcao, { exact: false }).last().click();
  await espera(430);
}
await legenda("Lançando a viagem offline", "laranja");
await escolher("Escolha a placa", "AZW-4G18");
await escolher("Escolha o cliente", "Mineração Boa Vista");
await escolher("Escolha o material", "Areia Média");
const ton = p.locator('input[placeholder="0,000"]').first();
await ton.click();
await ton.pressSequentially("27,460", { delay: 70 });
await espera(300);
const ticket = p.locator('input[placeholder="número"]').first();
await ticket.click();
await ticket.pressSequentially("48362", { delay: 70 });
await espera(350);
await escolher("Escolha o local", "Areal Boa Vista");
await espera(500);

// O destino sai do GPS do aparelho e do catálogo baixado no login — por isso
// continua funcionando com a rede cortada.
await legenda("O destino ele acha pelo GPS, sem rede", "laranja");
await p.getByText(/Estou no local de descarga/i).first().click();
await espera(2000);
await p.getByText(/Obra Contorno Leste/i).last().click().catch(() => {});
await espera(900);

// Sem rede não dá pra calcular rota, então o km é o do motorista — que é lei
// no sistema de qualquer jeito (common/km-motorista.ts).
const km = p.locator('input[placeholder="0,00"]').first();
await km.click();
await km.pressSequentially("54,40", { delay: 70 });
await espera(500);

await legenda("Salvando", "laranja");
await p.getByRole("button", { name: /Salvar viagem/i }).click();
await espera(1600);

// Offline, o dev server também some — navegar por URL daria tela de erro. O
// motorista não digita URL: ele toca na tarja. Roteamento do react-router é
// client-side e não pede rede.
await legenda("Fica guardada no celular — não é erro", "laranja");
await espera(1800);
await p.getByText(/aguardando sincronizar/i).first().click();
await espera(2200);

// ---- rede volta ----
await ctx.setOffline(false);
await legenda("A rede voltou");
await espera(2000);
await legenda("Subiu sozinha. Você não fez nada.");
await espera(2600);
await legenda("movatruck.com.br");
await espera(1800);

await p.close();
await ctx.close();
await navegador.close();
console.log(`POSTs de viagem recebidos pela API falsa: ${recebidas}`);

const webm = readdirSync(bruto).find((f) => f.endsWith(".webm"));
if (!webm) { console.error("Playwright não gravou vídeo."); process.exit(1); }
const mp4 = join(saida, "01-offline.mp4");
execFileSync("ffmpeg", [
  "-y", "-i", join(bruto, webm),
  // A tela do aparelho é 1:2,16, MAIS ALTA que os 9:16 do Reels. Então escala
  // pela ALTURA e completa a largura com a cor da marca — escalar pela largura
  // daria 2336px de altura e o pad recusa (destino menor que a origem).
  "-vf", "scale=-2:1920:flags=lanczos,pad=1080:1920:(ow-iw)/2:0:color=0x0E1730,setsar=1,format=yuv420p",
  "-fps_mode", "cfr", "-r", "30", "-c:v", "libx264", "-profile:v", "high",
  "-crf", "20", "-movflags", "+faststart", "-an", mp4,
], { stdio: "inherit" });
console.log("pronto: " + mp4);
