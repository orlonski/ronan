import { request } from "node:https";
import { assinar } from "./assinatura";
import { DestinoRecusado, resolverDestino } from "./destino-seguro";
import { comGatilho } from "../../common/chamadas-externas/interceptor";

export type ResultadoEnvio = { ok: boolean; status: number | null; erro: string | null; duracaoMs: number; desligar?: boolean };

const TIMEOUT_MS = 10_000;
const LIMITE_RESPOSTA = 4 * 1024;

/**
 * Manda UM aviso. Conecta no IP conferido (o `lookup` devolve sempre ele),
 * não segue redirecionamento (3xx é falha), corta em 10 s no total e não lê
 * mais que 4 KB da resposta — que é descartada: o que o servidor de fora
 * devolve não é nosso pra guardar nem mostrar.
 *
 * O gatilho `aviso:` faz o registro de chamadas externas guardar só o host:
 * o caminho do endereço do cliente pode carregar segredo dele.
 */
export async function enviarAviso(dados: { url: string; segredo: string; eventoId: string; corpo: string }): Promise<ResultadoEnvio> {
  const inicio = Date.now();
  let destino: Awaited<ReturnType<typeof resolverDestino>>;
  try {
    destino = await resolverDestino(dados.url);
  } catch (e) {
    return { ok: false, status: null, erro: e instanceof DestinoRecusado ? e.message : "Endereço recusado.", duracaoMs: 0 };
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const corpo = Buffer.from(dados.corpo, "utf8");

  return comGatilho("aviso:cliente", () =>
    new Promise<ResultadoEnvio>((resolve) => {
      let terminou = false;
      const fim = (r: Omit<ResultadoEnvio, "duracaoMs">) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(relogio);
        resolve({ ...r, duracaoMs: Date.now() - inicio });
      };
      const req = request(
        {
          host: destino.url.hostname,
          servername: destino.url.hostname,
          port: destino.url.port ? Number(destino.url.port) : 443,
          path: `${destino.url.pathname}${destino.url.search}`,
          method: "POST",
          // Sempre o IP conferido. O Node novo pede a lista (`all: true`, pra
          // tentar IPv4 e IPv6); o antigo pede um endereço só.
          lookup: ((_h: string, o: { all?: boolean }, cb: (err: Error | null, a: unknown, f?: number) => void) =>
            o?.all ? cb(null, [{ address: destino.ip, family: destino.familia }]) : cb(null, destino.ip, destino.familia)) as never,
          headers: {
            "content-type": "application/json",
            "content-length": String(corpo.length),
            "user-agent": "Movatruck-Avisos/1",
            "webhook-id": dados.eventoId,
            "webhook-timestamp": String(timestamp),
            "webhook-signature": assinar(dados.segredo, dados.eventoId, timestamp, dados.corpo),
          },
        },
        (res) => {
          let lidos = 0;
          res.on("data", (c: Buffer) => {
            lidos += c.length;
            if (lidos > LIMITE_RESPOSTA) res.destroy();
          });
          const status = res.statusCode ?? 0;
          const acabou = () =>
            fim({
              ok: status >= 200 && status < 300,
              status,
              erro: status >= 200 && status < 300 ? null : status >= 300 && status < 400 ? `Redirecionou (HTTP ${status}); avisos não seguem redirecionamento.` : `HTTP ${status}`,
              // 410 Gone: o próprio sistema de fora disse que esse endereço acabou.
              desligar: status === 410,
            });
          res.on("end", acabou);
          res.on("close", acabou);
          res.on("error", acabou);
        },
      );
      const relogio = setTimeout(() => {
        req.destroy();
        fim({ ok: false, status: null, erro: "Sem resposta em 10 s." });
      }, TIMEOUT_MS);
      req.on("error", (e) => fim({ ok: false, status: null, erro: `Falha de conexão: ${e.message}`.slice(0, 200) }));
      req.end(corpo);
    }),
  );
}
