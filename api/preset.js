
const PLAYER_URL =
  "https://am.izzxd.my.id/player/preset";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const alight = req.query.url;

    if (!alight) {
      return res.status(400).json({
        success: false,
        error: "Parameter url wajib diisi"
      });
    }

    const share = new URL(alight);

    if (
      share.hostname !== "alightcreative.com" ||
      !share.pathname.includes("/am/share/")
    ) {
      return res.status(400).json({
        success: false,
        error: "Link preset tidak valid"
      });
    }

    const player = new URL(PLAYER_URL);
    player.searchParams.set("alight", share.href);

    const response = await fetch(player.href, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      },
      signal: AbortSignal.timeout(20000)
    });

    const html = await response.text();

    return res.status(response.status).json({
      success: response.ok,
      playerUrl: player.href,
      status: response.status,
      contentType: response.headers.get("content-type"),
      htmlLength: html.length,
      pageLoaded: response.ok
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
