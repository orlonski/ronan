/**
 * Endereço da API pública.
 *
 * Chumbado aqui pelo mesmo motivo do `config.ts`: as variáveis do painel do
 * Easypanel chegam no build e vencem o `??` sem avisar. Uma `VITE_API_URL`
 * esquecida no painel apontaria o formulário de contato pro lugar errado, e o
 * sintoma seria só um lead que não chega.
 *
 * A URL tem que ser o host PÚBLICO com https — nunca o nome interno do Docker.
 */
export const API_URL = "https://ronan-api.2azr6q.easypanel.host";

/** Erro que o formulário sabe mostrar pro visitante. */
export class ErroApi extends Error {
  constructor(
    message: string,
    readonly campos: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ErroApi";
  }
}

type Issue = { path: string; message: string };

/**
 * POST simples pra API pública. Traduz o `{ issues: [...] }` do
 * ZodValidationPipe em mensagem por campo, que é o que o formulário exibe.
 */
export async function postPublico(caminho: string, corpo: unknown): Promise<void> {
  let resposta: Response;

  try {
    resposta = await fetch(`${API_URL}/publico/captacao/${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(
      "Não deu pra enviar agora. Confira a conexão ou chame no WhatsApp.",
    );
  }

  if (resposta.ok) return;

  if (resposta.status === 429) {
    throw new ErroApi("Muitas tentativas seguidas. Espere um minuto e tente de novo.");
  }

  if (resposta.status === 400) {
    const corpoErro = (await resposta.json().catch(() => null)) as
      | { issues?: Issue[] }
      | null;
    const campos: Record<string, string> = {};
    for (const issue of corpoErro?.issues ?? []) {
      if (issue.path) campos[issue.path] = issue.message;
    }
    throw new ErroApi("Confira os campos destacados.", campos);
  }

  throw new ErroApi("Deu erro do nosso lado. Tente de novo ou chame no WhatsApp.");
}
