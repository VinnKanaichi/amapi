
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

export const config = {
  maxDuration: 300
};

export default async function handler(req, res) {
  let browser;

  try {
    const presetUrl = req.query.url;

    if (!presetUrl) {
      return res.status(400).json({
        success: false,
        message: "Masukkan parameter ?url=LINK_PRESET"
      });
    }

    const parsed = new URL(presetUrl);

    if (
      parsed.hostname !== "alightcreative.com" &&
      parsed.hostname !== "www.alightcreative.com"
    ) {
      return res.status(400).json({
        success: false,
        message: "Domain preset tidak diizinkan"
      });
    }

    browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    });

    const page = await browser.newPage();

    const playerUrl =
      "https://am.izzxd.my.id/player/preset?alight=" +
      encodeURIComponent(presetUrl);

    const errors = [];

    page.on("pageerror", error => {
      errors.push(error.message);
    });

    await page.goto(playerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(15000);

    const result = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      hasAM: typeof window.AM !== "undefined",
      hasRenderVideo:
        typeof window.AM?.renderVideo === "function",
      globals: Object.keys(window).filter(key =>
        /am|render|player/i.test(key)
      ).slice(0, 50)
    }));

    return res.status(200).json({
      success: true,
      result,
      pageErrors: errors
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
