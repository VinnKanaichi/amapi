
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

    // Proteksi agar endpoint tidak bebas digunakan orang lain.
    const apiKey = process.env.TEST_API_KEY;

    if (!apiKey || req.headers["x-api-key"] !== apiKey) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const presetUrl = req.query.url;

    if (!presetUrl) {
      return res.status(400).json({
        success: false,
        message: "Parameter url wajib diisi"
      });
    }

    let parsed;

    try {
      parsed = new URL(presetUrl);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL tidak valid"
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
        width: 720,
        height: 1280
      }
    });

    page.setDefaultTimeout(250000);

    const pageErrors = [];

    page.on("pageerror", error => {
      pageErrors.push(error.message);
    });

    const playerUrl =
      "https://am.izzxd.my.id/player/preset?alight=" +
      encodeURIComponent(presetUrl);

    await page.goto(playerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Tunggu API player tersedia.
    await page.waitForFunction(() =>
      typeof window.AM?.renderVideo === "function"
    );

    // Tunggu preset siap.
    const ready = await page.evaluate(async () => {
      if (typeof AM.waitReady === "function") {
        await AM.waitReady();
      }

      return {
        durationMs: AM.durationMs,
        state: AM.getState?.()
      };
    });

    // Periksa dukungan ekspor.
    const support = await page.evaluate(async () => {
      if (typeof AM.checkExportSupport === "function") {
        return await AM.checkExportSupport();
      }

      return null;
    });

    // Jalankan render dengan konfigurasi percobaan.
    const result = await page.evaluate(async () => {
      window.__renderProgress = null;

      const renderResult = await AM.renderVideo({
        resolution: 480,
        fps: 30,
        quality: 0.5,

        onProgress(progress) {
          window.__renderProgress = progress;
        }
      });

      const base64 = renderResult?.base64;

      return {
        success: renderResult?.success ?? false,
        durationSec: renderResult?.durationSec ?? null,
        sizeBytes: renderResult?.sizeBytes ?? null,
        type: renderResult?.type ?? null,
        base64Length:
          typeof base64 === "string" ? base64.length : 0,
        base64Prefix:
          typeof base64 === "string"
            ? base64.slice(0, 40)
            : null
      };
    });

    return res.status(200).json({
      success: true,
      message: "Proses render selesai",
      ready,
      support,
      render: result,
      pageErrors
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Render gagal",
      error: error.message,
      pageErrors: error.pageErrors || []
    });

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
