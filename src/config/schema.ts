import { z } from "zod";

export const orkestraConfigSchema = z.object({
  name: z.string().optional(),
  framework: z.string().optional(),
  proxy: z.enum(["auto", "caddy", "apache", "nginx"]).default("auto"),
  runtime: z.enum(["auto", "mise", "system"]).default("auto"),
  port: z.number().int().min(1024).max(65535).optional(),
  domain: z.string().optional(),
  ssl: z.boolean().default(true),
  startCommand: z.string().optional(),
  /**
   * The TCP port Reverb/WebSocket server binds to locally (e.g. 8080, 8081).
   * Each project must use a unique port to avoid conflicts.
   */
  reverbPort: z.number().int().min(1024).max(65535).optional(),
  /**
   * The public-facing domain for this project's Reverb server.
   * Proxied by Caddy: reverbDomain:443 -> localhost:reverbPort.
   * Example: texel-reverb.dev.com
   */
  reverbDomain: z.string().optional(),
});

export type OrkestraConfig = z.infer<typeof orkestraConfigSchema>;

export function validateConfig(data: unknown): OrkestraConfig {
  return orkestraConfigSchema.parse(data);
}
