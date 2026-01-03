require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const stream = require('stream');
const path = require('path');
const fs = require('fs');

const app = express();

// --- 1. CONFIGURATION ---
const SPREADSHEET_ID = '1pNw6pceOz22fbhPMSpomV99y41CgXEBafJ9foe24SC4'; 

cloudinary.config({ 
  cloud_name: 'dvks6hfcb', 
  api_key: '695563669199692', 
  api_secret: 'IbMOW49KnpLoVWCepnaiQ77UUws' 
});

app.use(cors());
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } 
});

// --- 2. DATABASE CONNECTION (Safe Mode) ---
if (!process.env.MONGO_URI) {
    console.error("CRITICAL ERROR: MONGO_URI is missing in Environment Variables!");
} else {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("MongoDB Connected Successfully"))
        .catch(err => console.error("MongoDB Connection Error:", err));
}

const StudentSchema = new mongoose.Schema({
    fullName: String, aadhaar: String, dob: String, course: String,
    mobile: String, referral: String, applicationId: String, date: String,
    regFeeStatus: String, appFeeStatus: String,
    email: String, address: String, city: String, state: String, pincode: String,
    hostelRoom: String, messFeeStatus: String, profilePhotoUrl: String
});
const Student = mongoose.model('Student', StudentSchema);

// --- 3. GOOGLE SHEETS AUTH (Safe Mode) ---
let auth = null;
try {
    const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
    if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
        console.log("Google Auth Loaded from Environment");
    } else {
        let KEY_PATH = path.join(__dirname, 'credentials.json');
        if (fs.existsSync(KEY_PATH)) {
            auth = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: SCOPES });
            console.log("Google Auth Loaded from File");
        } else {
            console.warn("WARNING: No Google Credentials found. Sheet updates will be skipped.");
        }
    }
} catch (e) {
    console.error("Google Auth Error (Non-fatal):", e.message);
}

app.get('/', (req, res) => res.send('PPSU ERP Backend is Running!'));

// --- ROUTE 1: REGISTER (Crash-Proof) ---
app.post('/api/register', async (req, res) => {
    try {
        // 1. Check DB Connection
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ error: "Database not connected. Check Server Logs." });
        }

        const existing = await Student.findOne({ mobile: req.body.mobile });
        if (existing) return res.status(400).json({ error: "Mobile number already registered." });

        const newStudent = new Student({ 
            ...req.body, regFeeStatus: "Pending", appFeeStatus: "Pending",
            hostelRoom: "Not Booked", messFeeStatus: "Pending"
        });
        await newStudent.save();

        // 2. Try Sheets (Skip if fails)
        if (auth) {
            try {
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
            } catch (sheetErr) {
                console.error("Sheet Update Failed (Ignoring):", sheetErr.message);
            }
        }

        res.status(201).json({ message: "Registered", id: newStudent.applicationId });
    } catch (error) {
        console.error("Registration Critical Error:", error);
        res.status(500).json({ error: "Server Error: " + error.message });
    }
});

// --- ROUTE 2: LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const { mobile, dob } = req.body;
        const student = await Student.findOne({ mobile, dob });
        if (!student) return res.status(401).json({ error: "Invalid Credentials" });
        if (student.regFeeStatus !== "Paid") return res.status(403).json({ error: "Admission Fee (₹12,500) Pending." });
        res.status(200).json({ message: "Success", student });
    } catch (error) {
        res.status(500).json({ error: "Login Error" });
    }
});

// --- ROUTE 3: UPDATE ---
app.post('/api/update-application', async (req, res) => {
    try {
        const { applicationId, ...updates } = req.body;
        const updatedStudent = await Student.findOneAndUpdate({ applicationId }, { $set: updates }, { new: true });
        if (!updatedStudent) return res.status(404).json({ error: "Student Not Found" });

        // Update Sheet (Best Effort)
        if (auth) {
            try {
                const sheets = google.sheets({ version: 'v4', auth });
                const idList = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Sheet1!G:G' });
                const rows = idList.data.values;
                let rowIndex = -1;
                if (rows && rows.length > 0) rowIndex = rows.findIndex(row => row[0] === applicationId);

                if (rowIndex !== -1) {
                    const sheetRow = rowIndex + 1;
                    if (updates.regFeeStatus) {
                        await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `Sheet1!I${sheetRow}`, valueInputOption: 'USER_ENTERED', resource: { values: [[updates.regFeeStatus]] } });
                    }
                    if (updates.email || updates.appFeeStatus) {
                        const rowValues = [ updatedStudent.appFeeStatus, updatedStudent.email, updatedStudent.address, updatedStudent.city, updatedStudent.state, updatedStudent.pincode ];
                        await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `Sheet1!J${sheetRow}:O${sheetRow}`, valueInputOption: 'USER_ENTERED', resource: { values: [rowValues] } });
                    }
                }
            } catch (e) { console.error("Sheet Sync Error:", e.message); }
        }
        res.status(200).json({ message: "Updated", student: updatedStudent });
    } catch (error) { res.status(500).json({ error: "Update Failed" }); }
});

// --- ROUTE 4: UPLOAD ---
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");
    
    const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "PPSU_Documents", resource_type: "auto" },
        async (error, result) => {
            if (error) return res.status(500).send("Cloudinary Error");
            
            if(req.body.docType === 'Passport Photo') {
                await Student.findOneAndUpdate({ fullName: req.body.studentName }, { $set: { profilePhotoUrl: result.secure_url } });
            }
            res.status(200).json({ fileId: result.public_id, link: result.secure_url });
        }
    );
    stream.Readable.from(req.file.buffer).pipe(uploadStream);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));