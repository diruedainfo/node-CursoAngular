// Programa que imprima Hola y un contador cada 2 segundos.
// Tiene que parar a las 4 veces
//


let cont = 0;

const id = setInterval(() => {
  cont ++;
  console.log("Hello " + cont);
  if (cont === 4) clearInterval(id);
},2000);

// otra forma de hacerlo


let counter = 0;
const maxCounter = 4;
function printCounter() {
  console.log(`Hola ${counter}`);
  counter++;
  if (counter === maxCounter) {
    clearInterval(intervalId);
  }
}
const intervalId = setInterval(printCounter, 2000);