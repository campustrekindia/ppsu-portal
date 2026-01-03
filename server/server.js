require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const stream = require('stream');
const path = require('path');
const fs = require('fs');

const app = express();

// --- CONFIGURATION ---
const SPREADSHEET_ID = '1pNw6pceOz22fbhPMSpomV99y41CgXEBafJ9foe24SC4'; 
const DRIVE_FOLDER_ID = '1v_mY2lECJmtEoBRKCJFWD7qhxC-FO-0l'; 
// ---------------------

app.use(cors());
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("DB Error:", err));

// --- UPDATED DATABASE SCHEMA ---
// We kept all old fields and added the 5 new ones
const StudentSchema = new mongoose.Schema({
    fullName: String, 
    aadhaar: String, 
    dob: String, 
    course: String,
    mobile: String, 
    referral: String, 
    applicationId: String, 
    date: String,
    // NEW FIELDS
    email: String, 
    address: String, 
    city: String, 
    state: String, 
    pincode: String
});
const Student = mongoose.model('Student', StudentSchema);

// --- KEY FILE FINDER ---
let KEY_PATH = 'credentials.json';
if (!fs.existsSync(path.join(__dirname, 'credentials.json'))) {
    if (fs.existsSync(path.join(__dirname, '../credentials.json'))) {
        KEY_PATH = '../credentials.json';
    }
}

const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH, 
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});

app.get('/', (req, res) => res.send('PPSU Backend Live!'));

// --- REGISTRATION ROUTE ---
app.post('/api/register', async (req, res) => {
    try {
        const newStudent = new Student(req.body);
        await newStudent.save();

        const sheets = google.sheets({ version: 'v4', auth });
        
        // We append all data including the new fields to Google Sheets
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:M', // Expanded range A to M
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[
                    req.body.fullName, 
                    req.body.aadhaar,
                    req.body.dob, 
                    req.body.course,
                    req.body.mobile, 
                    req.body.referral,
                    req.body.applicationId, 
                    new Date().toLocaleDateString(),
                    // NEW DATA COLUMNS
                    req.body.email, 
                    req.body.address, 
                    req.body.city, 
                    req.body.state, 
                    req.body.pincode
                ]]
            }
        });

        res.status(201).json({ message: "Registered & Saved!", id: newStudent.applicationId });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// --- UPLOAD ROUTE ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");
        
        const drive = google.drive({ version: 'v3', auth });
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