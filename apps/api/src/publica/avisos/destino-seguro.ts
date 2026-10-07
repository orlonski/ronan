import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * O cliente digita o endereço; o NOSSO servidor faz a chamada. Sem isto, um
 * aviso apontado pra `http://minio:9000` ou `169.254.169.254` faria a API
 * buscar coisa da rede interna (SSRF). Regras (docs/api-publica/03-seguranca.md
 * §4.2 e 05-qa.md I-7, M-9):
 *
 *  - só https, sem usuário/senha no endereço, sem IP escrito no lugar do nome
 *    (inclusive as formas disfarçadas: decimal, octal, IPv6 mapeado);
 *  - o nome é resolvido e TODO endereço que ele devolve tem de ser público;
 *  - a conexão vai pro IP que foi conferido (quem chama passa ele adiante),
 *    senão o DNS responderia uma coisa na conferência e outra na conexão;
 *  - nossos próprios domínios não: o aviso viraria POST nas nossas rotas
 *    públicas (cadastro, webhooks de terceiros).
 *
 * Separar o envio em outro processo NÃO é defesa: ele roda na mesma rede
 * interna. A defesa é esta conferência, feita no cadastro e a cada envio.
 */

const NOSSOS_DOMINIOS = [/(^|\.)schaba\.com\.br$/i, /(^|\.)movatruck\.com\.br$/i, /(^|\.)easypanel\.host$/i, /(^|\.)localhost$/i, /(^|\.)internal$/i, /(^|\.)local$/i];

export class DestinoRecusado extends Error {}

/** Conferência só do texto (sem rede). */
export function conferirEndereco(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DestinoRecusado("Endereço inválido.");
  }
  if (u.protocol !== "https:") throw new DestinoRecusado("O endereço precisa começar com https://.");
  if (u.username || u.password) throw new DestinoRecusado("Não coloque usuário e senha no endereço.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // `new URL` já normaliza 2130706433 e 0x7f.1 pra 127.0.0.1; IP de qualquer
  // jeito é recusado — aviso vai pra nome, não pra número.
  if (isIP(host) || /^[\d.]+$/.test(host) || /^0x/i.test(host)) {
    throw new DestinoRecusado("Use um nome (api.suaempresa.com.br), não um número de IP.");
  }
  if (!host.includes(".")) throw new DestinoRecusado("Use um endereço público completo.");
  if (NOSSOS_DOMINIOS.some((r) => r.test(host))) throw new DestinoRecusado("Este endereço é do próprio Movatruck.");
  return u;
}

/** IP que não pode receber chamada nossa. */
export function ipProibido(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Proibido(ip);
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapeado = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeado) return ipv4Proibido(mapeado[1]!);
    if (x === "::" || x === "::1") return true;
    if (/^f[cd]/.test(x)) return true; // fc00::/7 (rede privada)
    if (/^fe[89ab]/.test(x)) return true; // fe80::/10 (link-local)
    if (/^ff/.test(x)) return true; // multicast
    if (/^64:ff9b:/.test(x)) return true; // NAT64 (alcança IPv4 interno)
    if (/^2001:db8:/.test(x) || /^2001:0?:/.test(x) || /^2002:/.test(x)) return true; // documentação, Teredo, 6to4
    return false;
  }
  return true;
}

function ipv4Proibido(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadados de nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast e reservado
  );
}

/** Resolve e confere. Devolve o IP pra conectar (o primeiro); recusa se QUALQUER um for interno. */
export async function resolverDestino(
  url: string,
  resolver: (host: string) => Promise<{ address: string; family: number }[]> = (h) => lookup(h, { all: true, verbatim: true }),
): Promise<{ url: URL; ip: string; familia: 4 | 6 }> {
  const u = conferirEndereco(url);
  let ips: { address: string; family: number }[];
  try {
    ips = await resolver(u.hostname);
  } catch {
    throw new DestinoRecusado("Não achamos esse endereço (DNS).");
  }
  if (ips.length === 0) throw new DestinoRecusado("Não achamos esse endereço (DNS).");
  if (ips.some((i) => ipProibido(i.address))) throw new DestinoRecusado("Esse endereço aponta pra uma rede interna.");
  return { url: u, ip: ips[0]!.address, familia: ips[0]!.family === 6 ? 6 : 4 };
}
