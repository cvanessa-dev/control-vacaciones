const http = require('http');
const fs = require('fs');
const path = require('path');

const puerto = 8080;

const tipos = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

http.createServer(function (req, res) {
  let ruta = req.url === '/' ? '/index.html' : req.url;
  ruta = decodeURIComponent(ruta.split('?')[0]);
  const archivo = path.join(__dirname, ruta);
  const ext = path.extname(archivo);

  fs.readFile(archivo, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 - No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': tipos[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(puerto, function () {
  console.log('Servidor en http://localhost:' + puerto);
});
