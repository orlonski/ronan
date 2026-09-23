/**
 * Tradução de erro da API pra frase que o operador entende.
 *
 * O backend já manda tudo que precisamos: o `ZodValidationPipe` responde
 * `{ message: "Erro de validação", issues: [{path, code, message}] }`. O que
 * faltava era alguém LER o `issues` — sem isso todo 400 chegava na tela como
 * "Erro de validação", sem campo e sem motivo, e o operador ficava adivinhando
 * qual dos 15 campos falhou.
 *
 * Mora fora de `client-api.ts` de propósito: o cliente server-side (`api.ts`)
 * usa as mesmas regras, e este arquivo não é "use client".
 */

export type ApiIssue = { path: string; code?: string; message: string };

/**
 * Códigos estáveis que a API manda no corpo do erro, quando a resposta precisa
 * de mais do que uma frase — a tela decide o que OFERECER a partir daqui.
 *
 * Espelham `apps/api/src/common/conta/estado-da-conta.ts`. São strings de
 * contrato: o backend promete não mudá-las justamente pra que o cliente escolha
 * a mensagem por elas, e não pelo texto.
 */
export const CODIGO_CONTA_SOMENTE_LEITURA = "CONTA_SOMENTE_LEITURA";
export const CODIGO_CONTA_SUSPENSA = "CONTA_SUSPENSA";

/** O `code` do corpo do erro, quando vier. */
export function extrairCodigo(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const c = (body as { code?: unknown }).code;
  return typeof c === "string" && c.trim() ? c : null;
}

/**
 * Frase por status HTTP. Sem isso o construtor do ApiError caía em
 * `API ${status}` — e "API 500" chegava literalmente ao usuário.
 */
const POR_STATUS: Record<number, string> = {
  400: "Tem algum campo com problema. Confira o que está marcado e tente de novo.",
  401: "Sua sessão expirou. Entre de novo pra continuar.",
  403: "Você não tem permissão pra isso. Peça a quem administra o painel.",
  404: "Esse registro não existe mais — pode ter sido apagado por outra pessoa.",
  409: "Alguém alterou isso enquanto você editava. Recarregue e tente de novo.",
  413: "O arquivo é grande demais. Tente um menor.",
  422: "Os dados enviados não batem com o que o sistema espera.",
  429: "Muitas tentativas seguidas. Espere alguns segundos e tente de novo.",
};

export function mensagemPorStatus(status: number): string {
  const exata = POR_STATUS[status];
  if (exata) return exata;
  if (status >= 500) return "O sistema falhou aqui. Já registramos — tente de novo em alguns minutos.";
  if (status === 0) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  if (status >= 400) return "Não consegui concluir essa ação. Tente de novo.";
  return "Não consegui concluir essa ação.";
}

/**
 * Nome do campo como o usuário o vê na tela. O `path` do Zod vem com o nome da
 * propriedade (`empresaId`, `itens.0.quantidade`), que não é o rótulo do form.
 */
const ROTULOS: Record<string, string> = {
  empresaId: "Cliente",
  clienteId: "Obra",
  motoristaId: "Motorista",
  veiculoId: "Veículo",
  materialId: "Material",
  transportadoraId: "Transportadora",
  localCargaId: "Local de carga",
  localDescargaId: "Local de descarga",
  localId: "Local",
  tipoServicoId: "Modo de serviço",
  modalidadeId: "Modalidade",
  fornecedorId: "Fornecedor",
  pedidoId: "Pedido",
  viagemId: "Viagem",
  usuarioId: "Usuário",
  papelId: "Papel",
  contaId: "Empresa",
  cpf: "CPF",
  cnpj: "CNPJ",
  placa: "Placa",
  km: "Km",
  kmMotorista: "Km do motorista",
  peso: "Peso",
  litros: "Litros",
  odometro: "Odômetro",
  ticket: "Ticket",
  valor: "Valor",
  valorUnitario: "Valor unitário",
  valorTotal: "Valor total",
  senha: "Senha",
  email: "E-mail",
  telefone: "Telefone",
  nome: "Nome",
  data: "Data",
  dataInicio: "Data inicial",
  dataFim: "Data final",
  inicio: "Início",
  fim: "Fim",
  motivo: "Motivo",
  observacao: "Observação",
  quantidade: "Quantidade",
  chave: "Chave",
  latitude: "Latitude",
  longitude: "Longitude",
};

/** `dataDeEmissao` → "Data de emissao". Fallback quando não há rótulo mapeado. */
function humanizarCamelCase(seg: string): string {
  const espacado = seg
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return espacado.charAt(0).toUpperCase() + espacado.slice(1);
}

/**
 * Rótulo legível pra um `path` do Zod. Caminhos com índice (`itens.0.peso`)
 * viram "Peso (item 1)" — o operador conta a partir de 1, não de 0.
 */
export function rotuloDoCampo(path: string): string {
  if (!path) return "";
  const segmentos = path.split(".");
  let indice: string | undefined;
  for (const s of segmentos) if (/^\d+$/.test(s)) indice = s;
  const campo = segmentos.filter((s) => !/^\d+$/.test(s)).pop();
  if (!campo) return "";
  const base = ROTULOS[campo] ?? humanizarCamelCase(campo);
  return indice != null ? `${base} (item ${Number(indice) + 1})` : base;
}

/** Mensagem do Zod costuma vir capitalizada; dentro de "Campo: frase" fica melhor minúscula. */
function comecarMinusculo(texto: string): string {
  if (!texto) return texto;
  // Não mexe em sigla (CPF, CNPJ, UF) nem no que já começa minúsculo.
  if (/^[A-ZÀ-Ú]{2,}\b/.test(texto)) return texto;
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** Junta os primeiros issues em uma frase só: "Empresa: obrigatório · Placa: formato inválido". */
export function mensagemDosIssues(issues: ApiIssue[], max = 3): string {
  const partes = issues.slice(0, max).map((i) => {
    const rotulo = rotuloDoCampo(i.path);
    return rotulo ? `${rotulo}: ${comecarMinusculo(i.message)}` : i.message;
  });
  const resto = issues.length - max;
  return partes.join(" · ") + (resto > 0 ? ` (e mais ${resto})` : "");
}

/** Lê `issues` do corpo do Nest, tolerando corpo de formato inesperado. */
export function extrairIssues(body: unknown): ApiIssue[] {
  if (!body || typeof body !== "object" || !("issues" in body)) return [];
  const cru = (body as { issues: unknown }).issues;
  if (!Array.isArray(cru)) return [];
  return cru.flatMap((i) => {
    if (!i || typeof i !== "object") return [];
    const { path, code, message } = i as Record<string, unknown>;
    if (typeof message !== "string" || !message) return [];
    return [{
      path: typeof path === "string" ? path : "",
      code: typeof code === "string" ? code : undefined,
      message,
    }];
  });
}

/**
 * A mensagem final que vai pro toast / faixa de erro.
 *
 * Ordem: issues do Zod (o que há de mais específico) → `message` do Nest quando
 * for útil → frase por status. "Erro de validação" sozinho nunca vence: é o
 * texto genérico que o pipe manda junto com os issues.
 */
export function mensagemDeErro(status: number, body: unknown): string {
  const issues = extrairIssues(body);
  if (issues.length > 0) return mensagemDosIssues(issues);

  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === "string" && m.trim() && m !== "Erro de validação") return m;
    if (Array.isArray(m) && m.length > 0) {
      const textos = m.filter((x): x is string => typeof x === "string" && !!x.trim());
      if (textos.length > 0) return textos.join(" · ");
    }
  }

  return mensagemPorStatus(status);
}
