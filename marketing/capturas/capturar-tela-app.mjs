import { chromium, devices } from "/Users/orlonski/dev/ronan/node_modules/@playwright/test/index.mjs";
const POSTOS = ["Posto Trevo BR-376", "Auto Posto Aurora", "Graal Ponta Grossa", "Ipiranga Contorno Leste"];
const CATALOGOS = { veiculos:[{id:"v1",placa:"AZW-4G18",modelo:"Scania R450"}], empresas:[{id:"e1",nome:"Transportes Aurora"}], clientes:[], materiais:[], locais:[] };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices["iPhone 13"], viewport:{width:390,height:844}, deviceScaleFactor: 3, locale: "pt-BR" });
await ctx.route("**/m/**", (route) => {
  const u = route.request().url();
  const j = (d) => route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(d) });
  if (u.includes("postos-recentes")) return j(POSTOS);
  if (u.includes("/catalogos")) return j(CATALOGOS);
  if (u.includes("/me")) return j({ id:"m1", nome:"Adilson Ferreira", status:"APROVADO", podeLancarViagem:true, empresaId:"e1" });
  return j([]);
});
const p = await ctx.newPage();
await p.addInitScript(() => {
  localStorage.setItem("ronan.motorista.tokens", JSON.stringify({accessToken:"fake",refreshToken:"fake"}));
  localStorage.setItem("ronan.motorista.status", "APROVADO");
});
await p.goto("http://localhost:3002/novo-abastecimento", { waitUntil: "networkidle" });
await p.waitForTimeout(1800);

for (const [gatilho, opcao] of [["Escolha a placa","AZW-4G18"],["Escolha a empresa","Transportes Aurora"]]) {
  const t = p.getByText(gatilho, { exact: false }).first();
  if (await t.count()) { await t.click(); await p.waitForTimeout(500);
    const o = p.getByText(opcao, { exact: false }).last();
    if (await o.count()) await o.click();
    await p.waitForTimeout(400); }
}
const set = async (id,v)=>{const el=p.locator(`#${id}`); if(await el.count()) await el.fill(v);};
await set("litros","412,80"); await set("valor","2596,45"); await set("odometro","487320");
await p.waitForTimeout(500);
await p.locator("#posto").scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, 330));
await p.waitForTimeout(600);
await p.screenshot({ path:"/tmp/abast-tela.png" });
console.log(await p.evaluate(()=>document.body.innerText.slice(0,120).replace(/\n+/g," | ")));
await b.close();
