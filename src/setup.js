import fs from "fs/promises";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

import { logger } from "./logger.js";

const rl = readline.createInterface({ input, output });

logger("success", "Enter your 8 ball pool unique id (Eg: 4722012226)");
const userUniqueID = await rl.question("");
rl.close();

await fs.writeFile("src/username.txt", userUniqueID);

await fs.rm("archive", { recursive: true, force: true });
await fs.mkdir("archive", { recursive: true });
await fs.writeFile(
  "archive/README.md",
  "# Archive\n\nMonthly archived README snapshots are stored here as `MM-YYYY.md` files.\n"
);

const exampleReadme = await fs.readFile("README.example.md", "utf8");
await fs.writeFile("README.md", exampleReadme);

logger("success", "✅ Setup done. Enjoy!");
