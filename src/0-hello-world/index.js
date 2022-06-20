//import * as saludos from "./lib.js";
import { empresa, getGreetings } from "./lib.js";

// const greetings = saludos.getGreetings(saludos.empresa);

const greetings = getGreetings(empresa);

console.log(greetings);
