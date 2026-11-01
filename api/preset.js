
const BASE = "https://am.izzxd.my.id";
const PLAYER = `${BASE}/player/preset`;

const KEYWORDS = [
  "MediaRecorder",
  "VideoEncoder",
  "VideoFrame",
  "canvas.captureStream",
  "toBlob",
  "toDataURL",
  "createObjectURL",
  "application/mp4",
  "video/mp4",
  "exportVideo",
  "renderVideo",
  "startExport",
  "download",
  "ffmpeg",
  "mp4",
  "WebGL2RenderingContext"
];

function extractScripts(html) {
  const scripts = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const src = attrs.match(/\bsrc=["']([^"']+)["']/i);

    if (src) {
      scripts.push(src[1]);
    } else if (match[2].trim()) {
      scripts.push({
        inline: true,
        code: match[2]
      });
    }
  }

  return scripts;
}

function findSnippets(source, keywords) {
  const results = [];

  for (const keyword of keywords) {
    const index = source.toLowerCase().indexOf(
      keyword.toLowerCase()
    );

    if (index !== -1) {
      results.push({
        keyword,
        snippet: source.slice(
          Math.max(0, index - 180),
          Math.min(source.length, index + 350)
        )
      });
    }
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const input = req.query.url;

    if (!input) {
      return res.status(400).json({
        success: false,
        error: "Parameter url wajib diisi"
      });
    }

    const share = new URL(input);

    if (
      share.hostname !== "alightcreative.com" ||
      !share.pathname.includes("/am/share/")
    ) {
      return res.status(400).json({
        success: false,
        error: "Link preset tidak valid"
      });
    }

    const player = new URL(PLAYER);
    player.searchParams.set("alight", share.href);

    console.log("[AM] Opening player:", player.href);

    const response = await fetch(player.href, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      },
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: `Player HTTP ${response.status}`
      });
    }

    const html = await response.text();
    const scripts = extractScripts(html);

    const scriptResults = [];

    for (const item of scripts.slice(0, 10)) {
      if (typeof item === "object") {
        scriptResults.push({
          type: "inline",
          matches: findSnippets(item.code, KEYWORDS)
        });
        continue;
      }

      const scriptUrl = new URL(item, BASE);

      // Hanya mengambil script dari origin AM Player.
      if (scriptUrl.origin !== BASE) {
        scriptResults.push({
          type: "external",
          url: item,
          skipped: "External origin"
        });
        continue;
      }

      try {
        const scriptResponse = await fetch(scriptUrl.href, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Referer": player.href
          },
          signal: AbortSignal.timeout(12000)
        });

        if (!scriptResponse.ok) {
          scriptResults.push({
            type: "external",
            url: scriptUrl.href,
            status: scriptResponse.status
          });
          continue;
        }

        const contentLength = Number(
          scriptResponse.headers.get("content-length") || 0
        );

        if (contentLength > 2 * 1024 * 1024) {
          scriptResults.push({
            type: "external",
            url: scriptUrl.href,
            skipped: "Script exceeds 2 MB"
          });
          continue;
        }

        const source = await scriptResponse.text();

        scriptResults.push({
          type: "external",
          url: scriptUrl.href,
          status: scriptResponse.status,
          size: source.length,
          matches: findSnippets(source, KEYWORDS)
        });

      } catch (error) {
        scriptResults.push({
          type: "external",
          url: scriptUrl.href,
          error: error.message
        });
      }
    }

    const allMatches = scriptResults.flatMap(
      script => script.matches || []
    );

    return res.status(200).json({
      success: true,
      playerUrl: player.href,
      page: {
        status: response.status,
        htmlLength: html.length
      },
      scripts: {
        total: scripts.length,
        inspected: scriptResults.length,
        results: scriptResults
      },
      exportIndicators: [
        ...new Set(allMatches.map(item => item.keyword))
      ]
    });

  } catch (error) {
    console.error("[AM ANALYZER]", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
      }
