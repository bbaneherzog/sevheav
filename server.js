import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  PORT = 8000,
  MONGO_URI = 'mongodb://127.0.0.1:27017/appdb',
  SESSION_SECRET = 'dev-secret-change-me',
  TMDB_API_KEY,
} = process.env;

const SEED_USERS = ['brooke', 'ali', 'gabby', 'squiddy', 'kannie', 'chrissy', 'greggy'];
const TYPES = ['show', 'movie', 'book'];

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true },
  passwordHash: { type: String, required: true },
}));

const commentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
});

const Item = mongoose.model('Item', new mongoose.Schema({
  type: { type: String, enum: TYPES, required: true },
  title: { type: String, required: true, trim: true },
  author: { type: String, trim: true },
  notes: { type: String, trim: true },
  coverUrl: String,
  externalId: String,
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lovers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  watched: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [commentSchema],
  createdAt: { type: Date, default: Date.now },
}));

function populateItem(query) {
  return query
    .populate('addedBy', 'username displayName')
    .populate('lovers', 'username displayName')
    .populate('watched', 'username displayName')
    .populate('comments.user', 'username displayName');
}

await mongoose.connect(MONGO_URI);

for (const username of SEED_USERS) {
  const exists = await User.findOne({ username });
  if (!exists) {
    const passwordHash = await bcrypt.hash(username, 10);
    const displayName = username[0].toUpperCase() + username.slice(1);
    await User.create({ username, displayName, passwordHash });
    console.log(`seeded user: ${username}`);
  }
}

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: 'sessions' }),
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

async function loadUser(req, _res, next) {
  if (req.session.userId) {
    req.user = await User.findById(req.session.userId).lean();
  }
  next();
}
app.use(loadUser);

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.accepts('html') && !req.path.startsWith('/api/')) return res.redirect('/login');
  res.status(401).json({ error: 'unauthenticated' });
}

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null, username: '' });
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').toLowerCase().trim();
  const password = req.body.password || '';
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).render('login', { error: 'Invalid username or password', username });
  }
  req.session.userId = user._id;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, (req, res) => {
  res.render('index', { user: req.user });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.user._id, username: req.user.username, displayName: req.user.displayName });
});

app.get('/api/items', requireAuth, async (_req, res) => {
  const items = await populateItem(Item.find()).lean();
  const groups = { show: [], movie: [], book: [] };
  for (const item of items) {
    if (groups[item.type]) groups[item.type].push(item);
  }
  for (const t of TYPES) {
    groups[t].sort((a, b) =>
      (b.lovers.length - a.lovers.length) ||
      (new Date(b.createdAt) - new Date(a.createdAt))
    );
  }
  res.json(groups);
});

app.post('/api/items', requireAuth, async (req, res) => {
  const { type, title, author, notes, coverUrl, externalId } = req.body;
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'invalid type' });
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const item = await Item.create({
    type,
    title: title.trim(),
    author: author?.trim() || undefined,
    notes: notes?.trim() || undefined,
    coverUrl: coverUrl || undefined,
    externalId: externalId || undefined,
    addedBy: req.user._id,
    lovers: [req.user._id],
    watched: [req.user._id],
  });
  const populated = await populateItem(Item.findById(item._id)).lean();
  res.status(201).json(populated);
});

async function toggleField(req, res, field) {
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const userId = req.user._id;
  const list = item[field];
  const idx = list.findIndex(id => id.equals(userId));
  if (idx === -1) list.push(userId);
  else list.splice(idx, 1);
  await item.save();
  const populated = await populateItem(Item.findById(item._id)).lean();
  res.json(populated);
}

app.post('/api/items/:id/love', requireAuth, (req, res) => toggleField(req, res, 'lovers'));
app.post('/api/items/:id/watched', requireAuth, (req, res) => toggleField(req, res, 'watched'));

app.post('/api/items/:id/comments', requireAuth, async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'comment cannot be empty' });
  if (text.length > 500) return res.status(400).json({ error: 'comment too long (500 chars max)' });
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.comments.push({ user: req.user._id, text });
  await item.save();
  const populated = await populateItem(Item.findById(item._id)).lean();
  res.status(201).json(populated);
});

app.delete('/api/items/:itemId/comments/:commentId', requireAuth, async (req, res) => {
  const item = await Item.findById(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const comment = item.comments.id(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'comment not found' });
  if (!comment.user.equals(req.user._id)) return res.status(403).json({ error: 'you can only delete your own comments' });
  comment.deleteOne();
  await item.save();
  const populated = await populateItem(Item.findById(item._id)).lean();
  res.json(populated);
});

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (!item.addedBy.equals(req.user._id)) return res.status(403).json({ error: 'only the person who added this can delete it' });
  await item.deleteOne();
  res.json({ deleted: req.params.id });
});

app.get('/api/search', requireAuth, async (req, res) => {
  const { type, q } = req.query;
  if (!q || String(q).trim().length < 2) return res.json({ results: [] });
  try {
    if (type === 'book') {
      const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8`);
      const data = await r.json();
      const results = (data.docs || []).slice(0, 8).map(d => ({
        title: d.title,
        author: (d.author_name || []).slice(0, 3).join(', '),
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
        externalId: d.key,
        year: d.first_publish_year ? String(d.first_publish_year) : '',
      }));
      return res.json({ results });
    }
    if (type === 'movie' || type === 'show') {
      if (!TMDB_API_KEY) return res.json({ results: [], note: 'TMDB_API_KEY not set' });
      const tmdbType = type === 'movie' ? 'movie' : 'tv';
      const r = await fetch(
        `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}`
      );
      const data = await r.json();
      const results = (data.results || []).slice(0, 8).map(d => ({
        title: d.title || d.name,
        coverUrl: d.poster_path ? `https://image.tmdb.org/t/p/w200${d.poster_path}` : null,
        externalId: String(d.id),
        year: (d.release_date || d.first_air_date || '').slice(0, 4),
      }));
      return res.json({ results });
    }
    res.status(400).json({ error: 'invalid type' });
  } catch (e) {
    console.error('search error', e);
    res.json({ results: [], note: 'autocomplete service unavailable — type freely' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(Number(PORT), () => {
  console.log(`listening on :${PORT}`);
});
