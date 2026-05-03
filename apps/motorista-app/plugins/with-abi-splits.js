/**
 * Expo config plugin: injeta `splits.abi` no android/app/build.gradle
 * pra gerar APKs separados por arquitetura (~30 MB cada) em vez de
 * um universal de ~100 MB. Roda toda vez que `expo prebuild` executa.
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

const SPLITS_BLOCK = `    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk false
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (contents.includes("splits {")) {
      // Já injetado em build anterior — nada a fazer.
      return cfg;
    }

    // Injeta logo após o bloco defaultConfig {} fechar (depois de buildConfigField/versionName).
    const marker = /defaultConfig\s*\{[\s\S]*?\n {4}\}\n/;
    if (!marker.test(contents)) {
      throw new Error(
        "with-abi-splits: defaultConfig {} block not found in app/build.gradle",
      );
    }
    contents = contents.replace(marker, (match) => `${match}\n${SPLITS_BLOCK}`);
    cfg.modResults.contents = contents;
    return cfg;
  });
};
