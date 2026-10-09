require('dotenv').config();
const express = require('express');
const pool = require('./src/db');
const librosRouter = require('./src/routes/libros');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Recurso principal
app.use('/api/v1/libros', librosRouter);

// Ruta inexistente -> 404 en JSON
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Ruta no encontrada' });
});

// Manejo central de errores -> siempre JSON
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', message: 'El cuerpo de la petición debe ser un JSON válido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ status: 'error', message: 'El cuerpo de la petición es demasiado grande' });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(400).json({ status: 'error', message: 'Registro duplicado (isbn ya existente)' });
  }
  console.error(err);
  return res.status(500).json({ status: 'error', message: 'Error interno del servidor' });
});

const PORT = Number(process.env.PORT || 3001);

pool
  .getConnection()
  .then((conn) => {
    conn.release();
    console.log('✅ Conexión a MySQL establecida');
    // Solo escucha en localhost: Apache publica la API en el puerto 80 mediante proxy
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`✅ BiblioTec API ejecutándose en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ No se pudo conectar a MySQL:', err.message);
    process.exit(1);
  });
