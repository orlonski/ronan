process.env.PLAYWRIGHT_RAIZ = "/repo";
process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||= "/usr/bin/chromium";
await import("./render.mjs");
