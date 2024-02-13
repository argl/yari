import caporal from "@caporal/core";
import chalk from "chalk";
import { Change, diffTrimmedLines } from "diff";
import fs from "node:fs";
import path from "node:path";
import * as prettier from "prettier";
import { Options } from "prettier";

const { program } = caporal;

interface CliOptions {
  verbose?: boolean;
}

export async function compareOutputs(
  truthDirectory: string,
  testDirectory: string
) {
  const truthFiles = fs.readdirSync(truthDirectory, {
    recursive: true,
    withFileTypes: true,
  });
  for (const file of truthFiles) {
    if (file.isFile() && file.name.endsWith(".html")) {
      const truthPath = path.join(file.path, file.name);
      const testPath = truthPath.replace(truthDirectory, testDirectory);
      console.log();
      console.log("#################################################");
      console.log(chalk.grey(`${truthPath} <-> ${testPath}`));

      let truth = fs.readFileSync(truthPath, "utf-8");
      let test = fs.readFileSync(testPath, "utf-8");
      const prettierOptions: Options = {
        parser: "html",
        htmlWhitespaceSensitivity: "ignore",
      };
      truth = await prettier.format(truth, prettierOptions);
      test = await prettier.format(test, prettierOptions);
      const diff: Change[] = diffTrimmedLines(truth, test);

      diff.forEach((part) => {
        // green for additions, red for deletions
        if (part.added || part.removed) {
          console.log(
            `        ${part.added ? chalk.green(part.value) : chalk.red(part.value)}`
          );
        }
      });
    }
  }
}

function tryOrExit(f: ({ options, ...args }) => Promise<void>) {
  return async ({ options = {}, ...args }: { options: CliOptions }) => {
    try {
      await f({ options, ...args });
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(error.stack));
      }
      throw error;
    }
  };
}

program
  .bin("yarn m2hcompare")
  .name("m2hcompare")
  .version("0.0.1")
  .disableGlobalOption("--silent")
  .cast(false)
  .argument("[truthFolder]", "the truth folder to compare against")
  .argument("[testFolder]", "the test folder to compare against")
  .action(
    tryOrExit(async ({ args }) => {
      compareOutputs(args.truthFolder, args.testFolder);
    })
  );

program.run();
