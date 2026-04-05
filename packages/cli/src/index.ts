#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("kb")
  .description("LLM-maintained wiki for project knowledge management")
  .version("0.1.0");

program.parse(process.argv);
