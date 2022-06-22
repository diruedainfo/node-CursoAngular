import * as http from "http";

const OK = 200;
const NOT_FOUND = 404;
const PORT = 8000;

const server = http.createServer();

server.on("request", (requestStream, responseStream) => {
  responseStream.writeHead(OK, { "Content-Type": "text/plain" });
  responseStream.write("Hola mundo");
  responseStream.write("\n");
  responseStream.write(requestStream.url);
  responseStream.end();
});

server.listen(PORT, () => {
  console.log("server listening");
});
