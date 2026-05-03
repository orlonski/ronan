import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

export function EmptyState({
  icon: Icon,
  title,
  description,
  iconColor = "#94a3b8",
  bgColor = "bg-muted",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  iconColor?: string;
  bgColor?: string;
}) {
  return (
    <View className="items-center px-6 py-12">
      <View
        className={`mb-4 h-24 w-24 items-center justify-center rounded-full ${bgColor}`}
      >
        <Icon size={48} color={iconColor} strokeWidth={1.5} />
      </View>
      <Text className="text-center text-lg font-bold text-foreground">
        {title}
      </Text>
      {description && (
        <Text className="mt-1 text-center text-base text-muted-foreground">
          {description}
        </Text>
      )}
    </View>
  );
}
