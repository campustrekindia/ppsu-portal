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
// 1. Google Sheet ID
const SPREADSHEET_ID = '1pNw6pceOz22fbhPMSpomV99y41CgXEBafJ9foe24SC4'; 
// 2. Google Drive Folder ID
const DRIVE_FOLDER_ID = '1v_mY2lECJmtEoBRKCJFWD7qhxC-FO-0l'; 
// ---------------------

app.use(cors());
app.use(express.json());

// 1. UPLOAD LIMIT: 10 MB
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } 
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("DB Error:", err));

// Database Schema
const StudentSchema = new mongoose.Schema({
    // Reg Data
    fullName: String, 
    aadhaar: String, 
    dob: String, 
    course: String,
    mobile: String, 
    referral: String, 
    applicationId: String, 
    date: String,
    // Fees
    regFeeStatus: String, // ₹12,500
    appFeeStatus: String, // ₹1,200
    // App Data
    email: String, 
    address: String, 
    city: String, 
    state: String, 
    pincode: String,
    // Hostel & Extras
    hostelRoom: String,     // e.g. "Block A - 101"
    messFeeStatus: String,  // e.g. "Paid" or "Pending"
    profilePhotoUrl: String 
});
const Student = mongoose.model('Student', StudentSchema);

// Auth Setup
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

app.get('/', (req, res) => res.send('PPSU ERP Backend Live!'));

// --- ROUTE 1: REGISTER ---
app.post('/api/register', async (req, res) => {
    try {
        const existing = await Student.findOne({ mobile: req.body.mobile });
        if (existing) return res.status(400).json({ error: "Mobile number already registered." });

        const newStudent = new Student({ 
            ...req.body, 
            regFeeStatus: "Pending", 
            appFeeStatus: "Pending",
            hostelRoom: "Not Booked",
            messFeeStatus: "Pending"
        });
        await newStudent.save();

        // Sheet Update (Columns A-O)
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:O', 
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[
                    req.body.fullName, req.body.aadhaar, req.body.dob, req.body.course, 
                    req.body.mobile, req.body.referral, req.body.applicationId, 
                    new Date().toLocaleDateString(), "Pending", "Pending", "", "", "", "", ""
                ]]
            }
        });

        res.status(201).json({ message: "Registered", id: newStudent.applicationId });
    } catch (error) {
        console.error("Reg Error:", error);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// --- ROUTE 2: LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const { mobile, dob } = req.body;
        const student = await Student.findOne({ mobile: mobile, dob: dob });

        if (!student) return res.status(401).json({ error: "Invalid Credentials" });
        if (student.regFeeStatus !== "Paid") return res.status(403).json({ error: "Admission Fee (₹12,500) Pending. Please Register & Pay." });

        res.status(200).json({ message: "Success", student: student });
    } catch (error) {
        res.status(500).json({ error: "Login Error" });
    }
});

// --- ROUTE 3: UPDATE APPLICATION ---
app.post('/api/update-application', async (req, res) => {
    try {
        const { applicationId, ...updates } = req.body;

        const updatedStudent = await Student.findOneAndUpdate(
            { applicationId: applicationId },
            { $set: updates },
            { new: true }
        );

        if (!updatedStudent) return res.status(404).json({ error: "Student Not Found" });

        // Update Sheet Logic
        const sheets = google.sheets({ version: 'v4', auth });
        const idList = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Sheet1!G:G' });
        const rows = idList.data.values;
        let rowIndex = -1;

        if (rows && rows.length > 0) rowIndex = rows.findIndex(row => row[0] === applicationId);

        if (rowIndex !== -1) {
            const sheetRow = rowIndex + 1;
            
            if (updates.regFeeStatus) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID, range: `Sheet1!I${sheetRow}`, 
                    valueInputOption: 'USER_ENTERED', resource: { values: [[updates.regFeeStatus]] }
                });
            }
            if (updates.email || updates.appFeeStatus) {
                const rowValues = [
                    updatedStudent.appFeeStatus, updatedStudent.email, updatedStudent.address, 
                    updatedStudent.city, updatedStudent.state, updatedStudent.pincode
                ];
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID, range: `Sheet1!J${sheetRow}:O${sheetRow}`, 
                    valueInputOption: 'USER_ENTERED', resource: { values: [rowValues] }
                });
            }
        }
        res.status(200).json({ message: "Updated", student: updatedStudent });
    } catch (error) {
        res.status(500).json({ error: "Update Failed" });
    }
});

// --- ROUTE 4: UPLOAD ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file.");
        
        const safeName = req.body.studentName ? req.body.studentName.replace(/[^a-zA-Z0-9]/g, '_') : "Student";
        const safeDoc = req.body.docType ? req.body.docType.replace(/[^a-zA-Z0-9]/g, '_') : "Doc";

        const drive = google.drive({ version: 'v3', auth });
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const response = await drive.files.create({
            resource: { name: `${safeName}_${safeDoc}_${Date.now()}.jpg`, parents: [DRIVE_FOLDER_ID] },
            media: { mimeType: req.file.mimetype, body: bufferStream },
            fields: 'id, webViewLink'
        });

        if(req.body.docType === 'Passport Photo') {
             await Student.findOneAndUpdate(
                { fullName: req.body.studentName },
                { $set: { profilePhotoUrl: response.data.webViewLink } }
            );
        }

        res.status(200).json({ fileId: response.data.id, link: response.data.webViewLink });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).send("Upload Failed: " + error.message);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));