const fourSeconds = 4000;

console.log("Before with inner function");
setTimeout(() => {
  console.log("Hello after 4 seconds");
}, fourSeconds);

console.log("Before with declared function");
function printHello() {
  console.log("Hello");
}
setTimeout(printHello, fourSeconds);

console.log("Before with arrow function");
const printHelloName = (name) => console.log(`Hello ${name}`);
setTimeout(printHelloName, fourSeconds, "IGM labs");

console.log("Before with async iterator");
let counter = 0;
const maxCounter = 2;
const intervalId = setInterval(() => {
  console.log(`Hello ${counter}`);
  counter++;
  if (counter === maxCounter) {
    clearInterval(intervalId);
  }
}, fourSeconds);

console.log("After all");
