/**
 * Captura e compressão de fotos pelo browser. Espelha o expo-image-manipulator
 * do nativo: redimensiona max 1920px no maior lado, exporta JPEG 0.7.
 *
 * Volume típico do ticket: foto 4MB → ~250KB depois da compressão.
 */

export type FotoComprimida = {
  blob: Blob;
  mime: string;
  dataUrl: string;
  base64: string;
};

const MAX_DIMENSAO = 1920;
const JPEG_QUALIDADE = 0.7;

export async function comprimirFoto(file: File | Blob): Promise<FotoComprimida> {
  const bitmap = await loadBitmap(file);
  const { width, height } = redimensionar(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponível neste navegador.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar JPEG."))),
      "image/jpeg",
      JPEG_QUALIDADE,
    );
  });

  const dataUrl = await blobParaDataUrl(blob);
  const base64 = dataUrl.split(",")[1] ?? "";
  return { blob, mime: "image/jpeg", dataUrl, base64 };
}

async function loadBitmap(file: File | Blob): Promise<ImageBitmap & { close?: () => void }> {
  // createImageBitmap aceita orientação EXIF — corrige fotos do iPhone tiradas em retrato.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* Safari < 16 não suporta from-image — cai pro fallback */
    }
  }
  return await loadViaImg(file);
}

function loadViaImg(file: File | Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Cast pra ImageBitmap-compatible (drawImage aceita HTMLImageElement)
      resolve(img as unknown as ImageBitmap);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}

function redimensionar(w: number, h: number): { width: number; height: number } {
  const maior = Math.max(w, h);
  if (maior <= MAX_DIMENSAO) return { width: w, height: h };
  const factor = MAX_DIMENSAO / maior;
  return { width: Math.round(w * factor), height: Math.round(h * factor) };
}

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader falhou"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export function blobParaObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
