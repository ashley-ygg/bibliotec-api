const express = require('express');
const pool = require('../db');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const error = (res, code, message, errors) =>
  res.status(code).json(errors ? { status: 'error', message, errors } : { status: 'error', message });

const SELECT = `
  SELECT l.id_libro, l.titulo, l.isbn, l.anio_publicacion, l.ejemplares_disponibles,
         l.id_categoria, c.nombre_categoria AS categoria,
         GROUP_CONCAT(DISTINCT a.nombre_autor ORDER BY a.nombre_autor SEPARATOR '|') AS autores
  FROM libro l
  JOIN categoria c ON c.id_categoria = l.id_categoria
  LEFT JOIN libro_autor la ON la.id_libro = l.id_libro
  LEFT JOIN autor a ON a.id_autor = la.id_autor`;
const GROUP = 'GROUP BY l.id_libro, c.nombre_categoria';

function formatear(r) {
  return {
    id_libro: r.id_libro,
    titulo: r.titulo,
    isbn: r.isbn,
    anio_publicacion: r.anio_publicacion,
    ejemplares_disponibles: r.ejemplares_disponibles,
    id_categoria: r.id_categoria,
    categoria: r.categoria,
    autores: r.autores ? r.autores.split('|') : [],
  };
}

async function obtener(id) {
  const [rows] = await pool.query(`${SELECT} WHERE l.id_libro = ? ${GROUP}`, [id]);
  return rows.length ? formatear(rows[0]) : null;
}

function parseId(req, res) {
  if (!/^\d+$/.test(req.params.id)) {
    error(res, 400, 'El id debe ser un entero positivo');
    return null;
  }
  return parseInt(req.params.id, 10);
}

function toInt(v) {
  if (Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

async function conTransaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function vincularAutores(conn, idLibro, ids) {
  await conn.query('DELETE FROM libro_autor WHERE id_libro = ?', [idLibro]);
  if (ids.length) {
    await conn.query('INSERT INTO libro_autor (id_libro, id_autor) VALUES ?', [ids.map((a) => [idLibro, a])]);
  }
}

async function validar(body, idActual) {
  const errores = [];
  const d = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const titulo = typeof d.titulo === 'string' ? d.titulo.trim() : '';
  if (!titulo || titulo.length > 150) {
    errores.push('titulo es obligatorio y debe tener máximo 150 caracteres');
  }

  const isbn = typeof d.isbn === 'string' ? d.isbn.trim() : '';
  if (!/^[0-9-]{10,17}$/.test(isbn)) {
    errores.push('isbn es obligatorio (texto de 10 a 17 caracteres: dígitos y guiones)');
  } else {
    const [r] = await pool.query('SELECT id_libro FROM libro WHERE isbn = ? AND id_libro <> ?', [isbn, idActual || 0]);
    if (r.length) errores.push('ya existe un libro con ese isbn');
  }

  const maxAnio = new Date().getFullYear() + 1;
  const anio = toInt(d.anio_publicacion);
  if (anio === null || anio < 1000 || anio > maxAnio) {
    errores.push(`anio_publicacion debe ser un entero entre 1000 y ${maxAnio}`);
  }

  const ejemplares = toInt(d.ejemplares_disponibles);
  if (ejemplares === null || ejemplares < 0 || ejemplares > 100000) {
    errores.push('ejemplares_disponibles debe ser un entero mayor o igual a 0');
  }

  const categoria = toInt(d.id_categoria);
  if (categoria === null || categoria < 1) {
    errores.push('id_categoria es obligatorio (entero positivo)');
  } else {
    const [r] = await pool.query('SELECT 1 FROM categoria WHERE id_categoria = ?', [categoria]);
    if (!r.length) errores.push('la categoría indicada no existe');
  }

  // autores es opcional: arreglo de ids de autor
  let autores = null;
  if (Object.prototype.hasOwnProperty.call(d, 'autores')) {
    const ids = Array.isArray(d.autores) ? d.autores.map(toInt) : null;
    if (!ids || ids.some((n) => n === null || n < 1)) {
      errores.push('autores debe ser un arreglo de ids de autor (enteros positivos)');
    } else {
      autores = [...new Set(ids)];
      if (autores.length) {
        const [r] = await pool.query('SELECT COUNT(*) AS n FROM autor WHERE id_autor IN (?)', [autores]);
        if (Number(r[0].n) !== autores.length) errores.push('uno o más ids de autor no existen');
      }
    }
  }

  return { errores, datos: { titulo, isbn, anio, ejemplares, categoria, autores } };
}

// GET /api/v1/libros
router.get(
  '/',
  wrap(async (req, res) => {
    const [rows] = await pool.query(`${SELECT} ${GROUP} ORDER BY l.id_libro`);
    const data = rows.map(formatear);
    res.status(200).json({ status: 'success', total: data.length, data });
  })
);

// GET /api/v1/libros/:id
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const libro = await obtener(id);
    if (!libro) return error(res, 404, `No existe un libro con id ${id}`);
    res.status(200).json({ status: 'success', data: libro });
  })
);

// POST /api/v1/libros
router.post(
  '/',
  wrap(async (req, res) => {
    const { errores, datos } = await validar(req.body, 0);
    if (errores.length) return error(res, 400, 'Datos inválidos', errores);

    const nuevoId = await conTransaccion(async (conn) => {
      const [r] = await conn.query(
        'INSERT INTO libro (titulo, isbn, anio_publicacion, ejemplares_disponibles, id_categoria) VALUES (?, ?, ?, ?, ?)',
        [datos.titulo, datos.isbn, datos.anio, datos.ejemplares, datos.categoria]
      );
      if (datos.autores && datos.autores.length) {
        await vincularAutores(conn, r.insertId, datos.autores);
      }
      return r.insertId;
    });

    res.location(`/api/v1/libros/${nuevoId}`);
    res.status(201).json({ status: 'success', message: 'Registro creado exitosamente', id: nuevoId });
  })
);

// PUT /api/v1/libros/:id
router.put(
  '/:id',
  wrap(async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    if (!(await obtener(id))) return error(res, 404, `No existe un libro con id ${id}`);

    const { errores, datos } = await validar(req.body, id);
    if (errores.length) return error(res, 400, 'Datos inválidos', errores);

    await conTransaccion(async (conn) => {
      await conn.query(
        'UPDATE libro SET titulo = ?, isbn = ?, anio_publicacion = ?, ejemplares_disponibles = ?, id_categoria = ? WHERE id_libro = ?',
        [datos.titulo, datos.isbn, datos.anio, datos.ejemplares, datos.categoria, id]
      );
      if (datos.autores !== null) {
        await vincularAutores(conn, id, datos.autores);
      }
    });

    res.status(200).json({ status: 'success', message: 'Registro actualizado correctamente' });
  })
);

// DELETE /api/v1/libros/:id
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    if (!(await obtener(id))) return error(res, 404, `No existe un libro con id ${id}`);

    try {
      await pool.query('DELETE FROM libro WHERE id_libro = ?', [id]);
    } catch (e) {
      if (e.code === 'ER_ROW_IS_REFERENCED_2') {
        return error(res, 409, 'No se puede eliminar: el libro tiene préstamos asociados');
      }
      throw e;
    }
    res.status(200).json({ status: 'success', message: 'Registro eliminado correctamente' });
  })
);

module.exports = router;
