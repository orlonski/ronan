import { forwardRef, useState } from "react";
import { Pressable, type TextInput, type TextInputProps, View } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import { Input } from "./input";
import { cn } from "@/lib/utils";

/**
 * Campo de senha com botão de mostrar/ocultar (olho). Pro motorista conferir
 * o que digitou — ajuda com autofill de senha que enche o campo sem ele ver.
 * Repassa os props pro Input; força secureTextEntry conforme o toggle.
 */
export const PasswordInput = forwardRef<
  TextInput,
  Omit<TextInputProps, "secureTextEntry"> & { className?: string }
>(({ className, ...props }, ref) => {
  const [mostrar, setMostrar] = useState(false);
  return (
    <View className="relative justify-center">
      <Input
        ref={ref}
        secureTextEntry={!mostrar}
        className={cn("pr-14", className)}
        {...props}
      />
      <Pressable
        onPress={() => setMostrar((v) => !v)}
        hitSlop={8}
        className="absolute right-0 h-14 w-14 items-center justify-center"
      >
        {mostrar ? <EyeOff size={20} color="#64748b" /> : <Eye size={20} color="#64748b" />}
      </Pressable>
    </View>
  );
});
PasswordInput.displayName = "PasswordInput";
