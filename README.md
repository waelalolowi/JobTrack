# JobTrack Extension
Job Track is a Chrome extension designed to automatically detect and track job listings on various websites using AI. It dynamically extracts job details, avoids duplicate entries, and provides backup/restore functionality along with file upload CVs and cover letters, rate Cvs and tailor cover letters for desired job using user CV.

## Features
- **Automatic Job Extraction:** Uses the OpenAI API to extract details from job application pages.
- **Real-Time Updates:** Dynamically checks for changes and avoids duplicate entries.
- **Backup & Restore:** Save job data (with uploaded files) as a ZIP file and restore later.
- **File Upload:** Upload and view CVs and cover letters directly from the extension.
- **Unlimited Storage:** Uses `chrome.storage.local` for storing job data.
- **Tailored Cover Letter Generation:** When you click the "Generate Cover Letter" button, the extension extracts text from the uploaded CV and uses the selected job’s details to generate a cover letter that’s personalized for that job.
**CV Rating & Feedback:** When you click the "Rate My CV" button, the extension extracts text from the uploaded CV and uses the selected job’s details to generate a rating (out of 10) plus actionable feedback on how to improve your CV for that specific job.

## Installation
1.   Clone the repository:
     bash git clone https://github.com/yourusername/job-tracker-extension.git
2.   Open Chrome and navigate to chrome://extensions.
3.   Enable Developer Mode.
4.   Click "Load unpacked" and select the extension folder.
5.   The extension icon will appear in your toolbar. Click it to open the popup and start tracking jobs.
6.   Browser normally and apply for jobs, use the extension to see the list.
   
## Tech Stack
JavaScript (ES6+)
Chrome Extensions API (chrome.storage.local, MutationObserver)
IndexedDB for file storage
OpenAI API (gpt-4o-mini)
JSZip for backup/restore functionality

## Demo
![image](https://github.com/user-attachments/assets/9866f9c0-8c39-47c8-9ccf-6f64accc0b18)
![image](https://github.com/user-attachments/assets/ed27c8b3-8f79-4cef-9ec2-263c789a7014)
![image](https://github.com/user-attachments/assets/e8f63ccf-5c35-421a-bcf7-62964869a91b)
![image](https://github.com/user-attachments/assets/b76b3eb6-e0f8-497f-8d7d-8a6a7f8aedad)
![image](https://github.com/user-attachments/assets/f3face73-cf17-4284-86f5-85a475af7277)
![image](https://github.com/user-attachments/assets/a1ee0c4a-bdf2-484b-9ef5-843dc8378f82)
![image](https://github.com/user-attachments/assets/860cffea-b9ef-4eed-bba7-4a25a230df40)
![image](https://github.com/user-attachments/assets/723264c3-7b6a-4fb6-9960-c80d326e452e)
![image](https://github.com/user-attachments/assets/7376bfef-982b-4727-80b1-f57684dc20b5)









