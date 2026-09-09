import { useRef, useState } from "react";
import { ArrowRight, Check, MessageCircle } from "lucide-react";
import { ErroApi, postPublico } from "../lib/api";
import { registrar, utmAtual } from "../lib/analytics";
import { PRIVACIDADE_URL, WHATSAPP_URL } from "../lib/config";

/**
 * Pedido de demonstração.
 *
 * Três decisões que valem explicar:
 *
 *  1. O WhatsApp continua ali do lado, com o mesmo destaque. Quem prefere
 *     conversar não é obrigado a preencher formulário — o formulário existe pra
 *     não perder quem chega fora do horário, não pra substituir a conversa.
 *  2. Depois de enviar, a tela oferece abrir o WhatsApp já com o recado pronto.
 *     Lead esfria em minutos; o registro no banco serve pro histórico, o
 *     WhatsApp serve pra falar agora.
 *  3. Erro aparece no campo, em vermelho, com a página rolando até ele — nunca
 *     em pop-up. Mesmo padrão dos apps do motorista.
 */

type Campos = {
  nome: string;
  empresa: string;
  telefone: string;
  email: string;
  cidade: string;
  frota: string;
  mensagem: string;
};

const VAZIO: Campos = {
  nome: "",
  empresa: "",
  telefone: "",
  email: "",
  cidade: "",
  frota: "",
  mensagem: "",
};

