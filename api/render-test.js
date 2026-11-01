
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

export const config = {
  maxDuration: 300
};

const PLAYER_URL = "https://am.izzxd.my.id/player/preset?alight=";

function safeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || null
  };
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  const logs = [];
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const httpErrors = [];

  const log = (message, data = null) => {
    const entry = {
      time: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      message,
      data
    };

    logs.push(entry);
    console.log(JSON.stringify(entry));
  };

  let browser;

  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const apiKey = req.headers["x-api-key"];

    if (
      !process.env.TEST_API_KEY ||
      apiKey !== process.env.TEST_API_KEY
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const presetUrl = req.query.url;

    if (!presetUrl) {
      return res.status(400).json({
        success: false,
        error: "Parameter url wajib diisi"
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(presetUrl);
    } catch {
      return res.status(400).json({
        success: false,
        error: "URL preset tidak valid"
      });
    }

    if (
      parsedUrl.hostname !== "alightcreative.com" &&
      !parsedUrl.hostname.endsWith(".alightcreative.com")
    ) {
      return res.status(400).json({
        success: false,
        error: "Domain preset tidak diizinkan"
      });
    }

    log("Memulai Chromium");

    browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    });

    const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 900
      }
    });

    page.on("pageerror", error => {
      pageErrors.push(error.message);
      log("PAGE ERROR", error.message);
    });

    page.on("console", message => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
        log("CONSOLE ERROR", message.text());
      }
    });

    page.on("requestfailed", request => {
      const item = {
        url: request.url(),
        error: request.failure()?.errorText || "Unknown"
      };

      failedRequests.push(item);
      log("REQUEST FAILED", item);
    });

    page.on("response", response => {
      if (response.status() >= 400) {
        const item = {
          status: response.status(),
          url: response.url()
        };

        httpErrors.push(item);
        log("HTTP ERROR", item);
      }
    });

    const playerUrl =
      PLAYER_URL + encodeURIComponent(presetUrl);

    log("Membuka AM Player", {
      url: playerUrl
    });

    await page.goto(playerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    log("Menunggu AM.renderVideo tersedia");

    await page.waitForFunction(
      () =>
        window.AM &&
        typeof window.AM.renderVideo === "function",
      {
        timeout: 120000
      }
    );

    log("AM Player berhasil dimuat");

    // Tunggu preset siap.
    log("Menunggu AM.waitReady()");

    const readyResult = await page.evaluate(async () => {
      const result = await window.AM.waitReady();

      return {
        result,
        durationMs: window.AM.durationMs,
        state: window.AM.getState(),
        projects: window.AM.getAvailableProjects()
      };
    });

    log("Preset siap", readyResult);

    // Periksa kemampuan export browser.
    const exportSupport = await page.evaluate(() => {
      return window.AM.checkExportSupport();
    });

    log("Export support", exportSupport);

    // Ambil kondisi browser.
    const browserDiagnostics = await page.evaluate(() => {
      const canvas = document.createElement("canvas");

      return {
        userAgent: navigator.userAgent,
        videoEncoder: typeof VideoEncoder !== "undefined",
        videoFrame: typeof VideoFrame !== "undefined",
        offscreenCanvas: typeof OffscreenCanvas !== "undefined",
        mediaRecorder: typeof MediaRecorder !== "undefined",
        webgl: Boolean(
          canvas.getContext("webgl") ||
          canvas.getContext("webgl2")
        )
      };
    });

    log("Browser diagnostics", browserDiagnostics);

    // Mulai render. Tidak ada timeout buatan di bagian ini.
    log("RENDER DIMULAI", {
      resolution: 480,
      fps: 30,
      quality: 0.5
    });

    const renderResult = await page.evaluate(async () => {
      return await window.AM.renderVideo({
        resolution: 480,
        fps: 30,
        quality: 0.5,

        onProgress(progress) {
          console.log(
            "[RENDER_PROGRESS]",
            JSON.stringify(progress)
          );
        }
      });
    });

    log("RENDER SELESAI");

    // Ambil progress dan state terakhir.
    const finalDiagnostics = await page.evaluate(() => {
      return {
        progress: window.AM.getRenderProgress(),
        state: window.AM.getState()
      };
    });

    // Jangan kirim Base64 MP4 mentah ke response JSON.
    // Simpan hanya informasi hasil untuk pengujian.
    const renderSummary = renderResult
      ? {
          success: renderResult.success ?? null,
          durationSec: renderResult.durationSec ?? null,
          sizeBytes: renderResult.sizeBytes ?? null,
          type: renderResult.type ?? null,
          hasBlobUrl: Boolean(renderResult.blobUrl),
          hasBase64: Boolean(renderResult.base64),
          base64Length:
            typeof renderResult.base64 === "string"
              ? renderResult.base64.length
              : 0,
          otherKeys: Object.keys(renderResult)
        }
      : null;

    log("Hasil render", renderSummary);

    return res.status(200).json({
      success: true,
      message: "Render selesai",
      elapsedMs: Date.now() - startedAt,
      ready: readyResult,
      exportSupport,
      browserDiagnostics,
      render: renderSummary,
      finalDiagnostics,
      logs,
      pageErrors,
      consoleErrors,
      failedRequests,
      httpErrors
    });

  } catch (error) {
    log("TERJADI ERROR", safeError(error));

    return res.status(500).json({
      success: false,
      error: safeError(error),
      elapsedMs: Date.now() - startedAt,
      logs,
      pageErrors,
      consoleErrors,
      failedRequests,
      httpErrors
    });

  } finally {
    if (browser) {
      try {
        await browser.close();
        log("Chromium ditutup");
      } catch (error) {
        console.error("Gagal menutup Chromium:", error.message);
      }
    }
  }
}
