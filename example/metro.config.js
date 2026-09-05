const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer/expo");
config.resolver.assetExts = config.resolver.assetExts.filter((extension) => extension !== "svg");
config.resolver.sourceExts.push("svg");
const source = path.resolve(__dirname, "../src");
config.watchFolders = [path.resolve(__dirname, "..")];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../node_modules"),
];

// Load the checkout directly so harness edits participate in Fast Refresh.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@hellohelen-ai/goliath") {
    return { type: "sourceFile", filePath: path.join(source, "index.ts") };
  }
  if (context.originModulePath.startsWith(`${source}${path.sep}`)) {
    if (moduleName.startsWith(".")) {
      // The library uses Node ESM .js specifiers for its TypeScript sources.
      moduleName = moduleName.replace(/\.js$/, "");
    } else {
      // Use the app's peer dependencies, including its version of the AI SDK.
      context = { ...context, originModulePath: path.join(__dirname, "package.json") };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
