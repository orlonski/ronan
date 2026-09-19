"use client";

import { use, useRef, useState } from "react";
import { Camera, Check, FileWarning } from "lucide-react";

type Faltando = { tipo: string; titulo: string; obrigatorio: boolean };

type Pagina = {
  motorista: string;
  expiraEm: string;
  faltando: Faltando[];
  jaRecebidos: number;
  total: number;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * A página que o dono do caminhão ou o motorista abre pelo link.
 *
 * Sem login, sem app, sem cadastro: quem recebe o link tira a foto e pronto.
 * É a porta de entrada da admissão, e hoje esse trabalho é alguém caçando foto
 * no WhatsApp, um documento de cada vez.
 *
 * Duas regras que não podem cair:
 *
 * 1. A página NUNCA mostra o que já foi enviado — só o que falta e quantos
 *    chegaram. Quem abre pode não ser o titular dos documentos, e link que
 *    exibe documento de gente é como documento de gente vaza.
 * 2. Um assunto por vez, texto curto, botão grande. Pode ser um motorista com
 *    pouca familiaridade com celular abrindo isso no pátio.
 */
export default function ColetaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [pagina, setPagina] = useState<Pagina | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    try {
      const r = await fetch(`${API}/p/coleta/${token}`);
      if (!r.ok) throw new Error("Este link não está mais disponível.");
      setPagina((await r.json()) as Pagina);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui abrir o link.");
    } finally {
      setCarregando(false);
    }
  }

  if (carregando && !pagina && !erro) void carregar();

  if (erro) {
    return (
      <Moldura>
        <FileWarning className="h-16 w-16 text-amber-500" />
        <p className="mt-4 text-xl font-semibold">{erro}</p>
        <p className="mt-2 text-muted-foreground">
          Peça um link novo para quem te mandou este.
        </p>
      </Moldura>
    );
  }

  if (!pagina) {
    return (
      <Moldura>
        <p className="text-muted-foreground">Abrindo…</p>
      </Moldura>
    );
  }

  if (pagina.faltando.length === 0) {
    return (
      <Moldura>
        <Check className="h-20 w-20 text-emerald-600" strokeWidth={3} />
        <p className="mt-4 text-2xl font-bold">Tudo certo!</p>
        <p className="mt-2 text-lg text-muted-foreground">
          Recebemos os {pagina.jaRecebidos} documentos.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura alinhar="start">
      <h1 className="text-2xl font-bold">Documentos de {pagina.motorista}</h1>
      <p className="mt-1 text-lg text-muted-foreground">
        Faltam {pagina.faltando.length} de {pagina.total}. Tire uma foto de cada um.
      </p>

      <div className="mt-6 w-full space-y-3">
        {pagina.faltando.map((f) => (
          <ItemDocumento key={f.tipo} token={token} item={f} onEnviado={() => void carregar()} />
        ))}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Pode mandar foto ou PDF. Se a foto sair tremida, é só tirar de novo.
      </p>
    </Moldura>
  );
}

function Moldura({
  children,
  alinhar = "center",
}: {
  children: React.ReactNode;
  alinhar?: "center" | "start";
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-10">
      <div className={`flex w-full flex-col ${alinhar === "center" ? "items-center text-center" : "items-start"}`}>
        {children}
      </div>
    </main>
  );
}

/**
 * Um documento a mandar. O botão É o item — nada de escolher arquivo num
 * seletor separado e depois confirmar.
 */
function ItemDocumento({
  token,
  item,
  onEnviado,
}: {
  token: string;
  item: Faltando;
  onEnviado: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<"parado" | "enviando" | "erro">("parado");
  const [msg, setMsg] = useState<string | null>(null);

  async function enviar(file: File) {
    setEstado("enviando");
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("tipo", item.tipo);
      const r = await fetch(`${API}/p/coleta/${token}`, { method: "POST", body: fd });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(corpo?.message ?? "Não consegui enviar. Tente de novo.");
      }
      onEnviado();
    } catch (e) {
      setEstado("erro");
      setMsg(e instanceof Error ? e.message : "Não consegui enviar.");
    }
  }

  return (
    <div className="w-full rounded-2xl border-2 p-4">
      <p className="text-lg font-semibold">{item.titulo}</p>
      {!item.obrigatorio && <p className="text-sm text-muted-foreground">Opcional</p>}

      <button
        type="button"
        disabled={estado === "enviando"}
        onClick={() => input.current?.click()}
        className="mt-3 flex h-20 w-full items-center justify-center gap-3 rounded-xl bg-[#DF7234] text-xl font-bold text-white disabled:opacity-60"
      >
        <Camera className="h-8 w-8" />
        {estado === "enviando" ? "Enviando…" : "Tirar foto"}
      </button>

      {msg && <p className="mt-2 text-sm text-destructive">{msg}</p>}

      {/* `capture` abre a câmera direto no celular, que é onde isto vai ser
          usado; no computador vira o seletor de arquivo normal. */}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviar(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
