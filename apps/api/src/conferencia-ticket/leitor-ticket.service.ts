import { Injectable, Logger } from "@nestjs/common";
import { ClienteIaFactory } from "../ia/cliente-ia";
import { UsoIaService } from "../ia/uso-ia.service";
import { calcularUso } from "../common/ia/uso-ia";
import { provedorDoModelo } from "../common/ia/provedor-ia";
import {
  nucleoNumericoTicket,
  serieTicket,
  type Lido,
  type JulgamentoIa,
} from "../common/conferencia-ticket";

/**
 * Lê um ticket e diz se ele corresponde ao que o motorista lançou — em DUAS
 * etapas, e a separação é a razão de ser deste arquivo.
 *
 * 1. **Leitura às cegas.** A foto vai SEM o lançado. O modelo só transcreve o
 *    que está no papel.
 * 2. **Julgamento.** Uma chamada só de texto, sem imagem, recebe o lido e o
 *    lançado e diz campo a campo se correspondem (razão social × nome curto,
 *    nome técnico × comercial — semântica que regra de texto não cobre).
 *
 * Até 05/10/2026 era uma chamada só, com o lançado junto da foto. O modelo
 * devolvia o "lido" e o "confere" na mesma resposta e, quando o papel não
 * trazia um campo, COPIAVA o lançado pra coluna do lido: uma viagem saiu com
 * "Obra: ARENA — confere" num ticket sem uma letra de "ARENA". Proibir chute no
 * prompt não segura isso, porque não é chute, é cópia. O que segura é o modelo
 * não ter de onde copiar. Vale pro peso, que é o que vira dinheiro, tanto
 * quanto pra obra.
 *
 * O custo extra é a etapa 2, que não leva imagem e sai por uma fração da 1.
 */

/**
 * Último recurso, quando nem a empresa nem o ambiente escolheram modelo. Quem
 * manda de verdade é `ConfiguracaoIa.modeloConferencia` → `CONFERENCIA_MODELO`,
 * resolvidos pelo worker; isto só existe pra chamada solta (script) não quebrar.
 */
const MODELO_PADRAO = "claude-haiku-4-5-20251001";

/**
 * Instruções fixas. Sem prompt caching — o mínimo cacheável do Haiku 4.5 é 4096
 * tokens e uma conferência inteira não chega perto —, então cada palavra aqui é
 * paga em toda leitura.
 *
 * O prompt é o MESMO nos dois fornecedores de propósito: é isso que faz a
 * comparação entre eles valer alguma coisa. Ajustar o texto pra um deles
 * transformaria a medição numa comparação de prompt, não de modelo.
 *
 * ⚠️ Esta etapa NUNCA recebe o que o motorista lançou. Ver o topo do arquivo.
 */
