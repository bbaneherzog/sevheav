import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';

const { PORT = 80, MONGO_URI = 'mongodb://127.0.0.1:27017/appdb' } = process.env;

const Item = mongoose.model('Item', new mongoose.Schema({
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}));

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ service: 'exedev-app', endpoints: ['/health', '/items'] });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState });
});

app.get('/items', async (_req, res, next) => {
  try { res.json(await Item.find().sort({ createdAt: -1 })); }
  catch (e) { next(e); }
});

app.post('/items', async (req, res, next) => {
  try {
    const { name } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    res.status(201).json(await Item.create({ name }));
  } catch (e) { next(e); }
});

app.get('/items/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'not found' });
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  } catch (e) { next(e); }
});

app.delete('/items/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'not found' });
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: item._id });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

await mongoose.connect(MONGO_URI);
app.listen(Number(PORT), () => {
  console.log(`listening on :${PORT}`);
});
