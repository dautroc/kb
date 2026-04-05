import { type KbConfig } from "./config.js";
export interface Project {
    name: string;
    root: string;
    kbDir: string;
    sourcesDir: string;
    wikiDir: string;
    config: KbConfig;
}
export declare function loadProject(startDir: string): Promise<Project>;
export declare function tryLoadProject(startDir: string): Promise<Project | null>;
//# sourceMappingURL=project.d.ts.map