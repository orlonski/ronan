import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  // Nome de exibicao (aparece no celular). Slug/scheme antigos mantidos
  // pra preservar projectId no EAS (nao quebrar canal de OTA Update).
  name: "Movatruck",
  slug: "ronan-motorista",
  scheme: "ronan",
  // 1.1.0 é o build de loja que leva a marca Movatruck pro aparelho: nome,
  // ícone e splash são compilados no binário, e a frota rodava um build de
  // 14/07 — anterior ao rebranding (assets trocados em 15109fb, 13/08). Ficha
  // da loja e OTA não alcançam nada disso.
  //
  // O app reporta ESTA string pro backend (sai do manifesto do update, não do
  // binário), e o piso da força-atualização compara com o que o aparelho DIZ.
  // Por isso ela só sobe junto com o build que vai pras lojas — nunca antes,
  // senão a frota inteira se declara 1.1.0 rodando 1.0.5 nativa.
  version: "1.1.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    // Fundo branco: a marca Movatruck e azul marinho + laranja, precisa contraste
    backgroundColor: "#ffffff",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: false,
    bundleIdentifier: "br.com.schaba.motorista",
    buildNumber: "14",
    // Google Maps SDK for iOS — usa o MESMO motor do Android (que desenha a
    // polilinha perfeitamente), no lugar do Apple Maps (que é furado com linha).
    // Chave via EAS Secret GOOGLE_MAPS_IOS_KEY (precisa "Maps SDK for iOS"
    // habilitado no Google Cloud). Fallback pra chave do Android se compartilhada.
    config: {
      googleMapsApiKey:
        process.env.GOOGLE_MAPS_IOS_KEY ??
        process.env.GOOGLE_MAPS_ANDROID_KEY ??
        "",
    },
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
    package: "br.com.schaba.motorista",
    versionCode: 16,
    // FCM v1 (push notifications): exige google-services.json do projeto Firebase
    // vinculado a este package. EAS Secret GOOGLE_SERVICES_JSON aponta pro arquivo
    // subido via `eas secret:create`; em dev local cai pro arquivo na raiz do app.
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    // O foreground traz so as barras da marca; o navy da marca e o fundo, pra
    // mascara redonda do Android nao cortar nada.
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#1E3575",
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
        // Arquivo proprio, e nao o icone do app: o Android desenha a
        // notificacao como silhueta do canal alfa, e o icone do app e opaco -
        // usa-lo aqui vira um quadrado branco solido na barra de status.
        icon: "./assets/notification-icon.png",
        color: "#ea580c",
        // Som customizado embarcado (E6→B5 chime, ~0.6s). Nome referenciado
        // pelo backend como `sound: "ding"` (sem extensão).
        sounds: ["./assets/sounds/ding.wav"],
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
  //
  // O runtime é o FINGERPRINT da camada nativa, não a versão de marketing.
  //
  // Com a política antiga (`appVersion`), cada número de versão virava uma ilha:
  // o build que ia pra loja nascia com o JS congelado no dia do build e só
  // aceitava OTA da ilha dele. Como os OTAs seguiam saindo na ilha da versão
  // antiga (onde a frota estava), quem baixava da loja ANDAVA PRA TRÁS — pegava
  // um app sem semanas de correções, e em silêncio.
  //
  // Com fingerprint, subir 1.1.0 → 1.1.1 sem mexer em módulo nativo não cria
  // ilha nenhuma: loja e frota compartilham o runtime e um OTA só alcança todo
  // mundo. Quando o nativo muda de verdade (módulo novo, plugin, SDK), o hash
  // muda sozinho — que é exatamente quando o runtime DEVE mudar, sem depender
  // de alguém lembrar de bumpar.
  //
  // Cuidado do monorepo pnpm: o fingerprint inclui os caminhos de node_modules,
  // então mexer no lockfile pode mudar o hash sem mudança nativa real. Isso
  // falha pro lado seguro (o OTA não alcança ninguém, em vez de rodar JS novo
  // sobre nativo velho), mas exige o hábito: depois de publicar, conferir com
  // `eas update:list` que o runtime bate com o do build que está nas lojas.
  // Pra ver o hash atual: `pnpm exec expo-updates fingerprint:generate --platform ios`.
  //
  // FINGERPRINT NÃO DÁ PRA USAR NESTE REPO — tentado de novo em 18/08/2026 e o
  // build falha na fase "Configure expo-updates" com "Runtime version calculated
  // on local machine not equal to runtime version calculated during build":
  // local `b9477bf5…` × builder `ba43680e…`. O fingerprint inclui os caminhos de
  // node_modules, e num monorepo pnpm os diretórios `.pnpm/<pacote>@<versão>_<hash>`
  // não saem iguais aqui e no builder do EAS. Não é o `android/`/`ios/` local:
  // removê-los não mudou o hash. Enquanto isso não for resolvido, a política é
  // string explícita — determinística e que builda.
  //
  // Custo de usar string: cada versão vira uma ilha de OTA. Subir 1.1.0 → 1.1.1
  // sem mexer em nativo exige lembrar que o update sai na ilha nova e quem não
  // atualizou pela loja não recebe. Era o que o commit 9da33a5 queria evitar.
  //
  // JANELA DE TRANSIÇÃO: quem está em 1.0.5 não recebe OTA publicado daqui.
  // Correção urgente pra frota velha sai com o runtime antigo explícito:
  //   EXPO_PUBLIC_API_URL=https://api.schaba.com.br npx eas update \
  //     --branch production --runtime-version 1.0.5 --message "..."
  // A janela fecha quando o painel parar de mostrar aparelhos em 1.0.5.
  runtimeVersion: "1.1.0",
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
      process.env.EXPO_PUBLIC_API_URL ?? "https://api.schaba.com.br",
    eas: {
      projectId: "33e8e936-fbac-4bb3-9f98-5de6dc84da53",
    },
  },
};

export default config;
