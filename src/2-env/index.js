import * as lib from "./lib.js";

// process.env.USER = "Pete";
console.log(process.env.USER);

console.log(lib.empresa);

console.log(global.user);

console.log(`node: ${process.argv[0]}`);
const program = process.argv[1];
console.log(`program: ${program}`);

process.argv.forEach((item, index) => {
  console.log(`Pos: ${index} Value: ${item}`);
});

console.log(`Hello ${process.argv[2]}`);
console.log(`Hello ${process.argv[3]}`);
console.log(`Hello ${process.argv[2]} ${process.argv[3]}`);

const args = process.argv.slice(2);
const cliente = {
  nombre: args[0],
  saldo: args[1],
};
global.cliente = cliente;
console.log(`Hola ${args[0]}`);
console.log(`Hola ${args[1]}`);
console.log(`Hola ${JSON.stringify(global.cliente)}`);
