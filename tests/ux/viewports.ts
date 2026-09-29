import type { PlaywrightTestOptions } from "@playwright/test";

/**
 * Os quatro viewports da suíte de UX (nomes = nomes dos projetos do Playwright).
 * Fonte única: o playwright.config.ts e os specs leem daqui.
 */
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export type NomeViewport = "mobile" | "mac1440" | "mac1280" | "ultra";

export const VIEWPORTS: Record<NomeViewport, Partial<PlaywrightTestOptions>> = {
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: UA_IPHONE,
  },
  mac1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mac1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  ultra: { viewport: { width: 3440, height: 1440 }, deviceScaleFactor: 1 },
};

export const NOMES_VIEWPORTS = Object.keys(VIEWPORTS) as NomeViewport[];
