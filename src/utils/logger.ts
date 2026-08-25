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

export function table(rows: (string | string[])[]) {
  if (rows.length === 0) return;
  
  // Check if first row is header (array)
  const firstRow = rows[0];
  if (Array.isArray(firstRow)) {
    // Multi-column table
    const numCols = firstRow.length;
    const colWidths: number[] = new Array(numCols).fill(0);
    
    // Calculate column widths
    for (const row of rows) {
      if (Array.isArray(row)) {
        for (let i = 0; i < numCols; i++) {
          colWidths[i] = Math.max(colWidths[i], (row[i] || "").length);
        }
      }
    }
    
    // Print rows
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (Array.isArray(row)) {
        const parts = row.map((cell, i) => cell.padEnd(colWidths[i] + 2));
        console.log(`  ${parts.join("")}`);
      }
    }
  } else {
    // Simple key-value table (backward compatible)
    const maxKey = Math.max(...rows.map(([k]) => k.length));
    for (const [key, value] of rows) {
      console.log(`  ${pc.dim(key.padEnd(maxKey + 2))}${value}`);
    }
  }
}
