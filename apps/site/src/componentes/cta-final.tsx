import { MessageCircle } from "lucide-react";
import { CADASTRO_URL, WHATSAPP_URL } from "../lib/config";
import { useCadastroAberto } from "../lib/cadastro-aberto";
import { registrar } from "../lib/analytics";
import { FormularioContato } from "./formulario-contato";

export function CtaFinal() {
  const { aberto: cadastroAberto } = useCadastroAberto();

  return (
    <section id="contato" className="secao border-t border-borda bg-superficie">
      <div className="caixa">
        <div className="revelar relative overflow-hidden rounded-[1.25rem] bg-azul px-6 py-14 sm:px-10 lg:px-14 lg:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "repeating-linear-gradient(105deg, #FFFFFF 0 1px, transparent 1px 13px)",
            }}
          />

          <div className="relative grid gap-10 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-center lg:gap-14">
            <div className="text-center lg:text-left">
              <h2 className="text-[1.85rem] leading-[1.15] text-white sm:text-[2.4rem]">
                Veja o seu próximo fechamento antes dele acontecer
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[1.05rem] leading-relaxed text-[#C4CFE7] lg:mx-0">
                Trinta minutos com o painel real na tela: suas viagens, seus materiais,
                seu jeito de faturar. Sem slide, sem compromisso.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                {cadastroAberto && (
                  <a
                    href={CADASTRO_URL}
                    onClick={() => registrar("CTA_CADASTRO", "cta-final")}
                    className="btn w-full bg-white text-[#0B1B3B] hover:bg-white/90 sm:w-auto"
                  >
                    Criar conta grátis
                  </a>
                )}
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => registrar("CTA_WHATSAPP", "cta-final")}
                  className="btn w-full border border-white/35 text-white hover:bg-white/10 sm:w-auto"
                >
                  <MessageCircle size={18} aria-hidden />
                  Prefiro falar no WhatsApp
                </a>
              </div>

              <p className="mt-6 text-[0.9rem] text-[#A6B3D2]">
                A gente responde no mesmo dia útil.
              </p>
            </div>

            <FormularioContato />
          </div>
        </div>
      </div>
    </section>
  );
}
