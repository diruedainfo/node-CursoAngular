process.stdout.write("Hola mundo\n");

// const escrito = process.stdin.read();
// process.stdout.write(`Hola ${escrito}`);

process.stdin.on("readable", () => {
  const escrito = process.stdin.read();
  process.stdout.write(`Hola ${escrito}`);
});