const INSTRUCOES = `Você transcreve documentos de carga (ticket de balança, romaneio, nota fiscal) a partir de uma FOTO.

Você NÃO sabe o que foi lançado no sistema e não deve tentar adivinhar. Sua
única tarefa é dizer o que está ESCRITO no papel.

Responda APENAS um JSON puro (sem markdown, sem texto em volta):
{
  "tipoDocumento": "ticket_balanca" | "nota_fiscal" | "romaneio" | "outro",
  "legivel": true|false,
  "confidence": number,          // 0..1 — o quanto você confia na SUA LEITURA

  "numeroDocumento": "string ou null",   // o número que IDENTIFICA este documento
  "outrosNumeros": ["string"],           // os demais números de documento impressos (pedido, ticket, romaneio, NF)
  "toneladas": number ou null,           // PESO LÍQUIDO em toneladas
  "data": "AAAA-MM-DD ou null",
  "placa": "string ou null",
  "cliente": "string ou null",           // obra / cliente / destinatário, como está escrito
  "material": "string ou null"
}

SÓ O QUE ESTÁ ESCRITO:
Cada campo é uma transcrição do papel. Se o nome da obra, do cliente ou do
material não aparece escrito no documento, o campo é null — não deduza pelo
tipo de carga, pela pedreira ou pelo que "costuma ser".

QUAL NÚMERO É O DO DOCUMENTO:
- Ticket de balança: o número do ticket/romaneio/pesagem.
- Nota fiscal: o número da NF. Não confunda com número de pedido, série, chave
  de acesso ou número do ticket que às vezes vem impresso junto.
- Se o papel traz vários números de documento, ponha o principal em
  "numeroDocumento" e os demais em "outrosNumeros", como estão impressos.

A FOTO PODE ESTAR EM QUALQUER POSIÇÃO:
O motorista fotografa como dá, na beira da estrada — de pé, deitado, de cabeça
para baixo, o papel no chão ou no banco. Antes de ler qualquer tabela, oriente o
documento mentalmente e confirme de que coluna cada número veio. Ler a coluna
vizinha por causa da inclinação é a forma mais comum de errar o peso.

PESO — o erro mais caro:
- O ticket mostra BRUTO, TARA e LÍQUIDO. Use SEMPRE o LÍQUIDO.
- Rótulos variam: "LIQUIDO", "LÍQ.", "PESO LIQ", "NET", "CARGA".
- Só bruto e tara, sem líquido: calcule bruto − tara.
- Balança que imprime duas pesagens ("Pesagem Inicial" e "Pesagem Final", ou
  "1ª/2ª pesagem"): o líquido é a diferença entre as duas.
- **NUNCA use a coluna de M³, VOLUME ou METRO CÚBICO como peso.** Ela costuma
  vir colada na coluna de toneladas e é sempre um número MENOR — pegar uma pela
  outra faz a viagem ser faturada pela metade sem ninguém perceber.
- CONFIRA A SUA PRÓPRIA LEITURA: havendo bruto e tara no papel, o líquido tem
  que ser bruto − tara. Se o número que você escolheu não fecha essa conta, você
  leu a coluna errada — volte e leia de novo.
- Ponto é separador de MILHAR e vírgula é DECIMAL: "32.500 KG" = 32500 kg =
  32.5 toneladas. No JSON use ponto decimal, sem separador de milhar.
- Caminhão carregado fica entre 5 e 50 toneladas. Fora disso, revise sua leitura.

CAMPO QUE VOCÊ NÃO CONSEGUE LER É null, NUNCA UM CHUTE:
Faltou nitidez, o canto ficou fora do quadro, o carbono não marcou — responda
null naquele campo e siga. Um null custa uma conferida humana; um número
inventado com cara de certo entra no faturamento e ninguém revisa.

DATA: formato brasileiro DD/MM/AAAA. Havendo várias datas, prefira a da
PESAGEM/SAÍDA.

PLACA: transcreva como está impressa, sem hífen nem espaço. Havendo placa do
cavalo e da carreta, prefira a do cavalo mecânico.`;

/**
 * A etapa 2: só texto. Recebe o que a etapa 1 transcreveu e o que o motorista
 * lançou, e julga se correspondem.
 *
 * Ela não vê a foto, e por isso não pode "achar" no papel um valor que a
 * leitura não achou: campo sem leitura é "incerto", e o código força isso de
 * novo depois (ver `forcarSemLeitura`).
 */
