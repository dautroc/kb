#!/usr/bin/env node
import { Command } from "commander";
import { makeInitCommand } from "./commands/init.js";
import { makeStatusCommand } from "./commands/status.js";
import { makeIndexCommand } from "./commands/index-cmd.js";
import { makeSearchCommand } from "./commands/search.js";
import { makeIngestCommand } from "./commands/ingest.js";
import { makeQueryCommand } from "./commands/query.js";
import { makeLogCommand } from "./commands/log-cmd.js";

const program = new Command();

program
  .name("kb")
  .description("LLM-maintained wiki for project knowledge management")
  .version("0.1.0");

program.addCommand(makeInitCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeIndexCommand());
program.addCommand(makeSearchCommand());
program.addCommand(makeIngestCommand());
program.addCommand(makeQueryCommand());
program.addCommand(makeLogCommand());

program.parse(process.argv);