/** (00) 00000-0000 enquanto digita. */
function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function Campo({
  id,
  rotulo,
  erro,
  opcional = false,
  children,
}: {
  id: string;
  rotulo: string;
  erro?: string;
  opcional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-baseline gap-2 text-[0.9rem] font-semibold text-tinta"
      >
        {rotulo}
        {opcional ? (
          <span className="text-[0.78rem] font-normal text-tinta-fraca">opcional</span>
        ) : null}
      </label>
      {children}
      {erro ? (
        <p id={`${id}-erro`} role="alert" className="mt-1.5 text-[0.85rem] font-medium text-[#B3261E]">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

export function FormularioContato() {
  const [campos, setCampos] = useState<Campos>(VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [jaAbriu, setJaAbriu] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  function mudar(nome: keyof Campos, valor: string) {
    setCampos((c) => ({ ...c, [nome]: valor }));
    // O erro some assim que a pessoa mexe no campo — deixar vermelho enquanto
    // ela corrige é castigo, não ajuda.
    setErros((e) => (e[nome] ? { ...e, [nome]: "" } : e));

    if (!jaAbriu) {
      setJaAbriu(true);
      registrar("CTA_FORMULARIO_ABRIU");
    }
  }

  /** Rola até o primeiro campo com erro e põe o foco nele. */
  function irAoErro(campos: Record<string, string>) {
    const primeiro = Object.keys(campos).find((k) => campos[k]);
    if (!primeiro || !formRef.current) return;
    const el = formRef.current.querySelector<HTMLElement>(`[name="${primeiro}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;

    const locais: Record<string, string> = {};
    if (campos.nome.trim().length < 2) locais.nome = "Diga seu nome";
    if (campos.empresa.trim().length < 2) locais.empresa = "Diga o nome da empresa";
    const digitos = campos.telefone.replace(/\D/g, "");
    if (digitos.length !== 10 && digitos.length !== 11) {
      locais.telefone = "Telefone incompleto";
    }
    if (campos.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campos.email.trim())) {
      locais.email = "E-mail inválido";
    }

    if (Object.keys(locais).length > 0) {
      setErros(locais);
      irAoErro(locais);
      return;
    }

    setEnviando(true);
    setErroGeral(null);

    try {
      await postPublico("lead", {
        nome: campos.nome.trim(),
        empresa: campos.empresa.trim(),
        telefone: digitos,
        email: campos.email.trim() || undefined,
        cidade: campos.cidade.trim() || undefined,
        frota: campos.frota.trim() || undefined,
        mensagem: campos.mensagem.trim() || undefined,
        origem: "SITE_FORMULARIO",
        paginaOrigem: location.pathname,
        website: honeypot.current?.value ?? "",
        ...utmAtual(),
      });

      registrar("CTA_FORMULARIO_ENVIOU");
      setEnviado(true);
    } catch (erro) {
      if (erro instanceof ErroApi) {
        if (Object.keys(erro.campos).length > 0) {
          setErros(erro.campos);
          irAoErro(erro.campos);
        }
        setErroGeral(erro.message);
      } else {
        setErroGeral("Deu erro inesperado. Tente pelo WhatsApp.");
      }
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    const recado = encodeURIComponent(
      `Oi! Sou ${campos.nome}, da ${campos.empresa}. Acabei de pedir uma demonstração pelo site do Movatruck.`,
    );
    const zapDireto = `${WHATSAPP_URL.split("?")[0]}?text=${recado}`;

    return (
      <div className="rounded-xl2 border border-borda bg-superficie p-8 text-center shadow-placa">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-verde-lavado">
          <Check size={26} className="text-verde" aria-hidden />
        </div>
        <h3 className="mt-5 text-[1.5rem] leading-tight">Recebido, {campos.nome.split(" ")[0]}</h3>
        <p className="mx-auto mt-3 max-w-md text-tinta-media">
          A gente responde no mesmo dia útil. Se preferir adiantar, é só chamar no
          WhatsApp — seu recado já vai escrito.
        </p>
        <a
          href={zapDireto}
          target="_blank"
          rel="noreferrer"
          onClick={() => registrar("CTA_WHATSAPP", "pos-envio")}
          className="btn-primario mt-6"
        >
          <MessageCircle size={18} aria-hidden />
          Falar agora no WhatsApp
        </a>
      </div>
    );
  }

  const entrada =
    "w-full rounded-lg border border-borda-forte bg-superficie px-4 py-3 text-[1rem] text-tinta placeholder:text-tinta-fraca focus:border-azul";
  const entradaErro = "border-[#B3261E]";

  return (
    <form
      ref={formRef}
      onSubmit={enviar}
      noValidate
      className="rounded-xl2 border border-borda bg-superficie p-6 shadow-placa sm:p-8"
    >
      <h3 className="text-[1.4rem] leading-tight">Agendar demonstração</h3>
      <p className="mt-2 text-[0.98rem] text-tinta-media">
        Trinta minutos, com o painel real na tela. Sem slide e sem compromisso.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Campo id="f-nome" rotulo="Seu nome" erro={erros.nome}>
          <input
            id="f-nome"
            name="nome"
            value={campos.nome}
            onChange={(e) => mudar("nome", e.target.value)}
            autoComplete="name"
            aria-invalid={!!erros.nome}
            aria-describedby={erros.nome ? "f-nome-erro" : undefined}
            className={`${entrada} ${erros.nome ? entradaErro : ""}`}
          />
        </Campo>

        <Campo id="f-empresa" rotulo="Transportadora" erro={erros.empresa}>
          <input
            id="f-empresa"
            name="empresa"
            value={campos.empresa}
            onChange={(e) => mudar("empresa", e.target.value)}
            autoComplete="organization"
            aria-invalid={!!erros.empresa}
            aria-describedby={erros.empresa ? "f-empresa-erro" : undefined}
            className={`${entrada} ${erros.empresa ? entradaErro : ""}`}
          />
        </Campo>

        <Campo id="f-telefone" rotulo="WhatsApp" erro={erros.telefone}>
          <input
            id="f-telefone"
            name="telefone"
            value={campos.telefone}
            onChange={(e) => mudar("telefone", mascararTelefone(e.target.value))}
            inputMode="tel"
            autoComplete="tel"
            placeholder="(42) 99999-0000"
            aria-invalid={!!erros.telefone}
            aria-describedby={erros.telefone ? "f-telefone-erro" : undefined}
            className={`${entrada} ${erros.telefone ? entradaErro : ""}`}
          />
        </Campo>

        <Campo id="f-email" rotulo="E-mail" erro={erros.email} opcional>
          <input
            id="f-email"
            name="email"
            type="email"
            value={campos.email}
            onChange={(e) => mudar("email", e.target.value)}
            autoComplete="email"
            aria-invalid={!!erros.email}
            aria-describedby={erros.email ? "f-email-erro" : undefined}
            className={`${entrada} ${erros.email ? entradaErro : ""}`}
          />
        </Campo>

        <Campo id="f-cidade" rotulo="Cidade" opcional>
          <input
            id="f-cidade"
            name="cidade"
            value={campos.cidade}
            onChange={(e) => mudar("cidade", e.target.value)}
            autoComplete="address-level2"
            className={entrada}
          />
        </Campo>

        <Campo id="f-frota" rotulo="Caminhões" opcional>
          <input
            id="f-frota"
            name="frota"
            value={campos.frota}
            onChange={(e) => mudar("frota", e.target.value)}
            placeholder="uns 12"
            className={entrada}
          />
        </Campo>
      </div>

      <div className="mt-4">
        <Campo id="f-mensagem" rotulo="O que mais te trava hoje" opcional>
          <textarea
            id="f-mensagem"
            name="mensagem"
            value={campos.mensagem}
            onChange={(e) => mudar("mensagem", e.target.value)}
            rows={3}
            className={`${entrada} resize-y`}
          />
        </Campo>
      </div>

      {/* Isca de robô: fora da tela e fora da ordem de tabulação. Humano nenhum preenche. */}
      <input
        ref={honeypot}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {erroGeral ? (
        <p role="alert" className="mt-5 rounded-lg bg-[#FDECEA] px-4 py-3 text-[0.92rem] font-medium text-[#B3261E]">
          {erroGeral}
        </p>
      ) : null}

      <button type="submit" disabled={enviando} className="btn-primario mt-6 w-full disabled:opacity-60">
        {enviando ? "Enviando…" : "Pedir demonstração"}
        {enviando ? null : <ArrowRight size={18} aria-hidden />}
      </button>

      <p className="mt-4 text-[0.82rem] leading-relaxed text-tinta-fraca">
        Usamos seus dados só pra entrar em contato sobre o Movatruck. Não repassamos
        pra ninguém, e é só pedir que a gente apaga.{" "}
        <a href={PRIVACIDADE_URL} target="_blank" rel="noreferrer" className="text-acao underline">
          Política de privacidade
        </a>
        .
      </p>
    </form>
  );
}
