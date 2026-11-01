
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

export const config = {
  maxDuration: 300
};

export default async function handler(req, res) {
  let browser;

  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        message: "Method not allowed"
      });
    }

    const presetUrl = req.query.url;

    if (!presetUrl) {
      return res.status(400).json({
        success: false,
        message: "Masukkan parameter ?url=LINK_PRESET"
      });
    }

    let parsed;

    try {
      parsed = new URL(presetUrl);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL preset tidak valid"
      });
    }

    if (
      !["alightcreative.com", "www.alightcreative.com"]
        .includes(parsed.hostname)
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

    const page = await browser.newPage({
      viewport: {
        width: 1080,
        height: 1920
      }
    });

    const pageErrors = [];
    const consoleErrors = [];

    page.on("pageerror", error => {
      pageErrors.push(error.message);
    });

    page.on("console", message => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    const playerUrl =
      "https://am.izzxd.my.id/player/preset?alight=" +
      encodeURIComponent(presetUrl);

    await page.goto(playerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Tunggu inisialisasi AM Player
    await page.waitForFunction(
      () =>
        typeof window.AM !== "undefined" &&
        typeof window.AM.renderVideo === "function",
      { timeout: 90000 }
    );

    const result = await page.evaluate(() => {
      const fn = window.AM?.renderVideo;

      let webgl = false;

      try {
        const canvas = document.createElement("canvas");

        webgl = Boolean(
          canvas.getContext("webgl2") ||
          canvas.getContext("webgl")
        );
      } catch {}

      return {
        title: document.title,
        url: location.href,
        readyState: document.readyState,

        player: {
          hasAM: typeof window.AM !== "undefined",
          hasRenderVideo:
            typeof fn === "function",
          amKeys: Object.keys(window.AM || {}),
          renderArguments: fn?.length ?? null,
          renderSource: fn
            ? String(fn).slice(0, 6000)
            : null
        },

        capabilities: {
          videoEncoder:
            typeof VideoEncoder !== "undefined",
          videoFrame:
            typeof VideoFrame !== "undefined",
          offscreenCanvas:
            typeof OffscreenCanvas !== "undefined",
          mediaRecorder:
            typeof MediaRecorder !== "undefined",
          webgl
        }
      };
    });

    return res.status(200).json({
      success: true,
      message: "AM Player berhasil diinisialisasi",
      result,
      pageErrors,
      consoleErrors: consoleErrors.slice(0, 20)
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Gagal memeriksa AM Player",
      error: error.message,
      stack: error.stack?.split("\n").slice(0, 5)
    });

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
