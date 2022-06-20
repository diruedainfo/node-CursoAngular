process.stdout.write("Hola mundo\n");

process.stdin.on("readable", () => {
  const escrito = process.stdin.read();
  process.stdout.write(`Hola ${escrito}`);
});
