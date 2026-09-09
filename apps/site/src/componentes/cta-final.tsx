import { ArrowRight, MessageCircle } from "lucide-react";
import { WHATSAPP_URL } from "../lib/config";

export function CtaFinal() {
  return (
    <section className="secao border-t border-borda bg-superficie">
      <div className="caixa">
        <div className="revelar relative overflow-hidden rounded-[1.25rem] bg-azul px-7 py-14 text-center sm:px-12 lg:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "repeating-linear-gradient(105deg, #FFFFFF 0 1px, transparent 1px 13px)",
            }}
          />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-[1.85rem] leading-[1.15] text-white sm:text-[2.4rem]">
              Veja o seu próximo fechamento antes dele acontecer
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[1.05rem] leading-relaxed text-[#C4CFE7]">
              Trinta minutos com o painel real na tela: suas viagens, seus materiais,
              seu jeito de faturar. Sem slide, sem compromisso.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-primario w-full sm:w-auto"
              >
                Agendar demonstração
                <ArrowRight size={18} aria-hidden />
              </a>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="btn w-full border border-white/35 text-white hover:bg-white/10 sm:w-auto"
              >
                <MessageCircle size={18} aria-hidden />
                Falar no WhatsApp agora
              </a>
            </div>
            <p className="mt-6 text-[0.9rem] text-[#A6B3D2]">
              A gente responde no mesmo dia útil.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
