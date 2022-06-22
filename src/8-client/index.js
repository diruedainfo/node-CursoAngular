import * as fs from "fs";
import * as https from "https";
// import * as http from "http";

// https.get("https://www.google.com", (res) => {
//   let body = "";
//   res.on("data", (data) => {
//     body += data;
//   });
//   res.on("end", () => {
//     console.log(body);
//   });
// });

// http.get("http://localhost:3000/agencies", processStream);

// function processStream(responseStream) {
//   let body = "";
//   responseStream.on("data", (chunk) => {
//     body += chunk;
//   });
//   responseStream.on("end", () => {
//     const agencies = JSON.parse(body);
//     console.log(agencies[1]);
//   });
// }

// https.get("https://www.google.com", (res) => {
//   let body = "";
//   res.on("data", (data) => {
//     body += data;
//   });
//   res.on("end", () => {
//     fs.writeFile("www.google.com.html", body);
//   });
// });

// https.get("https://www.google.com", (res) => {
//   let writeStream = fs.createWriteStream("www.google.com.html");
//   res.on("data", (data) => {
//     writeStream.write(data);
//   });
//   res.on("end", () => {
//     writeStream.close();
//   });
// });

https.get("https://www.google.com", writePipe);

function writePipe(responseStream) {
  let writeStream = fs.createWriteStream("www.google.com.html");
  responseStream.pipe(writeStream);
}
