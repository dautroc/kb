import Database from "better-sqlite3";
import type { Project } from "./project.js";
export declare function openDb(project: Project): Database.Database;
export declare function closeDb(db: Database.Database): void;
//# sourceMappingURL=db.d.ts.map