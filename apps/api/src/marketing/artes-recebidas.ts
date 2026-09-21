import { BadRequestException } from "@nestjs/common";
import { SLIDES_MAX } from "./instagram-fila.service";

/** Teto da Meta por imagem. Acima disto a Content Publishing API recusa. */
const TETO_BYTES = 8 * 1024 * 1024;

/**
 * As artes de um post, validadas na porta de entrada.
 *
 * Aqui e não no worker de propósito: JPEG errado ou arquivo grande demais pego
 * no enfileiramento vira mensagem na tela de quem mandou; pego no worker vira
 * um FALHOU silencioso três dias depois, quando o post não sai.
 *
 * **A ordem é a do upload.** Multer entrega os arquivos na ordem em que
 * aparecem no corpo multipart, e é essa ordem que vira `ordem` no banco e a
 * ordem em que o leitor desliza o carrossel. Não reordenar por nome de arquivo:
 * "slide-10.jpg" viria antes de "slide-2.jpg" e o carrossel sairia embaralhado
 * sem erro nenhum.
 *
 * Aceita tanto `artes` (várias) quanto `arte` (uma) — o segundo é o formato que
 * o painel e as versões antigas do `enfileirar.mjs` mandam.
 */
export function validarArtes(arquivos: Express.Multer.File[] | undefined): Express.Multer.File[] {
  const artes = (arquivos ?? []).filter(
    (a) => a.fieldname === "arte" || a.fieldname === "artes",
  );

  if (artes.length === 0) {
    throw new BadRequestException("Mande a arte no campo `artes` (ou `arte`, pra imagem única)");
  }
  if (artes.length > SLIDES_MAX) {
    throw new BadRequestException(
      `São ${artes.length} imagens; o carrossel do Instagram aceita no máximo ${SLIDES_MAX}.`,
    );
  }

  artes.forEach((arte, i) => {
    // Só nomeia o slide quando há mais de um: "a arte do slide 1 de 1" é ruído.
    const qual = artes.length > 1 ? ` do slide ${i + 1}` : "";
    if (!arte.mimetype.includes("jpeg") && !arte.mimetype.includes("jpg")) {
      throw new BadRequestException(
        `A arte${qual} precisa ser JPEG — a API do Instagram não aceita PNG`,
      );
    }
    if (arte.size > TETO_BYTES) {
      throw new BadRequestException(`A arte${qual} passa de 8 MB, que é o teto do Instagram`);
    }
  });

  return artes;
}
