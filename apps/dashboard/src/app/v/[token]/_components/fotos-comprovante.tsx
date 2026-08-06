"use client";

import { useState } from "react";
import { ImageOff, X } from "lucide-react";

export type FotoPublica = { id: string; rotacao: number };

/**
 * Fotos do ticket no comprovante público.
 *
 * Bem mais simples que o `FotoThumb` do painel: lá a imagem exige header de
 * auth, o que obriga a buscar por fetch e virar blob URL. Aqui o próprio token
 * do link autoriza, então é um `<img src>` direto — sem JS pra carregar, sem
 * CORS, e funciona no 4G ruim do celular do cliente.
 */
export function FotosComprovante({ fotos, urlComprovante }: { fotos: FotoPublica[]; urlComprovante: string }) {
  const [aberta, setAberta] = useState<FotoPublica | null>(null);

  if (fotos.length === 0) return null;

  return (
    <>
      {/* Largura cheia no celular: o ticket de balança é o que o cliente quer
          conferir de perto, e em duas colunas o número não se lê. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fotos.map((f) => (
          <FotoCard key={f.id} foto={f} urlComprovante={urlComprovante} onAbrir={() => setAberta(f)} />
        ))}
      </div>

      {aberta && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 print:hidden"
          onClick={() => setAberta(null)}
          role="dialog"
          aria-label="Foto ampliada"
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"
            aria-label="Fechar"
          >
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${urlComprovante}/fotos/${aberta.id}`}
            alt="Ticket de balança"
            className="max-h-full max-w-full object-contain"
            style={{ transform: `rotate(${aberta.rotacao}deg)` }}
          />
        </div>
      )}
    </>
  );
}

function FotoCard({
  foto,
  urlComprovante,
  onAbrir,
}: {
  foto: FotoPublica;
  urlComprovante: string;
  onAbrir: () => void;
}) {
  const [erro, setErro] = useState(false);

  if (erro) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md border bg-slate-50 text-slate-400">
        <ImageOff className="h-6 w-6" />
        <span className="text-xs">Foto indisponível</span>
      </div>
    );
  }

  // Rotação de 90/270 troca largura por altura da imagem: aí o box precisa ser
  // quadrado, senão o ticket sai cortado nas pontas. Em 0/180 dá pra deixar a
  // altura livre e a foto ocupar a largura inteira, que é o que se quer ler.
  const deitada = foto.rotacao === 90 || foto.rotacao === 270;

  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`w-full overflow-hidden rounded-md border bg-slate-50 print:break-inside-avoid ${
        deitada ? "aspect-square" : ""
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${urlComprovante}/fotos/${foto.id}`}
        alt="Ticket de balança"
        className={deitada ? "h-full w-full object-contain" : "h-auto w-full object-contain"}
        style={{ transform: `rotate(${foto.rotacao}deg)` }}
        onError={() => setErro(true)}
      />
    </button>
  );
}
