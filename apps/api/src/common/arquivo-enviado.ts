import { BadRequestException } from "@nestjs/common";

/**
 * O QUE PODE ENTRAR. Uma lista, um teto, uma mensagem.
 *
 * ⚠️ A regra estava reescrita em oito lugares, com quatro listas diferentes — e
 * onde a regra não tem dono, ela FALTA. Dois caminhos subiam arquivo sem
 * conferir tipo nenhum: o comprovante do frete pessoal e o anexo que o agente
 * do WhatsApp baixa da conversa. Não era decisão de ninguém; era a cópia que
 * não foi feita.
 *
 * ⚠️ E por que o tipo importa mesmo com o bucket privado: o `mimetype` que
 * chega é gravado junto do arquivo e volta como `Content-Type` quando a API
 * serve de novo. Aceitar qualquer coisa é aceitar servir qualquer coisa do
 * nosso domínio — inclusive `text/html`. O bucket do MinIO é anônimo e nunca
 * ganha domínio público justamente por isso; a checagem aqui é a outra metade.
 */

/** Foto: o que câmera e galeria produzem. */
export const MIMES_IMAGEM = [
  "image/jpeg",
  // Algumas galerias do Android mandam `image/jpg`, que não existe no padrão
  // mas chega assim. Recusar seria recusar foto boa.
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

/** Documento: foto ou PDF. É o que o escritório aceita de papel. */
export const MIMES_DOCUMENTO = [...MIMES_IMAGEM, "application/pdf"] as const;

/** O mínimo que qualquer porta conhece do que chegou. */
type ArquivoEnviado = { mimetype: string; originalname?: string; size?: number };

const MB = 1024 * 1024;

function emMB(bytes: number): string {
  const v = bytes / MB;
  return Number.isInteger(v) ? `${v}` : v.toFixed(1).replace(".", ",");
}

/**
 * Recusa o que não pode entrar, com a frase que a pessoa consegue agir em cima.
 *
 * `tamanho` é opcional porque nem toda origem tem `size`: o que vem do
 * WhatsApp chega como buffer, e aí o tamanho é o `length` dele. Quem não
 * passar tamanho nenhum não é checado — e isso é explícito, não esquecimento.
 */
export function checarArquivoEnviado<T extends ArquivoEnviado>(
  arquivo: T | null | undefined,
  regra: {
    mimes: readonly string[];
    maxBytes: number;
    /**
     * Escape por EXTENSÃO, pro que o sistema operacional não sabe nomear.
     *
     * O caso real: `.p7s` e `.p7m` do assinador do gov.br chegam como
     * `application/octet-stream`. Recusar pelo mime jogaria fora justamente o
     * documento assinado, que é o que o contratante pediu.
     */
    extensoesTambem?: readonly string[];
    /** Como chamar o que é aceito, na mensagem de erro. */
    comoDizer?: string;
  },
  // `asserts` e não `void`: depois de chamar, quem chamou tem o arquivo NÃO
  // nulo pelo tipo. Sem isto, cada porta precisava de um `if (!file) throw`
  // logo antes — e era justamente esse par de linhas repetido que fazia a
  // regra parecer barata de copiar.
): asserts arquivo is T {
  if (!arquivo) throw new BadRequestException("Nenhum arquivo enviado.");

  const nome = (arquivo.originalname ?? "").toLowerCase();
  const porExtensao = (regra.extensoesTambem ?? []).some((e) => nome.endsWith(e));
  if (!regra.mimes.includes(arquivo.mimetype) && !porExtensao) {
    throw new BadRequestException(
      regra.comoDizer ?? "Esse tipo de arquivo não serve aqui. Mande uma foto ou um PDF.",
    );
  }

  if (arquivo.size != null && arquivo.size > regra.maxBytes) {
    throw new BadRequestException(
      `O arquivo é grande demais. O limite é ${emMB(regra.maxBytes)} MB.`,
    );
  }
}
