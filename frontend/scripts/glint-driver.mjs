// Drives Glint for verification. A host process keeps the app (a server-mode
// build with scripted dialogs) and one WebKit page alive between commands, so
// an agent can act one step at a time. Run `bin/verify-glint help`.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { webkit } from "playwright";

const repoRoot = resolve(import.meta.dirname, "../..");
const stateDir =
  process.env.GLINT_VERIFY_STATE ??
  join(tmpdir(), `glint-verify-${createHash("sha256").update(repoRoot).digest("hex").slice(0, 8)}`);
const paths = {
  binary: join(stateDir, "bin", "glint-verify"),
  state: join(stateDir, "state.json"),
  home: join(stateDir, "home"),
  dialogs: join(stateDir, "dialogs"),
  appLog: join(stateDir, "app.log"),
  hostLog: join(stateDir, "host.log"),
  database: join(stateDir, "home", "Library", "Application Support", "Glint", "library.sqlite3"),
};
const sources = [
  "main.go",
  "go.mod",
  "go.sum",
  "internal",
  "migrations",
  "frontend/src",
  "frontend/index.html",
  "frontend/vite.config.ts",
  "frontend/package.json",
];
const viewport = { width: 1440, height: 900 };
const actionTimeout = 10_000;

const usage = `Usage: bin/verify-glint <command> [args]

Lifecycle
  build                       Build the frontend and a server-mode binary with scripted dialogs
  start [--skip-build]        Rebuild if stale, then start the app and a WebKit page on empty data
  stop                        Stop the page and the app and delete their data
  doctor                      Report build freshness, processes, and leftover dialog answers
  info                        Print URLs, ports, and paths of the running instance
  restart-app                 Restart only the app on the same data, then reload the page

Navigation and input
  open [path]                 Load a path of the app (default /)
  reload                      Reload the page
  click <role> <name>         Click by ARIA role and accessible name (/regex/ allowed)
  click-css <selector>        Click the first element matching a CSS selector
  mouse-click <selector>      Click the center of an element with the mouse, even under overlays
  right-click <selector>      Right-click the first matching element (in-page context menus)
  press <keys>                Press a key or chord, e.g. ArrowRight, Meta+F
  type <text>                 Type text into the focused element
  select-text <selector>      Drag across the first matching element to select its text
  hover <selector>            Move the mouse over the first matching element

Inspection and evidence
  snapshot                    Print the accessibility tree of the page
  screenshot <file.png>       Save a screenshot of the page
  wait <selector> [state]     Wait for visible (default), hidden, attached, or detached
  eval <expression>           Evaluate a read-only expression in the page and print JSON
  console                     Print and clear page console messages and errors
  sql <query>                 Query the app's SQLite database read-only
  logs                        Print the end of the app log

Native dialogs
  dialog open-file <path>     Answer the next file dialog with a path
  dialog confirm <accept|cancel>
                              Answer the next confirmation
  dialog last                 Print the last dialog the app showed
`;

/** @param {string} text */
function print(text) {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

/** @param {string} message */
function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * @typedef {{ hostPid: number, hostPort: number, appPort: number, startedAt: string }} State
 * @returns {State | null}
 */
function readState() {
  if (!existsSync(paths.state)) {
    return null;
  }
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(paths.state, "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    !("hostPid" in value && typeof value.hostPid === "number") ||
    !("hostPort" in value && typeof value.hostPort === "number") ||
    !("appPort" in value && typeof value.appPort === "number") ||
    !("startedAt" in value && typeof value.startedAt === "string")
  ) {
    throw new Error(`${paths.state} is not a driver state. Run \`stop\`.`);
  }
  return {
    hostPid: value.hostPid,
    hostPort: value.hostPort,
    appPort: value.appPort,
    startedAt: value.startedAt,
  };
}

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((done, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        done(port);
      });
    });
  });
}

/**
 * @param {string} url
 * @param {number} timeout
 */
async function waitForHttp(url, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling until the app answers
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    // oxlint-disable-next-line no-await-in-loop -- polling until the app answers
    await sleep(200);
  }
  throw new Error(`${url} did not answer within ${timeout} ms`);
}

/** @param {string} path */
function newestModification(path) {
  const absolute = join(repoRoot, path);
  if (!existsSync(absolute)) {
    return 0;
  }
  const stat = statSync(absolute);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  let newest = 0;
  for (const entry of readdirSync(absolute, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs);
    }
  }
  return newest;
}

/** @returns {string | null} the source newer than the binary, or null when fresh */
function staleSource() {
  if (!existsSync(paths.binary)) {
    return "the binary is not built";
  }
  const built = statSync(paths.binary).mtimeMs;
  const source = sources.find((path) => newestModification(path) > built);
  return source === undefined ? null : `${source} changed after the build`;
}

