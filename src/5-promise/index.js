import * as fs from "fs/promises";

const scriptFile = process.argv[1];
fs.readFile(scriptFile)
  .then((fileContent) => {
    console.log(fileContent.toString());
  })
  .catch((err) => {
    console.log(`💣: ${err}`);
  })
  .finally(() => {
    console.log("Terminado");
  });
