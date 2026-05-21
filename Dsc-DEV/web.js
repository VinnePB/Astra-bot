const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('<h1>Astra Dashboard - Em Construção</h1><p>Em breve o painel estará aqui!</p>');
});

app.listen(port, () => {
    console.log(`🌐 [Web Server] Site rodando na porta ${port}`);
});