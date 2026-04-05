#!/usr/bin/env node
import { Command } from "commander";
import { makeInitCommand } from "./commands/init.js";
import { makeStatusCommand } from "./commands/status.js";
import { makeIndexCommand } from "./commands/index-cmd.js";

const program = new Command();

program
  .name("kb")
  .description("LLM-maintained wiki for project knowledge management")
  .version("0.1.0");

program.addCommand(makeInitCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeIndexCommand());

program.parse(process.argv);
