# BiblioTec API RESTful v1

API REST con Node.js + Express + MySQL, publicada en Oracle Cloud Infrastructure
(Apache como proxy inverso en el puerto 80 y PM2 como gestor de procesos).

Base URL: `http://<IP_PUBLICA>/api/v1/libros`

| Método | Ruta | Descripción | Éxito | Error |
|--------|------|-------------|-------|-------|
| GET | /api/v1/libros | Lista todos los libros | 200 | 500 |
| GET | /api/v1/libros/{id} | Obtiene un libro | 200 | 404 |
| POST | /api/v1/libros | Crea un libro | 201 | 400 |
| PUT | /api/v1/libros/{id} | Actualiza un libro | 200 | 400 / 404 |
| DELETE | /api/v1/libros/{id} | Elimina un libro | 200 | 404 (409 si tiene préstamos) |

## Body de POST / PUT
```json
{
  "titulo": "Redes de Computadoras",
  "isbn": "9780132126953",
  "anio_publicacion": 2010,
  "ejemplares_disponibles": 4,
  "id_categoria": 4,
  "autores": [4]
}
```
`autores` es opcional (ids de la tabla `autor`).

## Instalación
```bash
git clone <URL_DEL_REPO> && cd bibliotec-api
cp .env.example .env      # editar credenciales
npm install --omit=dev
pm2 start server.js --name bibliotec-api
```

Pruebas: importar `BiblioTec_API.postman_collection.json` en Postman.