const INSTRUCOES_JULGAMENTO = `Você confere se um documento de carga corresponde ao que o motorista lançou no sistema.

Recebe dois blocos:
- LIDO: o que outro leitor transcreveu da foto do documento. É tudo o que se sabe
  do papel. Campo null = não aparece ou não deu pra ler.
- LANÇADO: o que o motorista registrou.

Responda APENAS um JSON puro (sem markdown, sem texto em volta):
{
  "numeroDocumento": { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
  "toneladas":       { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
  "data":            { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
  "placa":           { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
  "cliente":         { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
  "material":        { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" }
}

CAMPO SEM LEITURA:
Se o campo é null no LIDO, a resposta é "incerto" com o porquê "não aparece no
documento". Nunca "sim": você não tem como saber o que está no papel além do
que está no LIDO.

NÚMERO DO DOCUMENTO:
- Compare o lançado com "numeroDocumento" e com "outrosNumeros". Se bater com
  qualquer um deles, é "sim".
- Prefixo de série, ponto, hífen e zero à esquerda são jeito de imprimir:
  "TKB-043625" e "043625" são o mesmo documento.

CLIENTE E MATERIAL — julgue como gente, não como texto:
- Razão social contra nome curto é a MESMA empresa: "BRONZE PAVIMENTAÇÕES LTDA"
  e "Construtora Bronze" conferem. "CASTILHO" e "CONSTRUTORA CASTILHO" conferem.
- Nome técnico contra nome comercial é o MESMO material: "C.B.U.Q. FAIXA C" e
  "MASSA DE ASFALTO" conferem (CBUQ é concreto betuminoso usinado a quente, que
  é massa asfáltica). "BGS" e "BRITA GRADUADA SIMPLES" conferem.
- Faixa, tipo, graduação e granulometria qualificam o material, não mudam o que
  ele é: "BRITA 1" e "BRITA" conferem.
- O documento costuma trazer o nome da PEDREIRA, da OBRA ou do destino, que não
  é o cliente do frete. Nesse caso responda "incerto", não "nao".
- Só responda "nao" quando forem claramente coisas diferentes — areia contra
  asfalto, uma construtora contra outra construtora sem nenhuma relação.

PESO: diferença de algumas dezenas de quilos é arredondamento de balança: "sim".

DATA: um dia de diferença é rotina (pesagem à noite, lançamento no dia
seguinte): "sim".

PLACA: ignore hífen e espaço. Dois formatos convivem hoje: o antigo (ABC-1234)
e o Mercosul (ABC1D23), que só troca o 5º caractere por uma letra. Balança com
sistema antigo imprime tudo no formato velho, e leitor de placa costuma trocar
a letra pelo número parecido (B por 6 ou 8, G por 6, S por 5, I por 1, O por 0).
Se as três letras e os três últimos dígitos batem e só o 5º caractere muda, é o
MESMO caminhão: "sim". Se a placa lida pode ser a da CARRETA e o lançamento é
do cavalo mecânico, "incerto" — não é caminhão errado.

REGRA QUE VALE MAIS QUE TODAS AS OUTRAS:
Quem lê isto é um motorista parceiro, e ele pode estar certo mesmo quando o
papel parece dizer outra coisa. Responda "nao" apenas quando tiver certeza de
que o lançamento não corresponde ao documento. Na menor dúvida responda
"incerto". Um "incerto" manda o caso pra um humano olhar, o que é barato. Um
"nao" errado acusa alguém honesto, o que não é.`;

/** Campo do julgamento → campo do `Lido` que ele julga. */
const CAMPO_LIDO: Record<keyof JulgamentoIa, keyof Lido> = {
  numeroDocumento: "ticket",
  toneladas: "toneladas",
  data: "data",
  placa: "placa",
  cliente: "clienteNome",
  material: "materialNome",
};

type FalhaLeitura = "resposta-invalida" | "foto-ilegivel" | null;

@Injectable()
export class LeitorTicketService {
  private readonly log = new Logger(LeitorTicketService.name);

  constructor(
    private readonly clientes: ClienteIaFactory,
    private readonly uso: UsoIaService,
  ) {}

  /**
   * Tem como ler alguma coisa? O worker pergunta antes de consumir a fila.
   *
   * É "existe chave de ALGUM fornecedor" e não "existe a da Anthropic": desde
   * que o MiniMax entrou, uma instalação pode rodar só com a chave dele. Quem
   * checa o fornecedor certo é a fábrica, no momento da chamada, porque só ali
   * se sabe qual modelo a empresa escolheu.
   */
  get disponivel(): boolean {
    return this.clientes.algumProvedorConfigurado;
  }

