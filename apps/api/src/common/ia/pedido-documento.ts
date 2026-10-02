import type {
  CampoCadastroLido,
  CampoLidoPedido,
  ConfiancaCampo,
  ExtrairPedidoResult,
  UnidadePedidoTipo,
} from "@ronan/shared-types";

/**
 * Pedido lido de documento: o que a IA devolveu, conferido e casado com o
 * cadastro DA CONTA.
 *
 * Regra pura (sem Prisma, sem Anthropic) pra ser testada com JSON de verdade.
 * Quem chama a IA é o `IaService.lerPedidoDocumento`; quem carrega o catálogo é
 * o `PedidoDocumentoService`.
 *
 * Princípio: campo vazio é muito melhor que campo errado. A pessoa vai
 * conferir o que veio preenchido — o que não veio ela vê que precisa digitar.
 * Por isso nada aqui "chuta": casamento ambíguo fica vazio, número fora do
 * plausível some, e unidade que o pedido não mede vira aviso em vez de virar
 * VIAGENS por omissão (300 m³ não são 300 viagens).
 */

export type ItemCatalogo = { id: string; nome: string; apelidos?: string[] };

export type CatalogoPedido = {
  empresas: (ItemCatalogo & { razaoSocial?: string | null; cnpj?: string | null })[];
  obras: (ItemCatalogo & { empresaId: string })[];
  materiais: ItemCatalogo[];
  locais: (ItemCatalogo & {
    logradouro?: string | null;
    numero?: string | null;
    cidade?: string | null;
    uf?: string | null;
  })[];
};

/**
 * Mesma normalização do OCR de ticket (`normalizar` em ia.service): caixa,
 * acento e pontuação não distinguem cadastro. Cópia de 5 linhas em vez de
 * import pra manter este arquivo puro — o ia.service puxa Nest e o SDK.
 */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Sufixos de razão social que não identificam ninguém. "Construtora Alvorada
 * Ltda" e "Construtora Alvorada" são a mesma empresa; sem tirar o "ltda", o
 * casamento exato falha e cai no parcial, que vale confiança menor.
 */
function semSufixoSocietario(s: string): string {
  return s.replace(/\b(ltda|me|epp|eireli|s\/?a|sa|cia)\b\.?/gi, " ");
}

type Casamento = { id: string; confianca: ConfiancaCampo } | null;

/**
 * Casa um texto lido com um item do catálogo.
 *
 * - exato (depois de normalizar) em nome/apelido/extra → ALTA;
 * - parcial (prefixo ≥4, ou um contido no outro ≥6) → MEDIA, e ganha quem
 *   explica mais do texto (o mais longo) — mesma regra do ticket, pelo mesmo
 *   motivo: "Brita Graduada" não pode cair em "Brita" por ordem do banco.
 *
 * Diferente do ticket, EMPATE no parcial não escolhe ninguém: dois cadastros
 * igualmente plausíveis é exatamente a dúvida que a pessoa tem que resolver.
 */
export function casar<T extends ItemCatalogo>(
  bruto: string | undefined,
  itens: T[],
  extras: (item: T) => (string | null | undefined)[] = () => [],
): Casamento {
  if (!bruto) return null;
  const alvo = normalizar(semSufixoSocietario(bruto));
  if (!alvo) return null;

  const chaves = (item: T) =>
    [item.nome, ...(item.apelidos ?? []), ...extras(item)]
      .filter((c): c is string => !!c && !!c.trim())
      .map((c) => normalizar(semSufixoSocietario(c)))
      .filter(Boolean);

  const exatos = new Set<string>();
  for (const item of itens) if (chaves(item).includes(alvo)) exatos.add(item.id);
  if (exatos.size === 1) return { id: [...exatos][0]!, confianca: "ALTA" };
  if (exatos.size > 1) return null;

  if (alvo.length < 4) return null;
  let melhor: string[] = [];
  let melhorTam = 0;
  for (const item of itens) {
    for (const n of chaves(item)) {
      if (n.length < 4 || n.length < melhorTam) continue;
      const prefixo = n.startsWith(alvo) || alvo.startsWith(n);
      const contido = n.length >= 6 && alvo.length >= 6 && (alvo.includes(n) || n.includes(alvo));
      if (!prefixo && !contido) continue;
      if (n.length > melhorTam) {
        melhor = [item.id];
        melhorTam = n.length;
      } else if (!melhor.includes(item.id)) {
        melhor.push(item.id);
      }
    }
  }
  return melhor.length === 1 ? { id: melhor[0]!, confianca: "MEDIA" } : null;
}