function build() {
  /** @type {import("node:child_process").ExecFileSyncOptions} */
  const options = { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"] };
  print("build: generating bindings");
  execFileSync("go", ["tool", "wails3", "generate", "bindings", "-ts", "-i"], options);
  print("build: building the frontend");
  execFileSync("pnpm", ["--dir", "frontend", "run", "build"], options);
  print("build: building the server-mode binary");
  mkdirSync(dirname(paths.binary), { recursive: true });
  execFileSync("go", ["build", "-tags", "server verify", "-o", paths.binary, "."], {
    ...options,
    stdio: ["ignore", "inherit", "ignore"],
  });
  print(`build: ${paths.binary}`);
}

/**
 * @param {string} name
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function sendToHost(name, args) {
  const state = readState();
  if (state === null || !isAlive(state.hostPid)) {
    throw new Error("Glint is not running. Run `start` first.");
  }
  const response = await fetch(`http://127.0.0.1:${state.hostPort}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  /** @type {unknown} */
  const result = await response.json();
  if (
    typeof result !== "object" ||
    result === null ||
    !("ok" in result) ||
    !("output" in result) ||
    typeof result.output !== "string"
  ) {
    throw new Error("the host sent an unexpected reply");
  }
  if (result.ok !== true) {
    throw new Error(result.output);
  }
  return result.output;
}

/** @param {string[]} args */
async function start(args) {
  const running = readState();
  if (running !== null && isAlive(running.hostPid)) {
    throw new Error("Glint is already running. Run `stop` first.");
  }
  if (!args.includes("--skip-build")) {
    const stale = staleSource();
    if (stale !== null) {
      print(`start: rebuilding (${stale})`);
      build();
    }
  }
  if (!existsSync(paths.binary)) {
    throw new Error("binary not built. Run `build`.");
  }
  for (const path of [paths.home, paths.dialogs, paths.state, paths.appLog, paths.hostLog]) {
    rmSync(path, { recursive: true, force: true });
  }
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.dialogs, { recursive: true });
  const host = spawn(process.execPath, [import.meta.filename, "__host"], {
    detached: true,
    stdio: "ignore",
  });
  host.unref();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = readState();
    if (state !== null) {
      print(info(state));
      return;
    }
    if (host.pid === undefined || !isAlive(host.pid)) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- polling until the host is ready
    await sleep(200);
  }
  const log = existsSync(paths.hostLog) ? readFileSync(paths.hostLog, "utf8") : "";
  throw new Error(`the host did not start.\n${log}`);
}

async function stop() {
  const state = readState();
  if (state !== null && isAlive(state.hostPid)) {
    try {
      await sendToHost("shutdown", []);
    } catch {
      process.kill(state.hostPid, "SIGTERM");
    }
    const deadline = Date.now() + 15_000;
    while (isAlive(state.hostPid) && Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- waiting for the host to exit
      await sleep(100);
    }
    if (isAlive(state.hostPid)) {
      process.kill(state.hostPid, "SIGKILL");
    }
  }
  for (const path of [paths.home, paths.dialogs, paths.state, paths.appLog, paths.hostLog]) {
    rmSync(path, { recursive: true, force: true });
  }
  print("stopped");
}

/** @param {State} state */
function info(state) {
  return [
    `app       http://localhost:${state.appPort}/`,
    `host      pid ${state.hostPid}, port ${state.hostPort}`,
    `started   ${state.startedAt}`,
    `database  ${paths.database}`,
    `dialogs   ${paths.dialogs}`,
    `logs      ${paths.appLog}`,
  ].join("\n");
}

async function doctor() {
  /** @type {string[]} */
  const lines = [`state     ${stateDir}`];
  let healthy = true;
  const stale = staleSource();
  if (stale === null) {
    lines.push("OK        build is newer than the sources");
  } else {
    healthy = false;
    lines.push(`STALE BUILD  ${stale}. Run \`stop\`, then \`start\`.`);
  }
  const state = readState();
  if (state === null) {
    lines.push("--        not running");
  } else if (isAlive(state.hostPid)) {
    lines.push(`OK        host pid ${state.hostPid}`);
    try {
      await waitForHttp(`http://localhost:${state.appPort}/`, 2000);
      lines.push(`OK        app answers on port ${state.appPort}`);
    } catch {
      healthy = false;
      lines.push(`FAIL      app does not answer on port ${state.appPort}. See \`logs\`.`);
    }
    if (statSync(import.meta.filename).mtimeMs > Date.parse(state.startedAt)) {
      healthy = false;
      lines.push("STALE DRIVER  the driver changed after start. Run `stop`, then `start`.");
    }
    if (existsSync(paths.binary) && statSync(paths.binary).mtimeMs > Date.parse(state.startedAt)) {
      healthy = false;
      lines.push("STALE INSTANCE  the binary was rebuilt after start. Run `stop`, then `start`.");
    }
  } else {
    healthy = false;
    lines.push(`FAIL      host pid ${state.hostPid} is gone. Run \`stop\`, then \`start\`.`);
  }
  for (const answer of ["open-file", "confirm"]) {
    if (existsSync(join(paths.dialogs, answer))) {
      healthy = false;
      lines.push(`WARN      unused dialog answer: ${answer}. The next dialog will take it.`);
    }
  }
  lines.push(healthy ? "doctor: ok" : "doctor: needs attention");
  print(lines.join("\n"));
}

