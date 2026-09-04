/**
 * Compressão de imagem no navegador, pro que o painel manda pros motoristas.
 *
 * Espelha o `lib/photo.ts` do PWA e o expo-image-manipulator do app nativo: o
 * motorista já sobe foto comprimida, e o que sai DAQUI é baixado por dezenas de
 * celulares em 4G de estrada — mandar o arquivo cru da câmera seria fazer todo
 * mundo pagar o download de 3 MB pra ver a mesma imagem numa tela de 6".
 *
 * 1440px no maior lado cobre folgado tanto a bolha do chat quanto o story em
 * tela cheia; JPEG 0.72 é onde a diferença deixa de ser visível no celular.
 */

const MAX_DIMENSAO = 1440;
const JPEG_QUALIDADE = 0.72;

export type ImagemComprimida = {
  arquivo: File;
  bytesOriginais: number;
  bytesFinais: number;
};

export async function comprimirImagem(file: File): Promise<ImagemComprimida> {
  const bitmap = await carregarBitmap(file);
  const { width, height } = redimensionar(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponível neste navegador.");
  // Fundo branco antes de desenhar: PNG com transparência vira JPEG, e sem isso
  // a parte transparente fica preta (arte com fundo vazado ficaria ilegível).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar JPEG."))),
      "image/jpeg",
      JPEG_QUALIDADE,
    );
  });

  const nome = file.name.replace(/\.[^.]+$/, "") || "foto";
  return {
    arquivo: new File([blob], `${nome}.jpg`, { type: "image/jpeg" }),
    bytesOriginais: file.size,
    bytesFinais: blob.size,
  };
}

/** "1,8 MB" / "184 KB" — pro painel mostrar o que economizou. */
export function formatarBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function carregarBitmap(
  file: File,
): Promise<ImageBitmap & { close?: () => void }> {
  // createImageBitmap respeita a orientação do EXIF — foto de iPhone em retrato
  // não sai deitada.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Navegador sem a opção: cai no <img> abaixo.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não consegui ler a imagem."));
      el.src = url;
    });
    return img as unknown as ImageBitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function redimensionar(w: number, h: number): { width: number; height: number } {
  const maior = Math.max(w, h);
  if (maior <= MAX_DIMENSAO) return { width: w, height: h };
  const fator = MAX_DIMENSAO / maior;
  return { width: Math.round(w * fator), height: Math.round(h * fator) };
}
