import net from "node:net";
import { Client } from "ssh2";
import type { CliRequest, CliResult, CommandSafety, ServiceConfig } from "./switchTypes.js";

const WRITE_COMMAND_PATTERNS = [
  /^\s*(configure|conf\s+t|vlan|interface|trunk|spanning-tree|ip\s|snmp-server|password)\b/i,
  /^\s*(write\s+memory|copy\s+|erase\b|reload\b|boot\b|clear\b|delete\b)/i,
  /^\s*(no\s+|tagged\b|untagged\b|disable\b|enable\b|name\b|exit\b.*write)/i
];

const READ_PRELUDE = ["no page"];

export function classifyCommands(commands: string[]): CommandSafety {
  const blockedCommands = commands.filter((command) => WRITE_COMMAND_PATTERNS.some((pattern) => pattern.test(command)));

  return {
    writeDetected: blockedCommands.length > 0,
    blockedCommands
  };
}

export async function runCli(config: ServiceConfig, request: CliRequest): Promise<CliResult> {
  const commands = request.commands.map((command) => command.trim()).filter(Boolean);
  const safety = classifyCommands(commands);

  if (safety.writeDetected && !config.allowWriteCommands) {
    return {
      transport: request.transport,
      host: config.switchHost,
      commands,
      writeBlocked: true,
      output: `Write/config command blocked by service policy:\n${safety.blockedCommands.join("\n")}\n\nSet ALLOW_SWITCH_WRITE_COMMANDS=true to permit configuration changes.`
    };
  }

  const fullCommandList = [...READ_PRELUDE, ...commands];
  const output =
    request.transport === "ssh"
      ? await runSsh(config.switchHost, request, fullCommandList)
      : await runTelnet(config.switchHost, request, fullCommandList);

  return {
    transport: request.transport,
    host: config.switchHost,
    commands,
    writeBlocked: false,
    output
  };
}

function runSsh(host: string, request: CliRequest, commands: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = "";
    const timeoutMs = request.timeoutMs ?? 15_000;
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.shell((error, stream) => {
          if (error) {
            clearTimeout(timer);
            conn.end();
            reject(error);
            return;
          }

          stream.on("data", (data: Buffer) => {
            output += data.toString("utf8");
          });
          stream.stderr.on("data", (data: Buffer) => {
            output += data.toString("utf8");
          });
          stream.on("close", () => {
            clearTimeout(timer);
            conn.end();
            resolve(cleanTranscript(output));
          });

          sendCommands(stream, commands);
        });
      })
      .on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      })
      .connect({
        host,
        port: 22,
        username: request.username || undefined,
        password: request.password || undefined,
        readyTimeout: Math.min(timeoutMs, 8000)
      });
  });
}

function runTelnet(host: string, request: CliRequest, commands: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 23 });
    let output = "";
    let usernameSent = false;
    let passwordSent = false;
    let commandsStarted = false;
    const timeoutMs = request.timeoutMs ?? 18_000;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Telnet command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const startCommands = () => {
      if (commandsStarted) {
        return;
      }

      commandsStarted = true;
      sendCommands(socket, commands);
    };

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      setTimeout(() => {
        if (!commandsStarted && !/password|username|login/i.test(output)) {
          startCommands();
        }
      }, 1200);
    });
    socket.on("data", (chunk: string) => {
      output += chunk;

      if (!usernameSent && /(username|login)[: ]*$/i.test(output)) {
        usernameSent = true;
        socket.write(`${request.username || ""}\r\n`);
        return;
      }

      if (!passwordSent && /password[: ]*$/i.test(output)) {
        passwordSent = true;
        socket.write(`${request.password || ""}\r\n`);
        setTimeout(startCommands, 500);
        return;
      }

      if (!commandsStarted && /[>#]\s*$/.test(output)) {
        startCommands();
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(cleanTranscript(output));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sendCommands(stream: NodeJS.WritableStream, commands: string[]) {
  const queue = [...commands, "exit"];
  let delay = 250;

  for (const command of queue) {
    setTimeout(() => {
      stream.write(`${command}\r\n`);
    }, delay);
    delay += 550;
  }

  setTimeout(() => {
    if ("end" in stream && typeof stream.end === "function") {
      stream.end();
    }
  }, delay + 600);
}

function cleanTranscript(output: string) {
  return output
    .replace(/\r/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[^\x09\x0a\x20-\x7e]/g, "")
    .trim();
}