  /**
   * Lê a foto às cegas e depois julga contra o lançado. Devolve o que leu, o
   * parecer e o custo das duas etapas, ou lança se uma chamada falhar (o
   * worker distingue falha de infra de resultado ruim).
   */
  async ler(args: {
    fotoBase64: string;
    mime: string;
    declarado: Record<string, unknown>;
    modelo?: string;
  }): Promise<{
    lido: Lido;
    julgamento: JulgamentoIa;
    custoUsd: number;
    modelo: string;
    legivel: boolean;
    /**
     * Por que a leitura não serviu. `null` quando serviu.
     *
     * Existe porque "confiança 0%" juntava três coisas que pedem desfechos
     * opostos: resposta que não parseou (defeito nosso, retenta), foto que não
     * dá pra ler (o motorista precisa mandar outra) e leitura fraca mas
     * aproveitável (humano olha). Tratar as três como a mesma coisa deixava
     * todas paradas na fila de revisão sem ninguém saber o que fazer.
     */
    falha: FalhaLeitura;
  }> {
    const modelo = args.modelo || MODELO_PADRAO;
    const foto = await caberNoLimite(args.fotoBase64, args.mime, provedorDoModelo(modelo));

    // ── etapa 1: a foto, e SÓ a foto ──
    const leitura = await this.chamar(modelo, INSTRUCOES, [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: foto.mime as "image/jpeg" | "image/png" | "image/webp",
          data: foto.base64,
        },
      },
      { type: "text", text: "Transcreva o documento da foto e responda o JSON." },
    ]);

    if (!leitura.json) {
      this.log.warn("Conferência: leitura sem JSON válido");
      return {
        lido: { confianca: 0 },
        julgamento: {},
        custoUsd: leitura.custoUsd,
        modelo,
        legivel: false,
        // Não é foto ruim: o modelo respondeu algo que não é o JSON pedido.
        // Isso é defeito de execução e merece outra tentativa, não uma
        // cobrança de foto nova ao motorista.
        falha: "resposta-invalida",
      };
    }

    const parsed = leitura.json;
    const legivel = parsed.legivel !== false;
    const outrosNumeros = Array.isArray(parsed.outrosNumeros)
      ? parsed.outrosNumeros.map(str).filter((n): n is string => !!n).slice(0, 10)
      : [];
    const numeroPrincipal = str(parsed.numeroDocumento) ?? str(parsed.ticket);
    const lido: Lido = {
      tipoDocumento: str(parsed.tipoDocumento),
      ticket: escolherNumero(numeroPrincipal, outrosNumeros, args.declarado.numeroDocumento),
      toneladas: num(parsed.toneladas),
      data: str(parsed.data),
      placa: str(parsed.placa),
      clienteNome: str(parsed.cliente),
      materialNome: str(parsed.material),
      confianca: clamp01(parsed.confidence),
    };

    // Foto que não deu pra ler não tem o que julgar: economiza a etapa 2.
    if (!legivel) {
      return { falha: "foto-ilegivel", julgamento: {}, lido, custoUsd: leitura.custoUsd, modelo, legivel };
    }

    // ── etapa 2: o julgamento, só texto ──
    const paraJulgar = {
      numeroDocumento: lido.ticket ?? null,
      outrosNumeros,
      toneladas: lido.toneladas ?? null,
      data: lido.data ?? null,
      placa: lido.placa ?? null,
      cliente: lido.clienteNome ?? null,
      material: lido.materialNome ?? null,
    };
    const julgado = await this.chamar(modelo, INSTRUCOES_JULGAMENTO, [
      {
        type: "text",
        text:
          `LIDO: ${JSON.stringify(paraJulgar)}\n\n` +
          `LANÇADO: ${JSON.stringify(args.declarado)}\n\n` +
          "Responda o JSON.",
      },
    ]);
    const custoUsd = leitura.custoUsd + julgado.custoUsd;

    if (!julgado.json) {
      this.log.warn("Conferência: julgamento sem JSON válido");
      return { lido, julgamento: {}, custoUsd, modelo, legivel, falha: "resposta-invalida" };
    }

    return {
      falha: null,
      julgamento: forcarSemLeitura(lerJulgamento(julgado.json), lido),
      lido,
      custoUsd,
      modelo,
      legivel,
    };
  }

  /** Uma chamada ao modelo: registra uso e devolve o JSON (ou null) e o custo. */
  private async chamar(
    modelo: string,
    system: string,
    content: Record<string, unknown>[],
  ): Promise<{ json: Record<string, unknown> | null; custoUsd: number }> {
    // Lança `ProvedorIaNaoConfigurado` com nome quando falta a chave daquele
    // fornecedor — o worker trata como falha de infra e retenta.
    const cliente = this.clientes.para(modelo);
    const t0 = Date.now();

    try {
      const resp = await cliente.messages.create({
        model: modelo,
        // 400 era apertado demais: medindo leituras reais, a saída chega a 332
        // tokens num ticket de 6 campos com o `porque` de cada julgamento. O
        // teto cortava o JSON no meio, o parse caía no fallback de fechamento
        // balanceado e, quando nem isso salvava, a leitura virava
        // "resposta-invalida" — que RETENTA. Ou seja: economizar aqui pagava a
        // leitura duas vezes. Saída só é cobrada pelo que é gerado; folga não
        // custa nada.
        max_tokens: 800,
        // A resposta é o JSON e nada mais. No MiniMax o raciocínio vem
        // desligado por default, mas default é coisa que muda do lado deles:
        // um dia de "thinking" ligado consumiria os tokens antes do JSON
        // começar, e toda leitura viraria truncada. Pedir explicitamente fecha
        // a porta. O parâmetro não existe assim na Anthropic, daí ser
        // condicional.
        ...(provedorDoModelo(modelo) === "minimax"
          ? ({ thinking: { type: "disabled" } } as unknown as Record<string, unknown>)
          : {}),
        system,
        messages: [{ role: "user", content: content as never }],
      });

      const uso = calcularUso(modelo, resp.usage);
      this.uso.registrar({
        escopo: "conferencia",
        modelo,
        usage: resp.usage,
        duracaoMs: Date.now() - t0,
      });

      const texto = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n");
      return { json: extrairJson(texto), custoUsd: uso.custoUsd ?? 0 };
    } catch (err) {
      this.uso.registrar({
        escopo: "conferencia",
        modelo,
        duracaoMs: Date.now() - t0,
        sucesso: false,
        erro: (err as Error).message,
      });
      throw err;
    }
  }
}

