import pc from "picocolors";
import ora from "ora";

const isInteractive = process.stdout.isTTY && !process.env.CI;

export const log = {
  info(msg: string) {
    console.log(pc.cyan("i") + " " + msg);
  },
  success(msg: string) {
    console.log(pc.green("✓") + " " + msg);
  },
  warn(msg: string) {
    console.log(pc.yellow("⚠") + " " + msg);
  },
  error(msg: string) {
    console.error(pc.red("✗") + " " + msg);
  },
  dim(msg: string) {
    console.log(pc.dim(msg));
  },
  plain(msg: string) {
    console.log(msg);
  },
};

export function spinner(text: string) {
  if (!isInteractive) {
    return {
      start: () => ({ text, succeed: (t?: string) => log.success(t || text), fail: (t?: string) => log.error(t || text), stop: () => {} }),
      succeed: (t?: string) => log.success(t || text),
      fail: (t?: string) => log.error(t || text),
      stop: () => {},
      text,
    };
  }
  return ora({ text, color: "cyan" });
}

export function heading(msg: string) {
  console.log("");
  console.log(pc.bold(pc.cyan(msg)));
  console.log(pc.dim("─".repeat(msg.length)));
}

export function table(rows: [string, string][]) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    console.log(`  ${pc.dim(key.padEnd(maxKey + 2))}${value}`);
  }
}
