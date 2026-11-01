
const API_BASE = "https://am.izzxd.my.id";

function send(res, status, data) {
  return res.status(status).json(data);
}

function extractShareUrl(input) {
  try {
    let parsed = new URL(input);

    // Mendukung URL halaman player AM.
    if (
      parsed.hostname === "am.izzxd.my.id" &&
      parsed.pathname === "/player/preset"
    ) {
      const original = parsed.searchParams.get("alight");
      if (!original) return null;
      parsed = new URL(original);
    }

    // Hanya menerima link share Alight Motion.
    if (
      parsed.hostname !== "alightcreative.com" &&
      parsed.hostname !== "www.alightcreative.com"
    ) {
      return null;
    }

    if (!parsed.pathname.includes("/am/share/")) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, {
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const input =
      req.method === "GET"
        ? req.query?.url
        : req.body?.url;

    if (!input || typeof input !== "string") {
      return send(res, 400, {
        success: false,
        error: "Parameter url wajib diisi"
      });
    }

    const shareUrl = extractShareUrl(input);

    if (!shareUrl) {
      return send(res, 400, {
        success: false,
        error: "Link Alight Motion tidak valid"
      });
    }

    const match = shareUrl.pathname.match(/\/p\/([^/]+)/);

    if (!match) {
      return send(res, 400, {
        success: false,
        error: "Preset ID tidak ditemukan"
      });
    }

    const presetId = match[1];

    // Mengambil daftar metadata preset.
    const response = await fetch(
      `${API_BASE}/api/presets`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "AM-Export-API/1.0"
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      throw new Error(
        `AM API returned HTTP ${response.status}`
      );
    }

    const data = await response.json();

    const presets = Array.isArray(data.presets)
      ? data.presets
      : [];

    const preset = presets.find(
      item => item.pid === presetId
    );

    if (!preset) {
      return send(res, 404, {
        success: false,
        error: "Preset tidak ditemukan dalam daftar API"
      });
    }

    let xmlUrl = null;
    let xml = null;

    if (typeof preset.xmlUrl === "string") {
      const parsedXmlUrl = new URL(
        preset.xmlUrl,
        API_BASE
      );

      if (parsedXmlUrl.origin === API_BASE) {
        xmlUrl = parsedXmlUrl.href;

        const xmlResponse = await fetch(xmlUrl, {
          headers: {
            Accept: "application/xml,text/xml"
          },
          signal: AbortSignal.timeout(20000)
        });

        if (xmlResponse.ok) {
          xml = await xmlResponse.text();
        }
      }
    }

    return send(res, 200, {
      success: true,
      source: "Izz AM Player",
      preset: {
        id: preset.pid,
        link: preset.link ?? null,
        projects: preset.projects ?? null,
        xmlUrl,
        xmlAvailable: Boolean(xml),
        xml
      }
    });

  } catch (error) {
    console.error("AM PRESET API ERROR:", error);

    return send(res, 502, {
      success: false,
      error: "Gagal mengambil data preset",
      detail: error.message
    });
  }
}
