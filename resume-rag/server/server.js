const express = require('express');
const cors = require('cors');
const { search } = require('./retrieve.js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));


app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;
    const results = await search(question);
    res.json({ results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
app.listen(3001, () => console.log('Server running on port 3001'));
