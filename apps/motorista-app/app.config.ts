import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  // Nome de exibicao (aparece no celular). Mantemos slug/scheme/package
  // antigos pra nao quebrar OTA / atualizacao dos APKs ja instalados.
  name: "Schaba",
  slug: "ronan-motorista",
  scheme: "ronan",
  version: "1.0.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    // Fundo branco fica melhor pq o S \xc3\xa9 azul escuro - precisa contraste
    backgroundColor: "#ffffff",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: false,
    bundleIdentifier: "br.com.ronan.motorista",
    buildNumber: "1",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "Para tirar foto do ticket de carga e descarga da viagem.",
      NSPhotoLibraryUsageDescription:
        "Para anexar foto do ticket à viagem (opcional).",
      // Tracking GPS em background durante a viagem
      UIBackgroundModes: ["location", "fetch"],
    },
  },
  android: {
    package: "br.com.ronan.motorista",
    versionCode: 2,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#13316b",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.INTERNET",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.POST_NOTIFICATIONS",
    ],
    // Google Maps SDK Android: chave gratuita (Maps SDK for Android).
    // Configurar via EAS Secret: GOOGLE_MAPS_ANDROID_KEY.
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY ?? "",
      },
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "@react-native-community/datetimepicker",
    [
      "expo-camera",
      {
        cameraPermission:
          "Para tirar foto do ticket de carga e descarga da viagem.",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "Para registrar o trajeto da viagem em segundo plano (KM real percorrido).",
        locationWhenInUsePermission:
          "Para registrar onde a viagem foi lançada.",
        isAndroidBackgroundLocationEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
        color: "#ea580c",
      },
    ],
    "./plugins/with-abi-splits",
    "./plugins/with-gradle-memory",
  ],
  experiments: {
    typedRoutes: false,
  },
  // OTA updates via EAS Update — quando push novo bundle JS, motorista
  // baixa silenciosamente na proxima vez que abrir o app.
  runtimeVersion: { policy: "appVersion" },
  updates: {
    fallbackToCacheTimeout: 0,
    url: "https://u.expo.dev/33e8e936-fbac-4bb3-9f98-5de6dc84da53",
    // Canonical way: requestHeaders sai como meta-data
    // expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY
    // (que e o nome que UpdatesConfiguration.kt:253 le).
    requestHeaders: {
      "expo-channel-name": "production",
    },
  },
  extra: {
    apiUrl:
      process.env.EXPO_PUBLIC_API_URL ?? "https://ronan-api.2azr6q.easypanel.host",
    eas: {
      projectId: "33e8e936-fbac-4bb3-9f98-5de6dc84da53",
    },
  },
};

export default config;
