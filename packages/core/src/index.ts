// Core package — business logic

export const VERSION = "0.1.0";

export { initProject } from "./init.js";
export type { InitOptions } from "./init.js";

export { parseConfig } from "./config.js";
export type { KbConfig } from "./config.js";

export { loadProject, tryLoadProject } from "./project.js";
export type { Project } from "./project.js";
