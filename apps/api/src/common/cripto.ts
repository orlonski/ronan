import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Cifra valores que precisam voltar em claro — hoje, as chaves de IA que o
 * super admin digita na tela.
 *
 * **Não é hash.** Senha se guarda com hash, porque ninguém precisa dela de
 * volta; uma chave de API precisa ser apresentada ao fornecedor a cada
 * chamada. Então é cifra simétrica, com o que isso implica: quem tem o segredo
 * do servidor lê o valor.
 *
 * O que isto protege de verdade: dump de banco, backup copiado, print da
 * tabela, replica lida por engano. O que NÃO protege: quem já está dentro do
 * servidor com as variáveis de ambiente na mão. Dizer o contrário seria vender
 * proteção que não existe.
 *
 * AES-256-GCM porque autentica além de cifrar: valor adulterado no banco falha
 * ao decifrar em vez de virar lixo silencioso.
 */

/** Marca o formato. O dia que o esquema mudar, `v2:` convive com o `v1:` já gravado. */
const PREFIXO = "v1";

/**
 * Separa este uso de qualquer outro que derive chave do mesmo segredo — o
 * mesmo segredo com finalidades diferentes nunca deve gerar a mesma chave.
 */
const SAL = "ronan:chaves-ia:v1";

function chaveDe(segredo: string): Buffer {
  return scryptSync(segredo, SAL, 32);
}

/** `v1:<iv>:<tag>:<dados>`, tudo em base64url. */
export function cifrar(valor: string, segredo: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chaveDe(segredo), iv);
  const dados = Buffer.concat([cipher.update(valor, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIXO, iv.toString("base64url"), tag.toString("base64url"), dados.toString("base64url")].join(":");
}

/**
 * Devolve o valor original.
 *
 * Texto sem o prefixo volta como veio: é o que estava gravado em claro antes
 * desta função existir, e falhar nele deixaria o SDR mudo por causa de um
 * formato antigo. Texto COM o prefixo que não decifra devolve `null` — aí é
 * adulteração ou troca de segredo, e seguir em frente seria pior.
 */
export function decifrar(guardado: string | null | undefined, segredo: string): string | null {
  const bruto = (guardado ?? "").trim();
  if (!bruto) return null;
  if (!bruto.startsWith(`${PREFIXO}:`)) return bruto;

  const [, iv, tag, dados] = bruto.split(":");
  if (!iv || !tag || !dados) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", chaveDe(segredo), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dados, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Já está cifrado? Evita cifrar duas vezes ao regravar a mesma linha. */
export function estaCifrado(valor: string | null | undefined): boolean {
  return (valor ?? "").startsWith(`${PREFIXO}:`);
}
