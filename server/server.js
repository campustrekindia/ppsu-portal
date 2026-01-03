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
// Ensure these IDs are correct for your specific Google Sheet and Drive Folder
const SPREADSHEET_ID = '1pNw6pceOz22fbhPMSpomV99y41CgXEBafJ9foe24SC4'; 
const DRIVE_FOLDER_ID = '1v_mY2lECJmtEoBRKCJFWD7qhxC-FO-0l'; 
// ---------------------

app.use(cors());
app.use(express.json());

// 1. SET UPLOAD LIMIT TO 10 MB
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB Limit
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("DB Error:", err));

// Database Schema (Includes all fields for Step 1 and Step 2)
const StudentSchema = new mongoose.Schema({
    // Step 1: Registration Data
    fullName: String, 
    aadhaar: String, 
    dob: String, 
    course: String,
    mobile: String, 
    referral: String, 
    applicationId: String, 
    date: String,
    // Step 2: Application Details
    email: String, 
    address: String, 
    city: String, 
    state: String, 
    pincode: String
});
const Student = mongoose.model('Student', StudentSchema);

// Auth Setup (Smart Path Finding)
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

// --- ROUTE 1: REGISTER (Step 1 - Basic Info) ---
app.post('/api/register', async (req, res) => {
    try {
        const newStudent = new Student(req.body);
        await newStudent.save();

        const sheets = google.sheets({ version: 'v4', auth });
        
        // Append Basic Data (Columns A-H). Leave Address columns (I-M) empty for now.
        // Order: FullName, Aadhaar, DOB, Course, Mobile, Referral, AppID, Date, Email, Addr, City, State, Pin
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:M', 
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
                    "", "", "", "", "" // Empty placeholders for Step 2
                ]]
            }
        });

        res.status(201).json({ message: "Registration Successful", id: newStudent.applicationId });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// --- ROUTE 2: UPDATE APPLICATION (Step 2 - Address Info) ---
app.post('/api/update-application', async (req, res) => {
    try {
        const { applicationId, email, address, city, state, pincode } = req.body;

        // 1. Update MongoDB
        const updatedStudent = await Student.findOneAndUpdate(
            { applicationId: applicationId },
            { $set: { email, address, city, state, pincode } },
            { new: true }
        );

        if (!updatedStudent) return res.status(404).json({ error: "Student Not Found" });

        // 2. Update Google Sheet
        const sheets = google.sheets({ version: 'v4', auth });
        
        // A. Read Column G (App IDs) to find which row belongs to this student
        const idList = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!G:G', 
        });

        const rows = idList.data.values;
        let rowIndex = -1;

        if (rows && rows.length > 0) {
            // Find the index of the row matching the applicationId
            rowIndex = rows.findIndex(row => row[0] === applicationId);
        }

        if (rowIndex !== -1) {
            // B. Calculate actual Sheet Row Number (Index + 1 because Sheets are 1-based)
            const sheetRow = rowIndex + 1;
            
            // C. Update Columns I to M (Email to Pincode) for that specific row
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `Sheet1!I${sheetRow}:M${sheetRow}`, 
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[email, address, city, state, pincode]]
                }
            });
            console.log(`Updated Sheet Row ${sheetRow} for AppID ${applicationId}`);
        } else {
            console.log(`AppID ${applicationId} not found in Sheet.`);
        }

        res.status(200).json({ message: "Details Updated Successfully" });

    } catch (error) {
        console.error("Update Error:", error);
        res.status(500).json({ error: "Update Failed" });
    }
});

// --- ROUTE 3: UPLOAD (10MB Limit) ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");
        
        // Safeguard names to prevent errors if frontend data is missing
        const safeName = req.body.studentName ? req.body.studentName.replace(/\s+/g, '_') : "UnknownStudent";
        const safeDoc = req.body.docType ? req.body.docType.replace(/\s+/g, '_') : "Document";

        const drive = google.drive({ version: 'v3', auth });
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const fileName = `${safeName}_${safeDoc}_${Date.now()}.jpg`;

        const fileMetadata = { name: fileName, parents: [DRIVE_FOLDER_ID] };
        const media = { mimeType: req.file.mimetype, body: bufferStream };

        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink'
        });

        res.status(200).json({ fileId: response.data.id, link: response.data.webViewLink });

    } catch (error) {
        console.error("Drive Upload Error:", error);
        res.status(500).send("Upload Failed: " + error.message);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));