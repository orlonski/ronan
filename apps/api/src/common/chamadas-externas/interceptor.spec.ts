import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { comGatilho, instalarRegistroDeChamadas, tirarDaFila } from "./interceptor";

let servidor: http.Server;
let base = "";

beforeAll(async () => {
  instalarRegistroDeChamadas();
  servidor = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      if (req.url?.startsWith("/falha")) {
        res.writeHead(500, { "content-type": "application/json" }).end('{"erro":"quebrou"}');
        return;
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ eco: corpo ? JSON.parse(corpo) : null, model: "claude-x", usage: { input_tokens: 12, output_tokens: 3 } }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  tirarDaFila(10_000);
});
afterAll(() => servidor.close());

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("interceptador de chamadas externas", () => {
  it("fetch: registra pedido, resposta, tokens de IA e o gatilho — sem a chave", async () => {
    const r = await comGatilho("POST /admin/teste", () =>
      fetch(`${base}/v1/messages?key=SEGREDO`, {
        method: "POST",
        headers: { "x-api-key": "sk-SEGREDO", "content-type": "application/json" },
        body: JSON.stringify({ prompt: "oi", cpf: "111.444.777-35" }),
      }),
    );
    // A resposta continua inteira pra quem chamou.
    expect(((await r.json()) as { eco: { prompt: string } }).eco.prompt).toBe("oi");
    await esperar(50);
    const [c] = tirarDaFila();
    expect(c).toMatchObject({ metodo: "POST", status: 200, ok: true, gatilho: "POST /admin/teste", iaModelo: "claude-x", iaTokensEntrada: 12, iaTokensSaida: 3 });
    expect(c!.caminho).toBe("/v1/messages?key=***");
    expect(JSON.stringify(c)).not.toMatch(/SEGREDO|111\.444/);
  });

  it("fetch com erro HTTP fica marcado", async () => {
    await fetch(`${base}/falha`);
    await esperar(50);
    const [c] = tirarDaFila();
    expect(c).toMatchObject({ status: 500, ok: false, erro: expect.stringMatching(/HTTP 500/) });
  });

  it("módulo http (quem não usa fetch): só o resumo", async () => {
    await new Promise<void>((ok) => http.get(`${base}/arquivo`, (res) => res.resume().on("end", () => ok())));
    await esperar(50);
    const c = tirarDaFila().find((x) => x.caminho === "/arquivo");
    expect(c).toMatchObject({ metodo: "GET", status: 200, ok: true, pedido: null, resposta: null });
  });
});

describe("robôs agendados rotulados", () => {
  it("todo @Cron dispara com o rótulo cron:nome (nome do job, senão o do método)", async () => {
    const { createRequire } = await import("node:module");
    const { gatilhoAtual, rotularRobosAgendados } = await import("./interceptor");
    rotularRobosAgendados();
    const { CronJob } = createRequire(require.resolve("@nestjs/schedule"))("cron") as {
      CronJob: { from: (o: Record<string, unknown>) => { fireOnTick: () => Promise<void> | void } };
    };
    const vistos: (string | null)[] = [];
    const comNome = CronJob.from({ cronTime: "0 0 1 1 *", onTick: () => void vistos.push(gatilhoAtual()), name: "limpar-coisas" });
    await comNome.fireOnTick();
    function sweep() {
      vistos.push(gatilhoAtual());
    }
    const semNome = CronJob.from({ cronTime: "0 0 1 1 *", onTick: sweep.bind({}) });
    await semNome.fireOnTick();
    expect(vistos).toEqual(["cron:limpar-coisas", "cron:sweep"]);
  });
});