// ---------------------------------------------------------------------------
// Leitura defensiva do JSON da IA
// ---------------------------------------------------------------------------

function texto(v: unknown, max = 300): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || /^(null|undefined|n\/a|-+)$/i.test(t)) return undefined;
  return t.slice(0, max);
}

/** Número em formato brasileiro ou já numérico. "1.200,5" → 1200.5; "300" → 300. */
export function lerNumero(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let t = v.replace(/[^\d,.-]/g, "");
  if (!t) return undefined;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  // "1.200" sem vírgula: ponto com exatamente 3 dígitos depois é milhar no
  // Brasil. "12.5" segue decimal (a IA às vezes já devolve assim).
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** AAAA-MM-DD ou DD/MM/AAAA → AAAA-MM-DD, recusando data impossível. */
export function lerData(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let a = 0;
  let m = 0;
  let d = 0;
  if (br) [a, m, d] = [Number(br[3]!.length === 2 ? `20${br[3]}` : br[3]), Number(br[2]), Number(br[1])];
  else if (iso) [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  if (!a) return undefined;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

type UnidadeLida =
  | { tipo: "VIAGENS" | "TONELADAS"; fator: number }
  | { tipo: "M3" }
  | { tipo: "DESCONHECIDA" };

/**
 * A unidade como o documento escreveu. m³ é testado no texto CRU: o "³" não
 * sobrevive à normalização ("m³" viraria "m", que é metro — ou nada).
 */
export function lerUnidade(bruto: string | undefined): UnidadeLida | undefined {
  if (!bruto) return undefined;
  if (/m\s*³|\bm\s*3\b|metros?\s*c[uú]bicos?|\bmc\b/i.test(bruto)) return { tipo: "M3" };
  const n = normalizar(bruto);
  if (!n) return undefined;
  if (/^(kg|kgs|quilo|quilos|quilograma|quilogramas)$/.test(n)) return { tipo: "TONELADAS", fator: 0.001 };
  if (/^(t|ton|tons|tonelada|toneladas|tn)$/.test(n)) return { tipo: "TONELADAS", fator: 1 };
  if (/^(viagem|viagens|carga|cargas|caminhao|caminhoes|caminhaos|frete|fretes|carrada|carradas|basculante|basculantes)$/.test(n)) {
    return { tipo: "VIAGENS", fator: 1 };
  }
  return { tipo: "DESCONHECIDA" };
}

const QTD_MAX = 999_999.999;

/**
 * Converte o JSON cru da IA na sugestão do formulário.
 *
 * `unidadesAceitas` vem de `UNIDADES_PEDIDO` (shared-types). É lista e não
 * constante de propósito: quando o pedido passar a medir em m³, a leitura
 * começa a preencher m³ sozinha, sem mexer aqui.
 */
export function pedidoDoJson(
  bruto: unknown,
  catalogo: CatalogoPedido,
  opts: { unidadesAceitas: readonly string[]; hoje: string; origem: ExtrairPedidoResult["origem"] },
): ExtrairPedidoResult {
  const p: Record<string, unknown> = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const avisos: string[] = [];

  const confianca =
    typeof p.confidence === "number" && Number.isFinite(p.confidence)
      ? Math.min(1, Math.max(0, p.confidence))
      : 0;

  if (p.ehPedido === false) {
    avisos.push("O documento não parece um pedido de transporte. Confira tudo antes de usar.");
  }

  // --- quem pediu e a obra --------------------------------------------------
  const empresaLida = texto(p.cliente);
  const cnpjLido = texto(p.cnpjCliente)?.replace(/\D/g, "");
  const obraLida = texto(p.obra);

  const empresa: CampoCadastroLido = { lido: empresaLida };
  const porCnpj =
    cnpjLido && cnpjLido.length === 14
      ? catalogo.empresas.filter((e) => (e.cnpj ?? "").replace(/\D/g, "") === cnpjLido)
      : [];
  const casEmpresa: Casamento =
    porCnpj.length === 1
      ? { id: porCnpj[0]!.id, confianca: "ALTA" }
      : casar(empresaLida, catalogo.empresas, (e) => [e.razaoSocial]);
  if (casEmpresa) Object.assign(empresa, { valor: casEmpresa.id, confianca: casEmpresa.confianca });
  if (cnpjLido && !empresa.lido) empresa.lido = texto(p.cnpjCliente);

  const obra: CampoCadastroLido = { lido: obraLida };
  // Com a empresa achada, a obra só pode ser dela: "Obra Centro" existe em
  // vários clientes, e casar com a do vizinho é pior que deixar vazio.
  const obrasPossiveis = empresa.valor
    ? catalogo.obras.filter((o) => o.empresaId === empresa.valor)
    : catalogo.obras;
  const casObra = casar(obraLida, obrasPossiveis);
  if (casObra) {
    Object.assign(obra, { valor: casObra.id, confianca: casObra.confianca });
    // A obra diz de quem é: sem empresa lida (ou-lida mas não casada), herda.
    if (!empresa.valor) {
      const dona = catalogo.obras.find((o) => o.id === casObra.id)?.empresaId;
      if (dona) Object.assign(empresa, { valor: dona, confianca: "MEDIA" as const });
    }
  }

  // --- material ---------------------------------------------------------------
  const materialLido = texto(p.material);
  const material: CampoCadastroLido = { lido: materialLido };
  const casMaterial = casar(materialLido, catalogo.materiais);
  if (casMaterial) Object.assign(material, { valor: casMaterial.id, confianca: casMaterial.confianca });

  // --- locais -----------------------------------------------------------------
  const enderecoLido = texto(p.enderecoEntrega, 400);
  const cidadeLida = texto(p.cidadeEntrega);
  const localDescarga: CampoCadastroLido = {
    lido: [enderecoLido, cidadeLida].filter(Boolean).join(" — ") || undefined,
  };
  // 1º pelo nome do local (o cadastro costuma ter o nome da obra), 2º pelo
  // endereço: rua + número contidos no endereço lido, na mesma cidade.
  const casDescarga =
    casar(enderecoLido, catalogo.locais) ??
    rebaixar(casar(obraLida, catalogo.locais)) ??
    casarPorEndereco(enderecoLido, cidadeLida, catalogo.locais);
  if (casDescarga) Object.assign(localDescarga, { valor: casDescarga.id, confianca: casDescarga.confianca });

  const cargaLida = texto(p.localCarga);
  const localCarga: CampoCadastroLido = { lido: cargaLida };
  const casCarga = casar(cargaLida, catalogo.locais);
  if (casCarga) Object.assign(localCarga, { valor: casCarga.id, confianca: casCarga.confianca });

  // O nome do cadastro vai junto pro combobox mostrar o rótulo sem buscar.
  const nomear = (campo: CampoCadastroLido, itens: ItemCatalogo[]) => {
    const item = campo.valor ? itens.find((x) => x.id === campo.valor) : undefined;
    if (item) campo.nome = item.nome;
  };
  nomear(empresa, catalogo.empresas);
  nomear(obra, catalogo.obras);
  nomear(material, catalogo.materiais);
  for (const campo of [localDescarga, localCarga]) {
    const local = campo.valor ? catalogo.locais.find((x) => x.id === campo.valor) : undefined;
    if (!local) continue;
    Object.assign(campo, { nome: local.nome, cidade: local.cidade ?? null, uf: local.uf ?? null });
  }
  if (empresaLida && !empresa.valor) {
    avisos.push(`Não achei "${empresaLida}" entre os clientes cadastrados.`);
  }
  if (materialLido && !material.valor) {
    avisos.push(`Não achei o material "${materialLido}" no cadastro.`);
  }

  // --- quantidade e unidade ---------------------------------------------------
  const qtdTexto = texto(p.quantidade);
  const unidadeTexto = texto(p.unidade);
  const qtdLida = lerNumero(p.quantidade);
  const quantidade: CampoLidoPedido<number> = {
    lido: [qtdTexto, unidadeTexto].filter(Boolean).join(" ") || undefined,
  };
  const unidade: CampoLidoPedido<UnidadePedidoTipo> = { lido: unidadeTexto };
  const un = lerUnidade(unidadeTexto);

  if (qtdLida != null) {
    if (un?.tipo === "M3") {
      if (opts.unidadesAceitas.includes("M3")) {
        unidade.valor = "M3" as UnidadePedidoTipo;
        unidade.confianca = "ALTA";
        quantidade.valor = qtdLida;
      } else {
        // Sem m³ no pedido, preencher a quantidade com a unidade padrão
        // (viagens) faria 300 m³ virar 300 viagens. Fica vazio e explicado.
        avisos.push(
          `O documento pede ${qtdTexto} m³. O pedido ainda não mede em m³: converta pra toneladas ou viagens antes de salvar.`,
        );
      }
    } else if (un?.tipo === "VIAGENS" || un?.tipo === "TONELADAS") {
      unidade.valor = un.tipo;
      unidade.confianca = "ALTA";
      quantidade.valor = Math.round(qtdLida * un.fator * 1000) / 1000;
    } else if (un?.tipo === "DESCONHECIDA") {
      avisos.push(`Não sei medir "${unidadeTexto}". Escolha viagens ou toneladas e confira a quantidade.`);
    } else {
      // Número sem unidade: preenche, mas a unidade quem escolhe é a pessoa.
      quantidade.valor = qtdLida;
      quantidade.confianca = "BAIXA";
      avisos.push("O documento não diz se a quantidade é em viagens ou toneladas. Confira a unidade.");
    }
    if (quantidade.valor != null) {
      if (quantidade.valor <= 0 || quantidade.valor > QTD_MAX) {
        quantidade.valor = undefined;
        quantidade.confianca = undefined;
      } else if (!quantidade.confianca) {
        quantidade.confianca = "ALTA";
      }
    }
  }

  // --- datas ------------------------------------------------------------------
  const inicioEm = campoData(p.inicio, opts.hoje);
  const prazoEm = campoData(p.prazo, opts.hoje);
  for (const [rotulo, c] of [["início", inicioEm], ["prazo", prazoEm]] as const) {
    if (c.lido && !c.valor) avisos.push(`Não entendi a data de ${rotulo} ("${c.lido}").`);
  }
  if (inicioEm.valor && prazoEm.valor && prazoEm.valor < inicioEm.valor) {
    avisos.push(`O prazo lido (${prazoEm.lido}) é antes do início. Confira as datas.`);
    prazoEm.valor = undefined;
    prazoEm.confianca = undefined;
  }

  // --- observação + contato ---------------------------------------------------
  const obsLida = texto(p.observacao, 800);
  const contatoLido = texto(p.contato, 160);
  const observacaoTexto = [obsLida, contatoLido ? `Contato: ${contatoLido}` : undefined]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1000);
  const observacao: CampoLidoPedido<string> = observacaoTexto
    ? { valor: observacaoTexto, lido: obsLida, confianca: "ALTA" }
    : {};
  const contato: CampoLidoPedido<string> = contatoLido ? { valor: contatoLido, lido: contatoLido, confianca: "ALTA" } : {};

  // Leitura que a própria IA chamou de duvidosa não sustenta "ALTA" em nada.
  if (confianca < 0.5) {
    for (const c of [empresa, obra, material, localCarga, localDescarga, quantidade, unidade, inicioEm, prazoEm]) {
      if (c.confianca === "ALTA") c.confianca = "MEDIA";
    }
    avisos.push("A leitura saiu com pouca certeza (documento ruim ou cortado). Confira cada campo.");
  }

  return {
    origem: opts.origem,
    empresa,
    obra,
    material,
    localCarga,
    localDescarga,
    quantidade,
    unidade,
    inicioEm,
    prazoEm,
    observacao,
    contato,
    avisos,
    confianca,
  };
}

/** Casar o local pelo nome da OBRA é dedução, não leitura do endereço: no máximo MEDIA. */
function rebaixar(c: Casamento): Casamento {
  return c ? { id: c.id, confianca: "MEDIA" } : null;
}

function campoData(v: unknown, hoje: string): CampoLidoPedido<string> {
  const lido = texto(v, 40);
  const valor = lerData(v);
  if (!valor) return { lido };
  // Data a mais de 2 anos de hoje é leitura errada (ano trocado, data de
  // emissão do CNPJ…), não pedido de verdade.
  if (Math.abs(diasEntre(hoje, valor)) > 730) return { lido };
  return { valor, lido, confianca: "ALTA" };
}

/**
 * Casa pelo endereço quando o nome não bate: a rua e o número do cadastro
 * precisam aparecer no endereço lido, e a cidade (se lida) tem que ser a
 * mesma. Rua sozinha não basta — "Rua XV de Novembro" tem em toda cidade.
 */
function casarPorEndereco(
  endereco: string | undefined,
  cidade: string | undefined,
  locais: CatalogoPedido["locais"],
): Casamento {
  if (!endereco) return null;
  const alvo = normalizar(endereco);
  const cidadeAlvo = cidade ? normalizar(cidade) : null;
  const achados = locais.filter((l) => {
    if (!l.logradouro || !l.numero) return false;
    const rua = normalizar(l.logradouro);
    if (rua.length < 6 || !alvo.includes(rua)) return false;
    // O número precisa vir logo depois da rua ("rua x 123"), senão um CEP ou
    // um telefone qualquer com os mesmos dígitos casaria.
    if (!alvo.includes(rua + normalizar(l.numero))) return false;
    const cidadeLocal = l.cidade ? normalizar(l.cidade) : null;
    if (cidadeAlvo && cidadeLocal && cidadeAlvo !== cidadeLocal) return false;
    if (!cidadeAlvo && cidadeLocal && !alvo.includes(cidadeLocal)) return false;
    return true;
  });
  return achados.length === 1 ? { id: achados[0]!.id, confianca: "MEDIA" } : null;
}

/**
 * O catálogo no prompt, no formato barato do ticket ("nome|apelido"). Serve pra
 * IA devolver o nome como está no cadastro quando reconhecer; quem decide o id
 * é o `casar` acima. Locais não vão: são muitos e casam pelo endereço aqui.
 * O teto por lista segura o custo em conta grande — passar disso a IA devolve
 * o texto cru e o casamento no servidor resolve do mesmo jeito.
 */
export function catalogoPedidoParaPrompt(catalogo: CatalogoPedido, teto = 300): string {
  const linhas = (itens: ItemCatalogo[]) =>
    itens
      .slice(0, teto)
      .map((i) => [i.nome, ...(i.apelidos ?? [])].filter(Boolean).join("|"))
      .join("\n") || "(nenhum)";
  return [
    "Cadastrados no sistema (primeiro nome da linha = o que devolver):",
    "",
    "CLIENTES (quem pede/paga):",
    linhas(catalogo.empresas),
    "",
    "OBRAS:",
    linhas(catalogo.obras),
    "",
    "MATERIAIS:",
    linhas(catalogo.materiais),
  ].join("\n");
}

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** A data de hoje com o dia da semana — sem isso "a partir de segunda" não tem âncora. */
export function referenciaDeHoje(hoje: string): string {
  const dia = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  return `Hoje é ${hoje} (${DIAS_SEMANA[dia]}).`;
}

/**
 * Instruções fixas (sem interpolação): cada palavra é paga em toda leitura, e
 * mantê-las constantes deixa a porta aberta pra cache de prompt se o modelo
 * mudar pra um que cacheie prefixo deste tamanho.
 */
export const INSTRUCOES_PEDIDO_DOCUMENTO = `Você lê pedidos de transporte de carga a granel (brita, areia, terra, asfalto, concreto) enviados a uma transportadora de caminhões: ordem de compra em PDF, foto de documento ou e-mail.
Responda SÓ com um objeto JSON, sem markdown e sem texto em volta:
{
  "ehPedido": true ou false,
  "cliente": "quem pede e paga (empresa/construtora)",
  "cnpjCliente": "CNPJ de quem pede, se houver",
  "obra": "nome da obra/frente de serviço",
  "enderecoEntrega": "endereço onde descarregar (rua, número, bairro)",
  "cidadeEntrega": "cidade da entrega",
  "localCarga": "onde carregar (pedreira, areal, usina), se dito",
  "material": "material pedido",
  "quantidade": número,
  "unidade": "como o documento mede: viagens, cargas, toneladas, kg, m³…",
  "inicio": "AAAA-MM-DD",
  "prazo": "AAAA-MM-DD",
  "observacao": "o que mais importa pra executar (horário, restrição de acesso, tipo de caminhão)",
  "contato": "nome e telefone de quem pediu",
  "confidence": 0 a 1
}
Regras:
- Campo que não está no documento: deixe de fora. Não invente e não complete com suposição. Campo vazio é melhor que campo errado — uma pessoa vai conferir.
- Quem pede é o CLIENTE da transportadora (o comprador do frete), não a transportadora nem o fornecedor do material. Em ordem de compra, é quem emite a ordem.
- Depois destas instruções vem a lista do que já está cadastrado. Se o que você leu corresponder a um item, devolva o primeiro nome daquela linha, como está escrito lá. Se não corresponder, devolva o texto como leu. Compare ignorando caixa, acento, pontuação e sufixos como LTDA/ME/S.A.
- Números em formato brasileiro: ponto é milhar e vírgula é decimal ("1.200,5" = 1200.5). No JSON, use número com ponto decimal e sem milhar.
- Quantidade e unidade: copie a unidade como está. "300 m³" → quantidade 300, unidade "m³". "20 cargas" → 20, "cargas". "500 t" → 500, "t". Não converta entre unidades.
- Datas: formato brasileiro DD/MM é dia/mês. Datas relativas ("a partir de segunda", "até sexta", "semana que vem") calcule a partir da data de hoje informada na mensagem; "segunda" é a PRÓXIMA segunda a partir de hoje. "inicio" é quando começa a entrega; "prazo" é até quando tem que estar entregue. Sem data, deixe de fora.
- Mais de um item no pedido: use o principal (o de maior quantidade) e cite os outros em "observacao".
- confidence: o quanto o documento estava claro (0 = ilegível ou não é pedido, 1 = tudo claro).
- Se não for um pedido de transporte, devolva "ehPedido": false e confidence baixa.`;

// ---------------------------------------------------------------------------
// O arquivo que chegou
// ---------------------------------------------------------------------------

export type TipoArquivoPedido =
  | { tipo: "pdf" }
  | { tipo: "imagem"; mime: "image/jpeg" | "image/png" | "image/webp" };

/**
 * O tipo pelo CONTEÚDO (assinatura dos primeiros bytes), não pelo `mimetype`
 * que o navegador declarou. A Anthropic recusa base64 que não bate com o
 * `media_type` informado — e isso voltaria como erro de servidor de uma
 * leitura que era só arquivo trocado (um .docx renomeado pra "pedido.pdf").
 */
export function tipoDoArquivo(buf: Buffer): TipoArquivoPedido | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { tipo: "pdf" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { tipo: "imagem", mime: "image/jpeg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { tipo: "imagem", mime: "image/png" };
  }
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return { tipo: "imagem", mime: "image/webp" };
  }
  return null;
}

/**
 * Páginas de um PDF, por contagem de `/Type /Page` (sem o "s" de `/Pages`).
 *
 * É estimativa barata, sem biblioteca: PDF com object streams comprimidos
 * esconde os objetos e a conta dá 0. Zero, aqui, quer dizer "não sei" — e aí
 * quem segura é o teto de bytes e o limite da própria Anthropic.
 */
export function contarPaginasPdf(buf: Buffer): number {
  const s = buf.toString("latin1");
  return (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}
