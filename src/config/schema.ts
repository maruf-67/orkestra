import { z } from "zod";

export const orkestraConfigSchema = z.object({
  name: z.string().optional(),
  framework: z.string().optional(),
  proxy: z.enum(["auto", "caddy", "apache", "nginx"]).default("auto"),
  runtime: z.enum(["auto", "mise", "system"]).default("auto"),
  port: z.number().int().min(1024).max(65535).optional(),
  domain: z.string().optional(),
  ssl: z.boolean().default(true),
});

export type OrkestraConfig = z.infer<typeof orkestraConfigSchema>;

export function validateConfig(data: unknown): OrkestraConfig {
  return orkestraConfigSchema.parse(data);
}
