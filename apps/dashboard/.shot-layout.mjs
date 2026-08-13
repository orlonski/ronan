// Abre o editor do layout de envio (o construtor de colunas) e captura.
import { readFileSync } from "node:fs";
import { encode } from "next-auth/jwt";
import { chromium } from "@playwright/test";
const env = Object.fromEntries(readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")).trim(),l.slice(l.indexOf("=")+1).trim()]));
const login = await (await fetch("http://localhost:3000/admin/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"admin@ronan.local",senha:"demo1234"})})).json();
const cookie = await encode({ token:{ name:"Marcos Andrade", email:"admin@ronan.local", sub:"demo", accessToken:login.accessToken, refreshToken:login.refreshToken, accessTokenExpires: JSON.parse(Buffer.from(login.accessToken.split(".")[1],"base64").toString()).exp*1000 }, secret: env.NEXTAUTH_SECRET });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:940}, deviceScaleFactor:2, locale:"pt-BR", timezoneId:"America/Sao_Paulo" });
await ctx.addCookies([{name:"next-auth.session-token",value:cookie,domain:"localhost",path:"/"}]);
const page = await ctx.newPage();
await page.route("**/inbox/stream*", r=>r.abort());
await page.goto(`http://localhost:3001/empresas/${process.env.EMPRESA_ID}/layout-envio`, { waitUntil:"networkidle" });
await page.waitForTimeout(2500);
await page.getByRole("button",{name:/^Editar$/}).first().click();
await page.waitForTimeout(2500);
await page.addStyleTag({content:`[role="img"][aria-label="Schaba"]{-webkit-mask-image:none!important;mask-image:none!important;background:transparent!important;position:relative;}
[role="img"][aria-label="Schaba"]::after{content:"GESTÃO DE VIAGENS";position:absolute;inset:0;display:flex;align-items:center;font:700 13px/1 -apple-system,Helvetica,Arial,sans-serif;letter-spacing:.14em;color:currentColor;white-space:nowrap;}`});
await page.waitForTimeout(600);
await page.screenshot({ path:"/Users/orlonski/dev/ronan/proposta-alex/imagens/07-layout-envio.png" });
console.log("ok");
await b.close();
