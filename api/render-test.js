
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

export const config = {
  maxDuration: 300
};

export default async function handler(req, res) {
  let browser;
  let page;

  const startedAt = Date.now();
  const logs = [];

  const log = (step, data = null) => {
    const entry = {
      step,
      elapsedMs: Date.now() - startedAt,
      ...(data !== null ? { data } : {})
    };

    logs.push(entry);
    console.log("[AM DEBUG]", JSON.stringify(entry));
  };

  const response = (status, data) => {
    return res.status(status).json({
      ...data,
      elapsedMs: Date.now() - startedAt,
      logs
    });
  };

  try {
    if (req.method !== "GET") {
      return response(405, {
        success: false,
        error: "Method not allowed"
      });
    }

    // API key
    const apiKey = process.env.TEST_API_KEY;

    if (!apiKey || req.headers["x-api-key"] !== apiKey) {
      return response(401, {
        success: false,
        error: "Unauthorized"
      });
    }

    // Validasi URL preset
    const presetUrl = req.query.url;

    if (!presetUrl) {
      return response(400, {
        success: false,
        error: "Parameter url wajib diisi"
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(presetUrl);
    } catch {
      return response(400, {
        success: false,
        error: "URL tidak valid"
      });
    }

    if (
      !["alightcreative.com", "www.alightcreative.com"]
        .includes(parsedUrl.hostname)
    ) {
      return response(400, {
        success: false,
        error: "Domain preset tidak diizinkan"
      });
    }

    log("Starting Chromium");

    browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    });

    page = await browser.newPage({
      viewport: {
        width: 720,
        height: 1280
      }
    });

    page.setDefaultTimeout(30000);

    const pageErrors = [];
    const consoleErrors = [];

    page.on("pageerror", error => {
      pageErrors.push(error.message);
      log("Page error", error.message);
    });

    page.on("console", message => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    page.on("requestfailed", request => {
      log("Request failed", {
        url: request.url(),
        error: request.failure()?.errorText
      });
    });

    const playerUrl =
      "https://am.izzxd.my.id/player/preset?alight=" +
      encodeURIComponent(presetUrl);

    log("Opening AM Player");

    await page.goto(playerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    log("Player document loaded");

    // Tunggu AM Player tersedia.
    await page.waitForFunction(() => {
      return typeof window.AM?.renderVideo === "function";
    }, {
      timeout: 60000
    });

    log("AM Player initialized");

    // Tunggu kesiapan player.
    const ready = await page.evaluate(async () => {
      if (typeof AM.waitReady === "function") {
        await AM.waitReady();
      }

      return {
        durationMs: AM.durationMs ?? null,
        state: AM.getState?.() ?? null,
        methods: Object.keys(AM)
      };
    });

    log("Player ready", ready);

    // Diagnostik browser dan encoder.
    const diagnostics = await page.evaluate(async () => {
      const result = {
        userAgent: navigator.userAgent,
        webCodecs: typeof VideoEncoder !== "undefined",
        videoFrame: typeof VideoFrame !== "undefined",
        offscreenCanvas: typeof OffscreenCanvas !== "undefined",
        mediaRecorder: typeof MediaRecorder !== "undefined",
        webGL: false,
        h264: null,
        vp8: null,
        vp9: null
      };

      const canvas = document.createElement("canvas");

      result.webGL = !!(
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl")
      );

      if (typeof VideoEncoder !== "undefined") {
        const configs = {
          h264: {
            codec: "avc1.42001f",
            width: 480,
            height: 854,
            bitrate: 2000000,
            framerate: 30
          },
          vp8: {
            codec: "vp8",
            width: 480,
            height: 854,
            bitrate: 2000000,
            framerate: 30
          },
          vp9: {
            codec: "vp09.00.10.08",
            width: 480,
            height: 854,
            bitrate: 2000000,
            framerate: 30
          }
        };

        for (const [name, config] of Object.entries(configs)) {
          result[name] = await VideoEncoder
            .isConfigSupported(config)
            .then(value => ({
              supported: value.supported,
              config: value.config ?? null
            }))
            .catch(error => ({
              supported: false,
              error: error.message
            }));
        }
      }

      return result;
    });

    log("Browser diagnostics", diagnostics);

    // Periksa dukungan ekspor AM Player.
    let exportSupport = null;

    try {
      exportSupport = await page.evaluate(async () => {
        if (typeof AM.checkExportSupport === "function") {
          return await AM.checkExportSupport();
        }

        return null;
      });

      log("Export support checked", exportSupport);
    } catch (error) {
      log("Export support check failed", error.message);
    }

    // Jika browser tidak punya WebCodecs, jangan mulai render.
    if (!diagnostics.webCodecs) {
      return response(200, {
        success: false,
        stage: "browser-diagnostics",
        error: "VideoEncoder tidak tersedia",
        ready,
        diagnostics,
        exportSupport,
        pageErrors,
        consoleErrors
      });
    }

    // Jalankan render dan pantau progres.
    log("Starting render");

    const renderPromise = page.evaluate(async () => {
      try {
        const result = await AM.renderVideo({
          resolution: 480,
          fps: 30,
          quality: 0.5,

          onProgress(progress) {
            window.__amDebugProgress = progress;
          }
        });

        return {
          success: result?.success ?? false,
          durationSec: result?.durationSec ?? null,
          sizeBytes: result?.sizeBytes ?? null,
          type: result?.type ?? null,
          base64Length:
            typeof result?.base64 === "string"
              ? result.base64.length
              : 0,
          base64Prefix:
            typeof result?.base64 === "string"
              ? result.base64.slice(0, 40)
              : null
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    });

    let renderResult;

    const renderTimeout = new Promise(resolve => {
      setTimeout(() => {
        resolve({
          success: false,
          timeout: true,
          message: "Render melewati batas waktu 120 detik"
        });
      }, 120000);
    });

    renderResult = await Promise.race([
      renderPromise,
      renderTimeout
    ]);

    log("Render result", renderResult);

    // Ambil progres dan state terakhir.
    let finalProgress = null;

    try {
      finalProgress = await page.evaluate(() => ({
        progress: AM.getRenderProgress?.() ?? null,
        callbackProgress: window.__amDebugProgress ?? null,
        state: AM.getState?.() ?? null
      }));

      log("Final render progress", finalProgress);
    } catch (error) {
      log("Progress read failed", error.message);
    }

    return response(200, {
      success: !renderResult.timeout && renderResult.success,
      stage: renderResult.timeout
        ? "render-timeout"
        : "render-finished",
      ready,
      diagnostics,
      exportSupport,
      render: renderResult,
      finalProgress,
      pageErrors,
      consoleErrors
    });

  } catch (error) {
    log("Fatal error", error.message);

    return response(500, {
      success: false,
      stage: "fatal",
      error: error.message
    });

  } finally {
    if (browser) {
      await browser.close().catch(error => {
        console.error("[AM DEBUG] Browser close:", error.message);
      });
    }
  }
}
