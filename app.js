const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Rozwiązuje problemy z DNS u niektórych dostawców internetu

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// --- KONFIGURACJA ---
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'TWOJ_TAJNY_KLUCZ'; // Używaj tego samego klucza wszędzie!
const DB_URL = process.env.DB_URL || "mongodb+srv://szymow94_db_user:ueQ7SqlbmpThSJkU@cluster0.mofq7og.mongodb.net/?appName=Cluster0";

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.static('public')); // Serwowanie plików statycznych

// --- POŁĄCZENIE Z BAZĄ DANYCH (Tylko jedno!) ---
mongoose.connect(DB_URL, {
    serverSelectionTimeoutMS: 5000 
})
.then(() => console.log("✅ Sukces! Połączono pomyślnie z MongoDB Atlas"))
.catch(err => {
    console.error("❌ Błąd połączenia z bazą!");
    if (err.message.includes('ECONNREFUSED')) {
        console.log("👉 Twoja sieć blokuje połączenie. Spróbuj użyć Hotspotu z telefonu.");
    }
    console.error("Szczegóły:", err.message);
});

// --- MODELE BAZY DANYCH ---

// Model Użytkownika
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// Model Zadania
const taskSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
    priority: { type: String, default: 'low' },
    dueDate: { type: Date },
    category: { type: String, default: 'ogólne' }, 
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' }
}, { timestamps: true });
const Task = mongoose.model('Task', taskSchema);

// --- MIDDLEWARE UWIERZYTELNIANIA ---
const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) throw new Error('Brak tokena');

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ _id: decoded._id });

        if (!user) throw new Error();

        req.user = user; // Przekazujemy zalogowanego użytkownika dalej
        next();
    } catch (e) {
        res.status(401).json({ message: 'Zaloguj się ponownie' });
    }
};

// --- ENDPOINTY AUTORYZACJI ---

// Rejestracja
app.post('/auth/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = new User({ username: req.body.username, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: "Użytkownik stworzony" });
    } catch (e) {
        res.status(400).json({ error: "Nazwa użytkownika zajęta lub błąd danych" });
    }
});

// Logowanie
app.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: 'Błędny użytkownik lub hasło' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Błędny użytkownik lub hasło' });
        }

        const token = jwt.sign({ _id: user._id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ token, username: user.username });
    } catch (err) {
        res.status(500).json({ message: 'Błąd serwera', error: err.message });
    }
});

// --- ENDPOINTY ZADAŃ (CRUD) ---

// Pobierz zadania zalogowanego użytkownika (posortowane)
app.get('/tasks', auth, async (req, res) => {
    try {
        let tasks = await Task.find({ owner: req.user._id });

        const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };

        tasks.sort((a, b) => {
            if (a.completed !== b.completed) {
                return a.completed - b.completed; // Nieukończone przed ukończonymi
            }

            const weightA = priorityOrder[a.priority] || 3;
            const weightB = priorityOrder[b.priority] || 3;
            if (weightA !== weightB) {
                return weightA - weightB; // Priorytet
            }

            if (a.dueDate && b.dueDate) {
                return new Date(a.dueDate) - new Date(b.dueDate); // Daty
            }
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;

            return 0;
        });

        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: "Błąd pobierania zadań" });
    }
});

// Dodaj zadanie
app.post('/tasks', auth, async (req, res) => {
    try {
        const { title, priority, category, dueDate } = req.body;

        if (!title) {
            return res.status(400).send({ error: "Tytuł zadania jest wymagany!" });
        }

        const task = new Task({
            title,
            priority: priority || 'low',
            category: category || 'ogólne',
            dueDate: dueDate === "" ? null : dueDate,
            owner: req.user._id // Przypisanie do zalogowanego usera
        });

        await task.save();
        res.status(201).send(task);
    } catch (e) {
        res.status(400).send({ message: e.message });
    }
});

// Edytuj zadanie
app.patch('/tasks/:id', auth, async (req, res) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, owner: req.user._id });

        if (!task) {
            return res.status(404).send({ error: "Nie znaleziono zadania." });
        }

        const { title, priority, category, dueDate, completed } = req.body;

        if (title !== undefined) task.title = title;
        if (priority !== undefined) task.priority = priority;
        if (category !== undefined) task.category = category;
        if (completed !== undefined) task.completed = completed;

        if (dueDate === "" || dueDate === null) {
            task.dueDate = null;
        } else if (dueDate !== undefined) {
            task.dueDate = dueDate;
        }

        await task.save();
        res.send(task);
    } catch (e) {
        res.status(400).send({ message: e.message });
    }
});

// Przełącz status ukończenia (toggle)
app.patch('/tasks/:id/toggle', auth, async (req, res) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, owner: req.user._id });

        if (!task) {
            return res.status(404).json({ error: "Nie znaleziono zadania" });
        }

        task.completed = !task.completed;
        await task.save();

        res.json(task);
    } catch (e) {
        res.status(500).json({ error: "Błąd serwera podczas aktualizacji" });
    }
});

// Usuń zadanie (✅ NAPRAWIONE: Tylko właściciel może usunąć)
app.delete('/tasks/:id', auth, async (req, res) => {
    try {
        const task = await Task.findOneAndDelete({ _id: req.params.id, owner: req.user._id });

        if (!task) {
            return res.status(404).json({ error: "Nie znaleziono zadania do usunięcia lub brak uprawnień" });
        }

        res.json({ message: "Zadanie usunięte pomyślnie" });
    } catch (err) {
        res.status(400).json({ error: "Błąd podczas usuwania" });
    }
});

// --- URUCHOMIENIE SERWERA ---
app.listen(PORT, () => {
    console.log(`🚀 Serwer działa na porcie ${PORT}`);
});