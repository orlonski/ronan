"use client";

import * as React from "react";
import { maskTelefone, telefoneDigits, type SessaoPortalObra } from "@ronan/shared-types";
import { chamar } from "./api";
import { Aviso, Botao, Campo, Cartao, CLASSE_CAMPO } from "./ui";

const REENVIO_S = 60;

/**
 * Entrar no portal: celular → código no WhatsApp → pronto. Sem senha: o
 * encarregado abre isto uma vez por mês no celular dele, e senha esquecida
 * seria a primeira ligação pro escritório.
 */
export function Entrar({ onEntrou }: { onEntrou: (sessoes: SessaoPortalObra[]) => void }) {
  const [etapa, setEtapa] = React.useState<"telefone" | "codigo">("telefone");
  const [telefone, setTelefone] = React.useState("");
  const [codigo, setCodigo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [espera, setEspera] = React.useState(0);
  const campoCodigo = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function pedirCodigo(e?: React.FormEvent) {
    e?.preventDefault();
    setErro(null);
    if (telefoneDigits(telefone).length < 10) {
      setErro("Informe o celular com DDD.");
      return;
    }
    setOcupado(true);
    try {
      const r = await chamar<{ mensagem: string }>("/auth/solicitar", {
        method: "POST",
        body: { telefone },
      });
      setInfo(r.mensagem);
      setEtapa("codigo");
      setEspera(REENVIO_S);
      setTimeout(() => campoCodigo.current?.focus(), 50);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!/^\d{6}$/.test(codigo)) {
      setErro("O código tem 6 números.");
      return;
    }
    setOcupado(true);
    try {
      const r = await chamar<{ sessoes: SessaoPortalObra[] }>("/auth/confirmar", {
        method: "POST",
        body: { telefone, codigo },
      });
      onEntrou(r.sessoes);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/movatruck-logo.svg" alt="Movatruck" className="mx-auto mb-4 h-8 w-auto" />
        <h1 className="text-2xl font-bold text-slate-900">Acompanhamento da obra</h1>
        <p className="mt-1 text-slate-600">
          Veja as entregas do dia, a programação e peça caminhão pelo celular.
        </p>
      </div>

      <Cartao>
        {etapa === "telefone" ? (
          <form onSubmit={pedirCodigo} className="space-y-4">
            <Campo
              rotulo="Seu celular"
              id="obra-telefone"
              dica="O mesmo número que a transportadora cadastrou. O código chega no WhatsApp."
            >
              <input
                id="obra-telefone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(43) 99999-1234"
                className={CLASSE_CAMPO}
                value={telefone}
                onChange={(e) => setTelefone(maskTelefone(e.target.value))}
              />
            </Campo>
            {erro && <Aviso>{erro}</Aviso>}
            <Botao type="submit" tom="verde" className="w-full" carregando={ocupado}>
              Receber código no WhatsApp
            </Botao>
          </form>
        ) : (
          <form onSubmit={confirmar} className="space-y-4">
            {info && <Aviso tom="info">{info}</Aviso>}
            <Campo rotulo="Código de 6 números" id="obra-codigo">
              <input
                id="obra-codigo"
                ref={campoCodigo}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className={`${CLASSE_CAMPO} text-center text-2xl tracking-[0.5em]`}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </Campo>
            {erro && <Aviso>{erro}</Aviso>}
            <Botao type="submit" tom="verde" className="w-full" carregando={ocupado}>
              Entrar
            </Botao>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Botao
                type="button"
                tom="contorno"
                className="flex-1"
                onClick={() => {
                  setEtapa("telefone");
                  setCodigo("");
                  setErro(null);
                }}
              >
                Trocar número
              </Botao>
              <Botao
                type="button"
                tom="contorno"
                className="flex-1"
                disabled={espera > 0 || ocupado}
                onClick={() => void pedirCodigo()}
              >
                {espera > 0 ? `Mandar de novo (${espera}s)` : "Mandar de novo"}
              </Botao>
            </div>
          </form>
        )}
      </Cartao>

      <p className="mt-6 text-center text-xs text-slate-500">
        Não recebeu? Confira se é o número que a transportadora cadastrou pra você.
      </p>
    </div>
  );
}
