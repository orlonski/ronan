-- Carga e descarga deixam de ser eventos guiados do meio da viagem: viraram
-- bookends fixos do app (carga = tela Iniciar; descarga = tela Finalizar).
-- Desativando-os, o catálogo guiado (GET /m/viagem/tipos-evento filtra
-- ativo=true) fica só com os EXTRAS opcionais (parada, balança...), e o botão
-- primário da tela guiada já vira "Finalizar viagem". Elimina a redundância de
-- pedir toneladas/ticket/local em vários passos. Flip de boolean, reversível.
UPDATE "tipos_evento_viagem" SET "ativo" = false WHERE "slug" IN ('carga', 'descarga');
