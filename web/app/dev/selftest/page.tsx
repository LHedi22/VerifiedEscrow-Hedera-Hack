import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import SelfTest, { type Fixture } from "./SelfTest";

// T1.3 browser leg: the server only ships the raw fixture files; all hashing happens in the browser.
export const dynamic = "force-dynamic";

const DIR = join(process.cwd(), "..", "packages", "canonical", "fixtures");

export default function Page() {
  const fixtures: Fixture[] = readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const name = f.slice(0, -".json".length);
      return {
        name,
        json: readFileSync(join(DIR, f), "utf8"),
        expected: readFileSync(join(DIR, `${name}.sha256`), "utf8").trim(),
      };
    });
  return <SelfTest fixtures={fixtures} />;
}
