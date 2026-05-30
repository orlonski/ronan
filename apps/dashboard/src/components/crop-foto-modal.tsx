"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Modal que abre uma foto pra admin recortar. Usa react-easy-crop pra
 * arrastar/zoom, depois gera um JPEG via Canvas e retorna o Blob via
 * onConfirmar (caller faz o upload).
 */
export function CropFotoModal({
  open,
  src,
  onCancel,
  onConfirmar,
}: {
  open: boolean;
  src: string;
  onCancel: () => void;
  onConfirmar: (blob: Blob) => void | Promise<void>;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPx, setAreaPx] = useState<Area | null>(null);
  const [salvando, setSalvando] = useState(false);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setAreaPx(areaPixels);
  }, []);

  async function aplicar() {
    if (!areaPx) return;
    setSalvando(true);
    try {
      const blob = await recortar(src, areaPx);
      await onConfirmar(blob);
    } finally {
      setSalvando(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between border-b border-white/10 p-3 text-white">
        <p className="font-medium">Recortar foto</p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 hover:bg-white/10"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex-1">
        {/* react-easy-crop preenche o container com posição absoluta */}
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={undefined}
          objectFit="contain"
          restrictPosition={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <div className="space-y-3 border-t border-white/10 bg-black/80 p-3 text-white">
        <div className="flex items-center gap-3">
          <span className="w-12 text-xs">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={salvando}
            className="bg-white/10 text-white hover:bg-white/20"
          >
            Cancelar
          </Button>
          <Button onClick={aplicar} disabled={salvando || !areaPx}>
            {salvando ? "Salvando…" : "Salvar recorte"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Carrega a imagem fonte, desenha o pedaço selecionado num canvas e
 * exporta JPEG 0.92. Não toca na original — gera blob novo.
 */
async function recortar(src: string, area: Area): Promise<Blob> {
  const img = await carregarImg(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar blob"))),
      "image/jpeg",
      0.92,
    );
  });
}

function carregarImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    img.src = src;
  });
}
