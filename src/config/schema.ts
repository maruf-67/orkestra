import { z } from "zod";

export const remoteConfigSchema = z.object({
  host: z.string(),
  path: z.string(),
  user: z.string().optional(),
  port: z.number().int().optional(),
  sshKey: z.string().optional(),
});

export const deploymentConfigSchema = z.object({
  branch: z.string().default("main"),
  strategy: z.enum(["reset", "pull"]).default("reset"),
  remote: remoteConfigSchema.optional(),
  php: z.union([
    z.string(),
    z.object({
      version: z.string().optional(),
      binary: z.string().optional(),
    }),
  ]).optional(),
  composer: z.union([
    z.boolean(),
    z.object({
      install: z.boolean().default(true),
      flags: z.string().default("--no-dev --optimize-autoloader --prefer-dist"),
    }),
  ]).default(true),
  database: z.object({
    migrate: z.boolean().default(true),
    seed: z.boolean().default(false),
    force: z.boolean().default(true),
  }).default({ migrate: true, seed: false, force: true }),
  optimize: z.boolean().default(true),
  commands: z.object({
    preDeploy: z.string().optional(),
    postDeploy: z.string().optional(),
  }).optional(),
});

export const octaneServiceSchema = z.object({
  enabled: z.union([z.boolean(), z.literal("auto")]).default("auto"),
  server: z.enum(["roadrunner", "swoole", "frankenphp"]).default("roadrunner"),
  workers: z.union([z.number().int(), z.literal("auto")]).default("auto"),
  maxRequests: z.number().int().default(500),
  port: z.number().int().min(1024).max(65535).optional(),
});

export const queueServiceSchema = z.object({
  enabled: z.boolean().default(true),
  connection: z.string().default("redis"),
  queues: z.string().default("default"),
  sleep: z.number().int().default(3),
  tries: z.number().int().default(3),
  timeout: z.number().int().default(90),
  maxJobs: z.number().int().default(500),
  maxTime: z.number().int().default(3600),
});

export const reverbServiceSchema = z.object({
  enabled: z.union([z.boolean(), z.literal("auto")]).default("auto"),
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1024).max(65535).default(8080),
});

export const servicesConfigSchema = z.object({
  octane: octaneServiceSchema.optional(),
  queue: queueServiceSchema.optional(),
  reverb: reverbServiceSchema.optional(),
});

export const proxyEndpointSchema = z.object({
  domain: z.string(),
  port: z.number().int().min(1024).max(65535),
  ssl: z.boolean().default(true),
  websocket: z.boolean().default(false),
});

export const proxySectionSchema = z.union([
  z.enum(["auto", "caddy", "apache", "nginx"]),
  z.object({
    provider: z.enum(["auto", "caddy", "apache", "nginx"]).default("auto"),
    api: proxyEndpointSchema.optional(),
    realtime: proxyEndpointSchema.optional(),
  }),
]);

export const healthCheckConfigSchema = z.object({
  api: z.object({
    url: z.string().optional(),
    expectedStatus: z.number().int().default(200),
    timeoutMs: z.number().int().default(5000),
  }).optional(),
  realtime: z.object({
    enabled: z.union([z.boolean(), z.literal("auto")]).default("auto"),
    timeoutMs: z.number().int().default(5000),
  }).optional(),
});

export const orkestraConfigSchema = z.object({
  name: z.string().optional(),
  framework: z.string().optional(),
  proxy: proxySectionSchema.default("auto"),
  runtime: z.enum(["auto", "mise", "system"]).default("auto"),
  port: z.number().int().min(1024).max(65535).optional(),
  domain: z.string().optional(),
  ssl: z.boolean().default(true),
  startCommand: z.string().optional(),
  reverbPort: z.number().int().min(1024).max(65535).optional(),
  reverbDomain: z.string().optional(),
  deployment: deploymentConfigSchema.optional(),
  services: servicesConfigSchema.optional(),
  health: healthCheckConfigSchema.optional(),
});

export type OrkestraConfig = z.infer<typeof orkestraConfigSchema>;
export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;
export type ServicesConfig = z.infer<typeof servicesConfigSchema>;
export type RemoteConfig = z.infer<typeof remoteConfigSchema>;

export function validateConfig(data: unknown): OrkestraConfig {
  return orkestraConfigSchema.parse(data);
}
