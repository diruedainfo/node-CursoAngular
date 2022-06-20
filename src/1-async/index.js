const twoSeconds = 2000;

console.log("Before with inner function");
setTimeout(() => {
  console.log("Hello after 4 seconds");
}, twoSeconds);

console.log("Before with declared function");
function printHello(name) {
  console.log("Hello");
  console.log(`Hello ${name}`);
  console.log("Goodbye");
}
setTimeout(printHello, twoSeconds);

console.log("Before with arrow function expression");
const printHello2 = () => console.log("Hello2");
setTimeout(printHello2, twoSeconds);

console.log("Before with inner arrow function expression");
setTimeout(() => console.log("hello4"), twoSeconds);

console.log("Before with parameters");
setTimeout((name) => console.log("hello " + name), twoSeconds, "IGM");

console.log("Before with more parameters");
const arg1 = 3;
const arg2 = 4;
function sum(a, b) {
  console.log(a + b);
}
setTimeout(sum, twoSeconds, arg1, arg2);

console.log("Before with async iterator");
let counter = 0;
const maxCounter = 4;
const intervalId = setInterval(() => {
  console.log(`Hello ${counter}`);
  counter++;
  if (counter === maxCounter) {
    clearInterval(intervalId);
  }
}, twoSeconds);

console.log("After all the code");
