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

// Memory storage for uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("DB Error:", err));

// --- DATABASE SCHEMA ---
const StudentSchema = new mongoose.Schema({
    // Step 1 Fields (Registration)
    fullName: String, 
    aadhaar: String, 
    dob: String, 
    course: String,
    mobile: String, 
    referral: String, 
    applicationId: String, 
    date: String,
    // Step 2 Fields (My Application)
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

// --- ROUTE 1: REGISTER (Basic Info Only) ---
app.post('/api/register', async (req, res) => {
    try {
        const newStudent = new Student(req.body);
        await newStudent.save();

        // Add to Google Sheet (Basic info is filled, Address cols left empty for now)
        const sheets = google.sheets({ version: 'v4', auth });
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
                    "", "", "", "", "" // Empty placeholders for Address fields
                ]]
            }
        });

        res.status(201).json({ message: "Registration Successful", id: newStudent.applicationId });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// --- ROUTE 2: UPDATE APPLICATION (New Route for Step 2) ---
app.post('/api/update-application', async (req, res) => {
    try {
        const { applicationId, email, address, city, state, pincode } = req.body;

        // Find the student by App ID and update their record
        const updatedStudent = await Student.findOneAndUpdate(
            { applicationId: applicationId },
            { 
                $set: { 
                    email: email, 
                    address: address, 
                    city: city, 
                    state: state, 
                    pincode: pincode 
                } 
            },
            { new: true } // Return the updated document
        );

        if (!updatedStudent) {
            return res.status(404).json({ error: "Student Record Not Found" });
        }

        console.log(`Updated record for ${applicationId}`);
        res.status(200).json({ message: "Details Updated Successfully" });

    } catch (error) {
        console.error("Update Error:", error);
        res.status(500).json({ error: "Update Failed" });
    }
});

// --- ROUTE 3: UPLOAD ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("No file uploaded.");
        
        const drive = google.drive({ version: 'v3', auth });
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const fileName = `${req.body.studentName}_${req.body.docType}_${Date.now()}.jpg`;

        const fileMetadata = {
            name: fileName,
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