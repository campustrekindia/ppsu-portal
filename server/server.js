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
// REPLACE THIS WITH YOUR GOOGLE SHEET ID
const SPREADSHEET_ID = '1pNw6pceOz22fbhPMSpomV99y41CgXEBafJ9foe24SC4'; 
// REPLACE THIS WITH YOUR FOLDER ID (From the URL of the folder you shared)
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

// Database Schema
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
    // Fee Statuses
    regFeeStatus: String, // ₹12,500
    appFeeStatus: String, // ₹1,200
    // Step 2: Application Details
    email: String, 
    address: String, 
    city: String, 
    state: String, 
    pincode: String
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

app.get('/', (req, res) => res.send('PPSU Backend Live!'));

// --- ROUTE 1: REGISTER (Basic Info + Reg Fee Pending) ---
app.post('/api/register', async (req, res) => {
    try {
        const newStudent = new Student({ 
            ...req.body, 
            regFeeStatus: "Pending", // Admission Fee
            appFeeStatus: "Pending"  // Application Fee
        });
        await newStudent.save();

        const sheets = google.sheets({ version: 'v4', auth });
        
        // Append to Sheet (Columns A-O)
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:O', 
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
                    "Pending", // I: Reg Fee Status
                    "Pending", // J: App Fee Status
                    "", "", "", "", "" // K-O: Address Fields (Empty)
                ]]
            }
        });

        res.status(201).json({ message: "Registration Successful", id: newStudent.applicationId });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// --- ROUTE 2: UPDATE APPLICATION (Address Info + App Fee Status) ---
app.post('/api/update-application', async (req, res) => {
    try {
        const { applicationId, email, address, city, state, pincode, appFeeStatus, regFeeStatus } = req.body;

        // Construct update object dynamically
        const updateFields = {};
        if (email) updateFields.email = email;
        if (address) updateFields.address = address;
        if (city) updateFields.city = city;
        if (state) updateFields.state = state;
        if (pincode) updateFields.pincode = pincode;
        if (appFeeStatus) updateFields.appFeeStatus = appFeeStatus;
        if (regFeeStatus) updateFields.regFeeStatus = regFeeStatus;

        const updatedStudent = await Student.findOneAndUpdate(
            { applicationId: applicationId },
            { $set: updateFields },
            { new: true }
        );

        if (!updatedStudent) return res.status(404).json({ error: "Student Not Found" });

        // Update Google Sheet
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Find Row by App ID (Column G)
        const idList = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!G:G', 
        });

        const rows = idList.data.values;
        let rowIndex = -1;

        if (rows && rows.length > 0) {
            rowIndex = rows.findIndex(row => row[0] === applicationId);
        }

        if (rowIndex !== -1) {
            const sheetRow = rowIndex + 1;
            
            // If updating Reg Fee (Column I)
            if (regFeeStatus) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `Sheet1!I${sheetRow}`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [[regFeeStatus]] }
                });
            }

            // If updating Application Data (Columns J-O)
            if (email || appFeeStatus) {
                const rowValues = [
                    updatedStudent.appFeeStatus,
                    updatedStudent.email, 
                    updatedStudent.address, 
                    updatedStudent.city, 
                    updatedStudent.state, 
                    updatedStudent.pincode
                ];
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `Sheet1!J${sheetRow}:O${sheetRow}`, 
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [rowValues] }
                });
            }
        }

        res.status(200).json({ message: "Details Updated Successfully" });

    } catch (error) {
        console.error("Update Error:", error);
        res.status(500).json({ error: "Update Failed" });
    }
});

// --- ROUTE 3: UPLOAD (To Shared Drive Folder) ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");
        
        const safeName = req.body.studentName ? req.body.studentName.replace(/[^a-zA-Z0-9]/g, '_') : "Student";
        const safeDoc = req.body.docType ? req.body.docType.replace(/[^a-zA-Z0-9]/g, '_') : "Doc";

        const drive = google.drive({ version: 'v3', auth });
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const fileName = `${safeName}_${safeDoc}_${Date.now()}.jpg`;

        const fileMetadata = {
            name: fileName,
            parents: [DRIVE_FOLDER_ID] // CRITICAL: This puts it in YOUR shared folder
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
        res.status(500).send("Upload Failed: " + error.message);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));