/**
 * Qual número do papel vai pra coluna "No ticket".
 *
 * A leitura às cegas não sabe qual dos números impressos o motorista digitou;
 * quando um dos que ela LEU bate com o lançado, é esse que se mostra e se
 * compara. Continua sendo um número lido — o lançado só escolhe entre eles,
 * nunca entra no lugar.
 */
export function escolherNumero(
  principal: string | null,
  outros: string[],
  declarado: unknown,
): string | null {
  if (typeof declarado !== "string" || !declarado.trim()) return principal;
  const nDec = nucleoNumericoTicket(declarado);
  const sDec = serieTicket(declarado);
  if (nDec.length < 3) return principal;
  const bate = (n: string) => {
    const s = serieTicket(n);
    return nucleoNumericoTicket(n) === nDec && (!sDec || !s || s === sDec);
  };
  if (principal && bate(principal)) return principal;
  return outros.find(bate) ?? principal;
}

/**
 * Campo que a leitura não achou não pode sair "confere". O prompt do
 * julgamento já manda responder "incerto", e isto garante no código — é a
 * mesma promessa que motivou separar as etapas, e promessa de prompt não é
 * trava.
 */
export function forcarSemLeitura(j: JulgamentoIa, lido: Lido): JulgamentoIa {
  const saida: JulgamentoIa = { ...j };
  for (const campo of Object.keys(CAMPO_LIDO) as (keyof JulgamentoIa)[]) {
    const v = lido[CAMPO_LIDO[campo]];
    const vazio = v == null || (typeof v === "string" && !v.trim());
    if (vazio && saida[campo]?.confere === "sim") {
      saida[campo] = { confere: "incerto", porque: "não aparece no documento" };
    }
  }
  return saida;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const clamp01 = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

/** Tolerante a cerca markdown e a texto solto em volta do objeto. */
export function extrairJson(texto: string): Record<string, unknown> | null {
  const limpo = texto.replace(/```(?:json)?/gi, "").trim();
  const inicio = limpo.indexOf("{");
  if (inicio < 0) return null;
  const resto = limpo.slice(inicio);
  try {
    return JSON.parse(resto) as Record<string, unknown>;
  } catch {
    // Corta no primeiro fechamento balanceado — cobre resposta truncada.
    let nivel = 0;
    for (let i = 0; i < resto.length; i++) {
      if (resto[i] === "{") nivel++;
      else if (resto[i] === "}") {
        nivel--;
        if (nivel === 0) {
          try {
            return JSON.parse(resto.slice(0, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

/**
 * O parecer da IA, campo a campo.
 *
 * Vem separado do que ela LEU de propósito: o que ela leu vai pra tela, pra
 * pessoa comparar com os próprios olhos; o parecer é o que decide o veredito.
 * Qualquer valor que não seja exatamente "sim" ou "nao" vira `incerto` — na
 * dúvida, humano olha.
 */
function lerJulgamento(bruto: unknown): JulgamentoIa {
  const j: JulgamentoIa = {};
  if (!bruto || typeof bruto !== "object") return j;
  const campos = ["numeroDocumento", "toneladas", "data", "placa", "cliente", "material"] as const;
  for (const campo of campos) {
    const item = (bruto as Record<string, unknown>)[campo];
    if (!item || typeof item !== "object") continue;
    const confere = (item as Record<string, unknown>).confere;
    const porque = (item as Record<string, unknown>).porque;
    j[campo] = {
      confere: confere === "sim" ? "sim" : confere === "nao" ? "nao" : "incerto",
      porque: typeof porque === "string" ? porque.slice(0, 300) : "",
    };
  }
  return j;
}

/**
 * A Anthropic recusa imagem acima de 5 MB com 400 — e foto de celular passa
 * disso. A primeira leitura roda no MiniMax, que aceita; a SEGUNDA, no Claude,
 * falhava sempre nessas fotos. Durante semanas isso foi engolido (a segunda
 * opinião falhando só "não escalava"); quando divergência passou a exigir a
 * confirmação, virou 14 viagens em FALHOU numa noite (29/09/2026).
 *
 * Reduzir não custa leitura: o modelo trabalha com o lado maior em ~1.568 px,
 * então 2.000 px já é mais do que ele usa. Só mexe quando precisa, e sem
 * `sharp` (binário nativo, pode faltar no build) manda como está.
 */
const LIMITE_BASE64_ANTHROPIC = 4_800_000;

export async function caberNoLimite(
  base64: string,
  mime: string,
  provedor: string,
): Promise<{ base64: string; mime: string }> {
  if (provedor !== "anthropic" || base64.length <= LIMITE_BASE64_ANTHROPIC) return { base64, mime };
  try {
    const sharp = (await import("sharp")).default;
    const reduzida = await sharp(Buffer.from(base64, "base64"))
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { base64: reduzida.toString("base64"), mime: "image/jpeg" };
  } catch {
    return { base64, mime };
  }
}
