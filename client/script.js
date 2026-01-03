let currentStudentName = "";
const API_URL = "https://ppsu-backend.onrender.com"; // Your Render URL

function showSection(id) {
    document.querySelectorAll('.form-section').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(id).classList.remove('hidden');
    
    if(id === 'personal') document.querySelector('button[onclick="showSection(\'personal\')"]').classList.add('active');
    if(id === 'documents') document.querySelector('button[onclick="showSection(\'documents\')"]').classList.add('active');
    if(id === 'payment') document.querySelector('button[onclick="showSection(\'payment\')"]').classList.add('active');
}

// 1. REGISTER
document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const studentData = {
        fullName: document.getElementById('fullName').value,
        aadhaar: document.getElementById('aadhaar').value,
        dob: document.getElementById('dob').value,
        course: document.getElementById('course').value,
        mobile: document.getElementById('mobile').value,
        referral: document.getElementById('referral').value,
        applicationId: "PPSU" + Math.floor(1000 + Math.random() * 9000),
        
        email: document.getElementById('email').value,
        address: document.getElementById('address').value,
        city: document.getElementById('city').value,
        state: document.getElementById('state').value,
        pincode: document.getElementById('pincode').value
    };

    currentStudentName = studentData.fullName; 

    try {
        const res = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(studentData)
        });
        
        if (res.ok) {
            alert("Registration Successful! Proceed to Documents.");
            document.getElementById('docBtn').disabled = false;
            document.getElementById('payBtn').disabled = false;
            showSection('documents');
        } else {
            alert("Registration Failed. Try again.");
        }
    } catch (err) {
        alert("Server Error. Check internet connection.");
        console.error(err);
    }
});

// 2. PREVIEW
function handleFileSelect(inputId, previewId) {
    const fileInput = document.getElementById(inputId);
    const previewImg = document.getElementById(previewId);
    
    if (fileInput.files && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewImg.src = e.target.result;
            previewImg.style.display = "block"; 
        }
        reader.readAsDataURL(fileInput.files[0]);
    }
}

// 3. UPLOAD
async function uploadDoc(inputId, docType) {
    if (!currentStudentName) return alert("Please register first!");
    
    const fileInput = document.getElementById(inputId);
    if (!fileInput.files[0]) return alert("Please select a file first.");

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("studentName", currentStudentName);
    formData.append("docType", docType);

    const btn = document.querySelector(`button[onclick="uploadDoc('${inputId}', '${docType}')"]`);
    const originalText = btn.textContent;
    btn.textContent = "Uploading...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/api/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (res.ok) {
            alert(`${docType} Uploaded Successfully!`);
            btn.textContent = "Done ✓";
            btn.style.backgroundColor = "#28a745"; 
        } else {
            alert("Upload Failed.");
            btn.textContent = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert("Upload Error.");
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function finish() {
    alert("Application Submitted Successfully!");
    location.reload();
}