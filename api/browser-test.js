import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

export const config = {
  maxDuration: 300
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  let browser;

  try {
    browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    });

    const page = await browser.newPage();

    await page.goto(
      "https://am.izzxd.my.id/player/preset",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    const result = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      hasAM: typeof window.AM !== "undefined",
      hasRenderVideo:
        typeof window.AM?.renderVideo === "function",
      userAgent: navigator.userAgent
    }));

    return res.status(200).json({
      success: true,
      message: "Browser berhasil dijalankan",
      result
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
