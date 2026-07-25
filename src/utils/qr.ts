import { log } from "./logger.js";

/**
 * Generate QR code for terminal display.
 * Falls back to URL-only if QR generation fails.
 */
export async function printQRCode(url: string): Promise<void> {
  try {
    // Dynamic import to avoid hard dependency
    const QRCode = await import("qrcode");

    // Generate QR code as terminal string
    const qr = await QRCode.default.toString(url, {
      type: "terminal",
      small: true,
      margin: 1,
    });

    log.plain("");
    log.dim("Scan to open on mobile:");
    console.log(qr);
    log.plain("");
  } catch {
    // Fallback: just show URL
    log.dim(`Open on mobile: ${url}`);
  }
}

/**
 * Generate QR code as ASCII string.
 */
export async function generateQR(url: string): Promise<string> {
  try {
    const QRCode = await import("qrcode");
    return await QRCode.default.toString(url, {
      type: "terminal",
      small: true,
      margin: 1,
    });
  } catch {
    return "";
  }
}