/** @param {string[]} args */
function dialog(args) {
  const [kind, value] = args;
  if (kind === "last") {
    const last = join(paths.dialogs, "last-dialog");
    print(existsSync(last) ? readFileSync(last, "utf8") : "no dialog shown yet");
    return;
  }
  if (kind === "open-file" && value !== undefined) {
    const path = resolve(value);
    if (!existsSync(path)) {
      throw new Error(`${path} does not exist`);
    }
    writeFileSync(join(paths.dialogs, "open-file"), path);
    print(`the next file dialog returns ${path}`);
    return;
  }
  if (kind === "confirm" && (value === "accept" || value === "cancel")) {
    writeFileSync(join(paths.dialogs, "confirm"), value);
    print(`the next confirmation is answered with ${value}`);
    return;
  }
  throw new Error("usage: dialog open-file <path> | dialog confirm <accept|cancel> | dialog last");
}

/** @param {string[]} args */
function sql(args) {
  const query = args.join(" ");
  if (query === "") {
    throw new Error("usage: sql <query>");
  }
  print(
    execFileSync("sqlite3", ["-readonly", "-header", paths.database, query], { encoding: "utf8" }),
  );
}

function logs() {
  if (!existsSync(paths.appLog)) {
    throw new Error("no app log");
  }
  print(readFileSync(paths.appLog, "utf8").split("\n").slice(-40).join("\n"));
}

// ---- host process ----

/** @param {string} line */
function hostLog(line) {
  appendFileSync(paths.hostLog, `${new Date().toISOString()} ${line}\n`);
}

/** @param {number} port */
function startApp(port) {
  const app = spawn(paths.binary, [], {
    cwd: stateDir,
    env: {
      ...process.env,
      HOME: paths.home,
      WAILS_SERVER_PORT: String(port),
      GLINT_VERIFY_DIALOGS: paths.dialogs,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  /** @param {Buffer} chunk */
  const write = (chunk) => {
    appendFileSync(paths.appLog, chunk);
  };
  app.stdout.on("data", write);
  app.stderr.on("data", write);
  return app;
}

/** @param {import("node:child_process").ChildProcess} app */
async function stopApp(app) {
  if (app.exitCode !== null || app.signalCode !== null) {
    return;
  }
  const exited = new Promise((done) => {
    app.once("exit", done);
  });
  app.kill("SIGTERM");
  await Promise.race([exited, sleep(10_000)]);
  if (app.exitCode === null && app.signalCode === null) {
    app.kill("SIGKILL");
  }
}

/**
 * Builds a Playwright role selector. A /regex/ name matches by pattern, any
 * other name matches the accessible name exactly.
 * @param {string} role
 * @param {string} name
 */
function roleSelector(role, name) {
  const pattern = /^\/.+\/[a-z]*$/u.test(name) ? name : `${JSON.stringify(name)}s`;
  return `role=${role}[name=${pattern}]`;
}

const waitStates = /** @type {const} */ (["visible", "hidden", "attached", "detached"]);

/**
 * @param {string} value
 * @returns {value is (typeof waitStates)[number]}
 */
function isWaitState(value) {
  return waitStates.some((state) => state === value);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {boolean} ok
 * @param {string} output
 */
function reply(response, ok, output) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok, output }));
}

/**
 * @param {string} body
 * @returns {{ name: string, args: string[] }}
 */
function parseCommand(body) {
  /** @type {unknown} */
  const value = JSON.parse(body);
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value && typeof value.name === "string") ||
    !("args" in value && Array.isArray(value.args))
  ) {
    throw new Error("malformed command");
  }
  return { name: value.name, args: value.args.map(String) };
}

