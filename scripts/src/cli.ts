import { addCommand, listCommand, printUsage, removeCommand, syncCommand } from "./commands";
import { parseArgs } from "./lib";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  if (flags.help || flags.h) {
    printUsage();
    return;
  }
  switch (command) {
    case "add":
      await addCommand(flags);
      break;
    case "list":
      await listCommand(flags);
      break;
    case "remove":
      await removeCommand(flags);
      break;
    case "sync":
      await syncCommand(flags);
      break;
    default:
      printUsage();
      if (command) {
        throw new Error(`未知命令: ${command}`);
      }
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
