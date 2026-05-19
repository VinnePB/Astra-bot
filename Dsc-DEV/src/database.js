const { Pool } = require('pg');
require('dotenv').config();

// O Pool conecta automaticamente usando a variável DATABASE_URL fornecida pela Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.connect()
    .then(client => {
        console.log('✅ [PostgreSQL] Conexão com o banco de dados estabelecida com sucesso!');
        client.release();
    })
    .catch(err => {
        console.error('❌ [PostgreSQL] Erro crítico ao conectar no banco de dados:', err);
    });

module.exports = pool;