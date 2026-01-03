require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ Connection Error:", err));

// Define Student Schema
const StudentSchema = new mongoose.Schema({
    fullName: String,
    aadhaar: String,
    dob: String,
    course: String,
    mobile: String,
    referral: String,
    applicationId: String,
    date: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', StudentSchema);

// API Routes
app.get('/', (req, res) => res.send('PPSU Backend is Live!'));

app.post('/api/register', async (req, res) => {
    try {
        const newStudent = new Student(req.body);
        await newStudent.save();
        res.status(201).json({ message: "Registration Successful", id: newStudent.applicationId });
    } catch (error) {
        res.status(500).json({ error: "Failed to register" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));