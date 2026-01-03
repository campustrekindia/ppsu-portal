require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const stream = require('stream');

const app = express();

// --- CONFIGURATION (UPDATED WITH YOUR LINKS) ---
const SPREADSHEET_ID = '1pNw6pceOz22fbhPMSpomV99y41CgXEBafJ9foe24SC4'; 
const DRIVE_FOLDER_ID = '1v_mY2lECJmtEoBRKCJFWD7qhxC-FO-0l'; 
// -------------------------------------------

// Middleware
app.use(cors());
app.use(express.json());

// Multer for File Uploads (Memory Storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("DB Error:", err));

const StudentSchema = new mongoose.Schema({
    fullName: String, aadhaar: String, dob: String, course: String,
    mobile: String, referral: String, applicationId: String, date: String
});
const Student = mongoose.model('Student', StudentSchema);

// Google Auth Setup
const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json', // Must be in server folder
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});

// ROUTES
app.get('/', (req, res) => res.send('PPSU Google Integrated Backend Live!'));

// 1. Register: Save to MongoDB + Google Sheet
app.post('/api/register', async (req, res) => {
    try {
        // A. Save to MongoDB
        const newStudent = new Student(req.body);
        await newStudent.save();

        // B. Save to Google Sheet
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:H', 
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[
                    req.body.fullName, req.body.aadhaar,
                    req.body.dob, req.body.course,
                    req.body.mobile, req.body.referral,
                    req.body.applicationId, new Date().toLocaleDateString()
                ]]
            }
        });

        res.status(201).json({ message: "Registered & Saved!", id: newStudent.applicationId });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// 2. Upload File: Save to Google Drive
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");
        
        const drive = google.drive({ version: 'v3', auth });
        
        // Convert buffer to stream
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const fileMetadata = {
            name: `${req.body.studentName}_${req.body.docType}_${Date.now()}.jpg`,
            parents: [DRIVE_FOLDER_ID]
        };

        const media = {
            mimeType: req.file.mimetype,
            body: bufferStream
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink'
        });

        res.status(200).json({ fileId: response.data.id, link: response.data.webViewLink });
    } catch (error) {
        console.error("Drive Upload Error:", error);
        res.status(500).send("Upload Failed");
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));