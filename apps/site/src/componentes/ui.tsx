import type { ReactNode } from "react";

export function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <span className="etiqueta barras">
      <span>{children}</span>
    </span>
  );
}

export function TituloSecao({
  etiqueta,
  titulo,
  apoio,
  claro = false,
}: {
  etiqueta: string;
  titulo: ReactNode;
  apoio?: ReactNode;
  claro?: boolean;
}) {
  return (
    <div className="revelar max-w-3xl">
      <span
        className={`etiqueta barras ${claro ? "text-[#A6B3D2]" : "text-azul"}`}
      >
        <span>{etiqueta}</span>
      </span>
      <h2
        className={`mt-4 text-[1.9rem] leading-[1.12] sm:text-[2.3rem] lg:text-[2.75rem] ${
          claro ? "text-white" : ""
        }`}
      >
        {titulo}
      </h2>
      {apoio ? (
        <p
          className={`mt-4 text-[1.06rem] leading-relaxed sm:text-[1.15rem] ${
            claro ? "text-[#B9C4DC]" : "text-tinta-media"
          }`}
        >
          {apoio}
        </p>
      ) : null}
    </div>
  );
}

/** Screenshot do painel dentro de uma moldura de janela. */
export function Tela({
  src,
  alt,
  className = "",
  prioridade = false,
}: {
  src: string;
  alt: string;
  className?: string;
  prioridade?: boolean;
}) {
  return (
    <figure
      className={`overflow-hidden rounded-xl2 border border-borda-forte bg-superficie shadow-placa ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-borda bg-superficie-2 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#D6DCE7]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#D6DCE7]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#D6DCE7]" />
        <span className="ml-2 truncate text-[0.68rem] font-medium tracking-wide text-tinta-fraca">
          app.movatruck.com.br
        </span>
      </div>
      {/* No celular a tela do painel encolhida fica ilegível: em vez de
          espremer, deixa arrastar na horizontal dentro da moldura. */}
      <div className="overflow-x-auto overscroll-x-contain">
        <img
          src={src}
          alt={alt}
          width={1600}
          height={1003}
          loading={prioridade ? "eager" : "lazy"}
          decoding={prioridade ? "sync" : "async"}
          fetchPriority={prioridade ? "high" : "auto"}
          className="block w-[860px] max-w-none sm:w-full"
        />
      </div>
      <figcaption className="border-t border-borda bg-superficie-2 px-3.5 py-2 text-center text-[0.72rem] text-tinta-fraca sm:hidden">
        Arraste pra ver a tela inteira
      </figcaption>
    </figure>
  );
}

/** Screenshot do app dentro de uma moldura de celular. */
export function Celular({
  src,
  alt,
  className = "",
  prioridade = false,
}: {
  src: string;
  alt: string;
  className?: string;
  prioridade?: boolean;
}) {
  return (
    <figure
      className={`relative overflow-hidden rounded-[2rem] border-[6px] border-[#141B2B] bg-[#141B2B] shadow-alta ${className}`}
    >
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-2 z-10 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/25"
      />
      <img
        src={src}
        alt={alt}
        width={760}
        height={1645}
        loading={prioridade ? "eager" : "lazy"}
        decoding={prioridade ? "sync" : "async"}
        className="block w-full rounded-[1.6rem]"
      />
    </figure>
  );
}

export function Bloco({
  icone,
  titulo,
  children,
  atraso = 0,
}: {
  icone: ReactNode;
  titulo: string;
  children: ReactNode;
  atraso?: number;
}) {
  return (
    <div
      className="revelar placa h-full p-6 transition-[border-color,transform] duration-300 ease-patio hover:-translate-y-0.5 hover:border-borda-forte"
      style={{ "--atraso": `${atraso}ms` } as React.CSSProperties}
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-azul-lavado text-azul">
        {icone}
      </span>
      <h3 className="mt-4 text-[1.12rem] font-semibold">{titulo}</h3>
      <p className="mt-2 text-[0.98rem] leading-relaxed text-tinta-media">
        {children}
      </p>
    </div>
  );
}