async function runHost() {
  const appPort = await freePort();
  const appUrl = `http://localhost:${appPort}`;
  let app = startApp(appPort);
  await waitForHttp(`${appUrl}/`, 30_000);
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport, locale: "en-US" });
  context.setDefaultTimeout(actionTimeout);
  const page = await context.newPage();
  /** @type {string[]} */
  let consoleLines = [];
  page.on("console", (message) => {
    consoleLines.push(`[${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    consoleLines.push(`[pageerror] ${error.message}`);
  });
  await page.goto(`${appUrl}/`);

  /** @type {(name: string, args: string[]) => Promise<string>} */
  const run = async (name, args) => {
    const [first = "", second = ""] = args;
    switch (name) {
      case "open": {
        await page.goto(`${appUrl}${first === "" ? "/" : first}`);
        return page.url();
      }
      case "reload": {
        await page.reload();
        return page.url();
      }
      case "click": {
        const accessibleName = args.slice(1).join(" ");
        await page.locator(roleSelector(first, accessibleName)).first().click();
        return `clicked ${first} "${accessibleName}"`;
      }
      case "click-css": {
        await page.locator(first).first().click();
        return `clicked ${first}`;
      }
      case "mouse-click": {
        const target = page.locator(first).first();
        await target.waitFor();
        const box = await target.boundingBox();
        if (box === null) {
          throw new Error(`${first} has no box`);
        }
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return `clicked the center of ${first}`;
      }
      case "right-click": {
        await page.locator(first).first().click({ button: "right" });
        return `right-clicked ${first}`;
      }
      case "press": {
        await page.keyboard.press(first);
        return `pressed ${first}`;
      }
      case "type": {
        await page.keyboard.type(args.join(" "));
        return "typed";
      }
      case "hover": {
        await page.locator(first).first().hover();
        return `hovering ${first}`;
      }
      case "select-text": {
        const target = page.locator(first).first();
        await target.waitFor();
        const box = await target.boundingBox();
        if (box === null) {
          throw new Error(`${first} has no box`);
        }
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + 1, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
        await page.mouse.up();
        return JSON.stringify(await page.evaluate(() => globalThis.getSelection()?.toString()));
      }
      case "snapshot": {
        return page.locator("body").ariaSnapshot();
      }
      case "screenshot": {
        const file = resolve(first === "" ? "glint.png" : first);
        await page.screenshot({ path: file });
        return file;
      }
      case "wait": {
        const state = second === "" ? "visible" : second;
        if (!isWaitState(state)) {
          throw new Error(`state must be one of ${waitStates.join(", ")}`);
        }
        await page.locator(first).first().waitFor({ state });
        return `${first} is ${state}`;
      }
      case "eval": {
        return JSON.stringify(await page.evaluate(args.join(" ")), null, 2) ?? "undefined";
      }
      case "console": {
        const output = consoleLines.join("\n");
        consoleLines = [];
        return output === "" ? "(no console messages)" : output;
      }
      case "restart-app": {
        await stopApp(app);
        app = startApp(appPort);
        await waitForHttp(`${appUrl}/`, 30_000);
        await page.reload();
        return "app restarted on the same data";
      }
      default: {
        throw new Error(`unknown command: ${name}`);
      }
    }
  };

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      void (async () => {
        try {
          const { name, args } = parseCommand(body);
          if (name === "shutdown") {
            reply(response, true, "shutting down");
            await shutdown();
            return;
          }
          hostLog(`${name} ${JSON.stringify(args)}`);
          reply(response, true, await run(name, args));
        } catch (error) {
          reply(response, false, error instanceof Error ? error.message : String(error));
        }
      })();
    });
  });

  const shutdown = async () => {
    hostLog("shutdown");
    server.close();
    await browser.close().catch(() => {});
    await stopApp(app);
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown();
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const hostPort = typeof address === "object" && address !== null ? address.port : 0;
    /** @type {State} */
    const state = { hostPid: process.pid, hostPort, appPort, startedAt: new Date().toISOString() };
    writeFileSync(paths.state, JSON.stringify(state));
    hostLog(`ready on ${hostPort}, app on ${appPort}`);
  });
}

// ---- entry ----

const [command = "help", ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "help":
    case "--help": {
      print(usage);
      break;
    }
    case "build": {
      build();
      break;
    }
    case "start": {
      await start(args);
      break;
    }
    case "stop": {
      await stop();
      break;
    }
    case "doctor": {
      await doctor();
      break;
    }
    case "info": {
      const state = readState();
      print(state === null ? "not running" : info(state));
      break;
    }
    case "dialog": {
      dialog(args);
      break;
    }
    case "sql": {
      sql(args);
      break;
    }
    case "logs": {
      logs();
      break;
    }
    case "__host": {
      await runHost().catch((/** @type {unknown} */ error) => {
        hostLog(
          `failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
        process.exit(1);
      });
      break;
    }
    default: {
      print(await sendToHost(command, args));
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
