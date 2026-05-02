module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    // Worklets plugin precisa ser o ultimo (req react-native-reanimated 4 / worklets)
    plugins: ["react-native-worklets/plugin"],
  };
};
