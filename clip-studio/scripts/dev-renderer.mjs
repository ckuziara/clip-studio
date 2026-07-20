// Start Vite for electron:dev — or, if something already serves port 5173 (a stray
// `npm run dev`, an editor preview), reuse it instead of dying on the strictPort
// conflict. Must stay alive in the reuse case: `concurrently -k` kills the Electron
// process the moment its sibling exits.
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = 5173;
const VITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", ".bin", "vite");

/** True if something accepts TCP connections on host:PORT. */
function serving(host) {
  return new Promise((resolve) => {
    const sock = connect({ port: PORT, host, timeout: 500 })
      .once("connect", () => {
        sock.destroy();
        resolve(true);
      })
      .once("error", () => resolve(false))
      .once("timeout", () => {
        sock.destroy();
        resolve(false);
      });
  });
}

// probe by connecting (not binding): a bind can succeed on one interface family
// while a server listens on the other, which is exactly the collision we're avoiding
const busy = (await serving("127.0.0.1")) || (await serving("::1"));
if (busy) {
  console.log(`[dev-renderer] port ${PORT} already serving — reusing it for Electron`);
  setInterval(() => {}, 1 << 30); // idle forever; Ctrl-C / concurrently teardown ends us
} else {
  const vite = spawn(VITE, [], { stdio: "inherit" });
  vite.on("exit", (code) => process.exit(code ?? 0));
}
