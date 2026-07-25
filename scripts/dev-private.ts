import { spawn, type ChildProcess } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const privateReceiptUrl = process.env.NEXT_PUBLIC_PRIVATE_RECEIPT_URL ?? "http://127.0.0.1:3210/receipts";
const children: ChildProcess[] = [];
let stopping = false;

function start(args: string[], env = process.env) {
  const child = spawn(npmCommand, args, { env, shell: isWindows, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exitCode = code;
}

start(["run", "private-receipts:serve"]);
start(["run", "dev:demo"], {
  ...process.env,
  NEXT_PUBLIC_RECEIPT_DATA_MODE: "private",
  NEXT_PUBLIC_PRIVATE_RECEIPT_URL: privateReceiptUrl,
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
