import { z } from "zod";

/** Formato exato do token devolvido pelo getExpoPushTokenAsync do app. */
const ExpoPushTokenSchema = z
  .string()
  .trim()
  .regex(/^ExponentPushToken\[[^\]]+\]$/, "Token Expo inválido");

export const RegistrarPushTokenInput = z.object({
  token: ExpoPushTokenSchema,
});
export type RegistrarPushTokenInput = z.infer<typeof RegistrarPushTokenInput>;

export const EnviarPushInput = z.object({
  titulo: z.string().trim().min(1, "Título obrigatório").max(60, "Máx 60 caracteres"),
  corpo: z.string().trim().min(1, "Mensagem obrigatória").max(250, "Máx 250 caracteres"),
  /** Payload opcional. `kind` é consumido pelo listener de tap pra deep-link. */
  dados: z.record(z.unknown()).optional(),
});
export type EnviarPushInput = z.infer<typeof EnviarPushInput>;

export type EnviarPushResultado = {
  enviado: boolean;
  motivo?: string;
};
