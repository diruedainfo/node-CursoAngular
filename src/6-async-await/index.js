import * as fs from "fs/promises";

readFile();

async function readFile() {
  const scriptFile = process.argv[1];
  try {
    const fileContent = await fs.readFile(scriptFile);
    console.log(fileContent.toString());
  } catch (err) {
    console.log(`💣: ${err}`);
  }
}
