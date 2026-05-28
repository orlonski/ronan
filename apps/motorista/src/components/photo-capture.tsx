import { Camera, Image as ImageIcon, RefreshCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { comprimirFoto, type FotoComprimida } from "@/lib/photo";
import { cn } from "@/lib/utils";

/**
 * Captura foto via câmera traseira (capture="environment") ou galeria.
 * Comprime client-side (max 1920px, JPEG 0.7) e devolve { blob, mime,
 * dataUrl, base64 } pro pai. Preview com botão "Refazer".
 *
 * Fallback do PWA: sem getUserMedia full-screen, usa o picker do sistema.
 * UX inferior ao expo-camera do nativo mas funciona em iOS Safari + Chrome.
 */
export function PhotoCapture({
  value,
  onChange,
  obrigatorio = true,
  label = "Foto do ticket",
  disabled,
  className,
}: {
  value: FotoComprimida | null;
  onChange: (f: FotoComprimida | null) => void;
  obrigatorio?: boolean;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [comprimindo, setComprimindo] = useState(false);

  // Limpa object URL antigo quando troca de foto / desmonta
  useEffect(() => {
    const url = value?.dataUrl;
    return () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [value?.dataUrl]);

  async function aoSelecionar(file: File) {
    setErro(null);
    setComprimindo(true);
    try {
      const compressed = await comprimirFoto(file);
      onChange(compressed);
    } catch (e) {
      setErro((e as Error).message ?? "Não foi possível processar a foto.");
    } finally {
      setComprimindo(false);
    }
  }

  function refazer() {
    onChange(null);
    setErro(null);
  }

  if (value) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="relative overflow-hidden rounded-2xl border-2 border-border bg-muted">
          <img
            src={value.dataUrl}
            alt="Pré-visualização da foto"
            className="block max-h-[60vh] w-full object-contain"
          />
          {!disabled && (
            <button
              type="button"
              onClick={refazer}
              aria-label="Remover foto"
              className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white active:opacity-75"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-border bg-background text-base font-semibold text-foreground active:opacity-75"
          >
            <RefreshCcw size={18} />
            Refazer foto
          </button>
        )}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void aoSelecionar(f);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
        {label} {obrigatorio && <span className="text-destructive">*</span>}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled || comprimindo}
          onClick={() => cameraRef.current?.click()}
          className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card text-foreground transition-opacity active:opacity-75 disabled:opacity-50"
        >
          <Camera size={26} className="text-primary" />
          <span className="text-sm font-bold">Tirar foto</span>
        </button>
        <button
          type="button"
          disabled={disabled || comprimindo}
          onClick={() => galeriaRef.current?.click()}
          className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card text-foreground transition-opacity active:opacity-75 disabled:opacity-50"
        >
          <ImageIcon size={26} className="text-primary" />
          <span className="text-sm font-bold">Galeria</span>
        </button>
      </div>
      {comprimindo && (
        <p className="text-center text-sm text-muted-foreground">Processando foto...</p>
      )}
      {erro && (
        <p className="rounded-xl border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {erro}
        </p>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void aoSelecionar(f);
          e.target.value = "";
        }}
      />
      <input
        ref={galeriaRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void aoSelecionar(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
