document.addEventListener("DOMContentLoaded", () => {
  const jobsTabBtn = document.getElementById("jobsTab");
  const assistantTabBtn = document.getElementById("assistantTab");
  const statsTabBtn = document.getElementById("statsTab");
  const jobsDiv = document.getElementById("jobs");
  const assistantDiv = document.getElementById("assistant");
  const statsDiv = document.getElementById("stats");
  let uploadedAssistantCV = null;
  let jobsSearchQuery = "";

  function showTab(tab) {
    [jobsDiv, assistantDiv, statsDiv].forEach(div => div.classList.remove("active"));
    tab.classList.add("active");
  }

  jobsTabBtn.addEventListener("click", () => {
    showTab(jobsDiv);
    jobsTabBtn.classList.add("active");
    assistantTabBtn.classList.remove("active");
    statsTabBtn.classList.remove("active");
    loadJobsTab();
  });

  assistantTabBtn.addEventListener("click", () => {
    showTab(assistantDiv);
    assistantTabBtn.classList.add("active");
    jobsTabBtn.classList.remove("active");
    statsTabBtn.classList.remove("active");
    loadAssistantTab();
  });

  statsTabBtn.addEventListener("click", () => {
    showTab(statsDiv);
    statsTabBtn.classList.add("active");
    jobsTabBtn.classList.remove("active");
    assistantTabBtn.classList.remove("active");
    loadStatsTab();
  });

  // Real-time update listener
  chrome.storage.onChanged.addListener(() => {
    if (document.getElementById("jobs").classList.contains("active")) {
      renderJobsTable();
    }
  });

  async function parsePdfToText(pdfData) {
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    let finalText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => item.str);
      finalText += strings.join(" ") + "\n";
    }
    return finalText;
  }

  async function convertDocxToText(arrayBuffer) {
    const result = await window.mammoth.convertToHtml({ arrayBuffer });
    const html = result.value || "";
    return html.replace(/<[^>]*>/g, " ");
  }

  // IndexedDB functions for file storage
  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("JobTrackerFiles", 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files", { keyPath: "fileId" });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e);
    });
  }

  async function storeFileInIDB(file) {
    const fileId = crypto.randomUUID();
    const fileName = file.name;
    const fileBlob = file;
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const store = tx.objectStore("files");
      store.add({ fileId, fileName, fileBlob });
      tx.oncomplete = () => resolve(fileId);
      tx.onerror = (err) => reject(err);
    });
  }

  async function getFileRecordFromIDB(fileId) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const store = tx.objectStore("files");
      const request = store.get(fileId);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = (err) => reject(err);
    });
  }

  async function deleteFileFromIDB(fileId) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const store = tx.objectStore("files");
      store.delete(fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = (err) => reject(err);
    });
  }

  async function putFileInIDB(fileId, fileName, fileBlob) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const store = tx.objectStore("files");
      store.put({ fileId, fileName, fileBlob });
      tx.oncomplete = () => resolve();
      tx.onerror = (err) => reject(err);
    });
  }

  // File upload handlers for Jobs tab
  async function handleCvUploadForJob(jobIndex, file) {
    try {
      const fileId = await storeFileInIDB(file);
      chrome.storage.local.get("jobs", (data) => {
        const jobs = data.jobs || [];
        jobs[jobIndex].cvFileId = fileId;
        chrome.storage.local.set({ jobs });
      });
    } catch (err) {
      console.error("Error storing CV:", err);
    }
  }

  async function handleCoverLetterUploadForJob(jobIndex, file) {
    try {
      const fileId = await storeFileInIDB(file);
      chrome.storage.local.get("jobs", (data) => {
        const jobs = data.jobs || [];
        jobs[jobIndex].coverLetterFileId = fileId;
        chrome.storage.local.set({ jobs });
      });
    } catch (err) {
      console.error("Error storing Cover Letter:", err);
    }
  }

  // Backup: Save jobs.json and each file with original filename preserved.
  async function backupAllToZip() {
    const zip = new JSZip();
    const data = await new Promise(resolve => chrome.storage.local.get("jobs", resolve));
    const jobs = data.jobs || [];
    zip.file("jobs.json", JSON.stringify(jobs, null, 2));
    for (let job of jobs) {
      if (job.cvFileId) {
        const record = await getFileRecordFromIDB(job.cvFileId);
        if (record) {
          zip.file(`files/${job.cvFileId}_${record.fileName}`, record.fileBlob);
        }
      }
      if (job.coverLetterFileId) {
        const record = await getFileRecordFromIDB(job.coverLetterFileId);
        if (record) {
          zip.file(`files/${job.coverLetterFileId}_${record.fileName}`, record.fileBlob);
        }
      }
    }
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jobs_backup.zip";
    a.click();
  }

  // Restore: Load jobs.json and store each file with its original filename.
  async function restoreAllFromZip(file) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const jobsJsonFile = zip.file("jobs.json");
    if (!jobsJsonFile) {
      alert("jobs.json not found in backup ZIP. Please check your backup file.");
      return;
    }
    const jobsJson = await jobsJsonFile.async("string");
    const jobs = JSON.parse(jobsJson);
    const fileEntries = Object.keys(zip.files).filter(f => f.startsWith("files/"));
    for (let entry of fileEntries) {
      const fileEntry = zip.file(entry);
      if (!fileEntry) continue;
      try {
        const blobData = await fileEntry.async("blob");
        const shortName = entry.slice("files/".length);
        const underscoreIndex = shortName.indexOf("_");
        let fileId = "";
        let fileName = "";
        if (underscoreIndex < 0) {
          fileId = shortName;
          fileName = "";
        } else {
          fileId = shortName.slice(0, underscoreIndex);
          fileName = shortName.slice(underscoreIndex + 1);
        }
        await putFileInIDB(fileId, fileName, blobData);
      } catch (e) {
        console.error("Error restoring file from entry:", entry, e);
      }
    }
    chrome.storage.local.set({ jobs }, () => {
      alert("Restore complete!");
      loadJobsTab();
    });
  }

  function restoreFromZipUI() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        await restoreAllFromZip(file);
      }
    };
    input.click();
  }

  // Jobs Tab: includes search, duplicate handling, file upload/view, and buttons.
  function loadJobsTab() {
    const html = `
      <div style="margin-bottom:10px; display:flex; align-items:center; gap:10px;">
        <label for="jobsSearchInput"><strong>Search:</strong></label>
        <input type="text" id="jobsSearchInput" placeholder="Type to search..." style="flex:1; padding:4px;">
        <button id="addTestJobBtn" class="export-btn" style="background:#009688;">Add Test Job</button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Company</th>
              <th>Location</th>
              <th>Role Type</th>
              <th>Duration</th>
              <th>Work Auth</th>
              <th>Salary</th>
              <th>Date Posted</th>
              <th>Logged</th>
              <th>Status</th>
              <th>Active</th>
              <th>Last Checked</th>
              <th>CV</th>
              <th>Cover Letter</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="jobsTbody"></tbody>
        </table>
      </div>
      <div style="text-align:center; margin-top:10px;">
        <button id="exportCSV" class="export-btn">Export CSV</button>
        <button id="exportJSON" class="export-btn">Export JSON</button>
        <button id="backupBtn" class="export-btn" style="background:purple;">Backup ZIP</button>
        <button id="restoreBtn" class="export-btn" style="background:orange;">Restore ZIP</button>
      </div>
    `;
    jobsDiv.innerHTML = html;

    const searchInput = document.getElementById("jobsSearchInput");
    searchInput.value = jobsSearchQuery;
    searchInput.addEventListener("input", (e) => {
      jobsSearchQuery = e.target.value.trim().toLowerCase();
      renderJobsTable();
    });

    document.getElementById("addTestJobBtn").addEventListener("click", () => {
      const newJob = {
        title: "Test Job",
        company: "Demo Inc",
        location: "Remote",
        roleType: "Full-Time",
        duration: "N/A",
        workAuthorizationRequirement: "N/A",
        salary: "$100k",
        datePosted: "2025-01-01",
        dateLogged: new Date().toISOString(),
        applied: false,
        active: true,
        lastChecked: new Date().toISOString(),
        cvFileId: null,
        coverLetterFileId: null,
        note: "",
        url: "https://example.com/job/test"
      };
      chrome.storage.local.get("jobs", (data) => {
        const jobs = data.jobs || [];
        jobs.push(newJob);
        chrome.storage.local.set({ jobs }, () => {
          renderJobsTable();
        });
      });
    });

    document.getElementById("exportCSV").addEventListener("click", () => {
      chrome.storage.local.get("jobs", (data) => {
        exportCSV(data.jobs || []);
      });
    });
    document.getElementById("exportJSON").addEventListener("click", () => {
      chrome.storage.local.get("jobs", (data) => {
        exportJSON(data.jobs || []);
      });
    });
    document.getElementById("backupBtn").addEventListener("click", backupAllToZip);
    document.getElementById("restoreBtn").addEventListener("click", restoreFromZipUI);

    renderJobsTable();
  }

  function renderJobsTable() {
    chrome.storage.local.get("jobs", (data) => {
      const allJobs = data.jobs || [];
      const tbody = document.getElementById("jobsTbody");
      if (!tbody) return;
      const filteredJobs = allJobs.filter(job => {
        if (!jobsSearchQuery) return true;
        const combined = `${job.title} ${job.company} ${job.location} ${job.roleType} ${job.workAuthorizationRequirement} ${job.salary} ${job.datePosted}`.toLowerCase();
        return combined.includes(jobsSearchQuery);
      });
      tbody.innerHTML = "";
      if (filteredJobs.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 15;
        cell.style.textAlign = "center";
        cell.innerText = "No jobs found.";
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
      }
      filteredJobs.forEach((job, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${job.title}</td>
          <td>${job.company}</td>
          <td>${job.location || "N/A"}</td>
          <td>${job.roleType || "N/A"}</td>
          <td>${job.duration || "N/A"}</td>
          <td>${job.workAuthorizationRequirement || "N/A"}</td>
          <td>${job.salary}</td>
          <td>${job.datePosted}</td>
          <td>${new Date(job.dateLogged).toLocaleString()}</td>
          <td>${job.applied ? "Completed" : "Not Completed"}</td>
          <td>${job.active ? "Yes" : "No"}</td>
          <td>${job.lastChecked ? new Date(job.lastChecked).toLocaleString() : "N/A"}</td>
          <td>
            ${job.cvFileId ? "Uploaded" : "Not Uploaded"}
            <button class="action-btn" id="uploadCv${index}">Upload CV</button>
            <button class="action-btn" id="viewCv${index}">View CV</button>
          </td>
          <td>
            ${job.coverLetterFileId ? "Uploaded" : "Not Uploaded"}
            <button class="action-btn" id="uploadCl${index}">Upload CL</button>
            <button class="action-btn" id="viewCl${index}">View CL</button>
          </td>
          <td>
            <button class="action-btn" id="toggleApplyBtn${index}" style="margin:2px;">
              ${job.applied ? "Mark Unapplied" : "Mark Applied"}
            </button>
            <button class="action-btn action-recheck" id="recheck${index}" style="margin:2px;">Re-check</button>
            <button class="action-btn" id="deleteJob${index}" style="background:red; color:white; margin:2px;">Delete</button>
          </td>
        `;
        tbody.appendChild(row);

        document.getElementById(`toggleApplyBtn${index}`).addEventListener("click", () => {
          const i = allJobs.indexOf(job);
          if (i >= 0) {
            allJobs[i].applied = !allJobs[i].applied;
            allJobs[i].dateCompleted = allJobs[i].applied ? new Date().toISOString() : null;
            chrome.storage.local.set({ jobs: allJobs });
          }
        });

        document.getElementById(`recheck${index}`).addEventListener("click", () => {
          fetch(job.url, { method: "HEAD" })
            .then((resp) => {
              job.active = resp.ok;
              job.lastChecked = new Date().toISOString();
            })
            .catch(() => {
              job.active = false;
              job.lastChecked = new Date().toISOString();
            })
            .finally(() => {
              const i = allJobs.indexOf(job);
              if (i >= 0) {
                allJobs[i] = job;
                chrome.storage.local.set({ jobs: allJobs });
              }
            });
        });

        document.getElementById(`deleteJob${index}`).addEventListener("click", () => {
          if (!confirm("Are you sure you want to delete this job?")) return;
          const i = allJobs.indexOf(job);
          if (i >= 0) {
            if (job.cvFileId) deleteFileFromIDB(job.cvFileId);
            if (job.coverLetterFileId) deleteFileFromIDB(job.coverLetterFileId);
            allJobs.splice(i, 1);
            chrome.storage.local.set({ jobs: allJobs });
          }
        });

        document.getElementById(`uploadCv${index}`).addEventListener("click", () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".pdf,.docx";
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
              await handleCvUploadForJob(index, file);
            }
          };
          input.click();
        });

        document.getElementById(`viewCv${index}`).addEventListener("click", async () => {
          if (!job.cvFileId) {
            alert("No CV uploaded.");
            return;
          }
          const record = await getFileRecordFromIDB(job.cvFileId);
          if (!record) {
            alert("File not found.");
            return;
          }
          const url = URL.createObjectURL(record.fileBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = record.fileName;
          a.click();
        });

        document.getElementById(`uploadCl${index}`).addEventListener("click", () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".pdf,.docx";
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
              await handleCoverLetterUploadForJob(index, file);
            }
          };
          input.click();
        });

        document.getElementById(`viewCl${index}`).addEventListener("click", async () => {
          if (!job.coverLetterFileId) {
            alert("No Cover Letter uploaded.");
            return;
          }
          const record = await getFileRecordFromIDB(job.coverLetterFileId);
          if (!record) {
            alert("File not found.");
            return;
          }
          const url = URL.createObjectURL(record.fileBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = record.fileName;
          a.click();
        });
      });
    });
  }

  function exportCSV(jobs) {
    const header = ["Title","Company","Location","Role Type","Duration","Work Auth","Salary","Date Posted","Logged","Status","Active","Last Checked","URL","Note"];
    const rows = jobs.map(job => [
      job.title,
      job.company,
      job.location || "N/A",
      job.roleType || "N/A",
      job.duration || "N/A",
      job.workAuthorizationRequirement || "N/A",
      job.salary,
      job.datePosted,
      job.dateLogged,
      job.applied ? "Completed" : "Not Completed",
      job.active ? "Yes" : "No",
      job.lastChecked || "",
      job.url,
      (job.note || "").replace(/\n/g, " ")
    ]);
    const csvContent = [header, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jobs.csv";
    a.click();
  }

  function exportJSON(jobs) {
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jobs.json";
    a.click();
  }

  // AI Assistant Tab: tailored cover letter & CV rating.
  function loadAssistantTab() {
    assistantDiv.innerHTML = `
      <div class="assistant-flex">
        <div class="assistant-left">
          <h3>Job Details</h3>
          <label><strong>Select a Job:</strong></label>
          <select id="jobSelect" style="width:100%; padding:5px; margin-bottom:10px;"></select>
          <div id="jobDetailsPreview" style="white-space:pre-wrap;"></div>
        </div>
        <div class="assistant-right">
          <h3>AI Assistant</h3>
          <label><strong>Upload CV:</strong></label>
          <input type="file" id="assistantCVUpload" accept=".pdf,.docx" style="display:block; margin-bottom:10px;">
          <button id="coverLetterBtn" class="export-btn" style="margin-right:5px;">Generate Tailored Cover Letter</button>
          <button id="rateCvBtn" class="export-btn">Rate My CV</button>
          <label style="margin-top:10px; display:block;"><strong>Assistant Output:</strong></label>
          <div id="assistantOutput" style="border:1px solid #555; padding:5px; margin-top:5px; white-space:pre-wrap; max-height:300px; overflow:auto;"></div>
        </div>
      </div>
    `;

    document.getElementById("assistantCVUpload").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext !== "pdf" && ext !== "docx") {
        uploadedAssistantCV = null;
        alert("Only PDF and DOCX files are supported.");
        return;
      }
      uploadedAssistantCV = file;
    });

    chrome.storage.local.get("jobs", (data) => {
      const jobs = data.jobs || [];
      const jobSelect = document.getElementById("jobSelect");
      jobSelect.innerHTML = "";
      jobs.forEach((job, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${job.title} @ ${job.company}`;
        jobSelect.appendChild(opt);
      });
      jobSelect.addEventListener("change", () => {
        const idx = parseInt(jobSelect.value);
        if (!isNaN(idx)) previewJobDetails(idx, jobs);
      });
      if (jobs.length > 0) {
        jobSelect.value = 0;
        previewJobDetails(0, jobs);
      }
    });

    document.getElementById("coverLetterBtn").addEventListener("click", async () => {
      const idx = parseInt(document.getElementById("jobSelect").value);
      if (isNaN(idx)) return;
      const job = await getJobByIndex(idx);
      if (uploadedAssistantCV) {
        const ext = uploadedAssistantCV.name.split(".").pop().toLowerCase();
        let extractedText = "";
        if (ext === "pdf") {
          extractedText = await parsePdfToText(await uploadedAssistantCV.arrayBuffer());
        } else if (ext === "docx") {
          extractedText = await convertDocxToText(await uploadedAssistantCV.arrayBuffer());
        }
        generateCoverLetter(extractedText, job);
      } else {
        generateCoverLetter("No CV uploaded", job);
      }
    });

    document.getElementById("rateCvBtn").addEventListener("click", async () => {
      const idx = parseInt(document.getElementById("jobSelect").value);
      if (isNaN(idx)) return;
      const job = await getJobByIndex(idx);
      if (uploadedAssistantCV) {
        const ext = uploadedAssistantCV.name.split(".").pop().toLowerCase();
        let extractedText = "";
        if (ext === "pdf") {
          extractedText = await parsePdfToText(await uploadedAssistantCV.arrayBuffer());
        } else if (ext === "docx") {
          extractedText = await convertDocxToText(await uploadedAssistantCV.arrayBuffer());
        }
        rateCV(extractedText, job);
      } else {
        rateCV("No CV uploaded", job);
      }
    });
  }

  function previewJobDetails(idx, jobs) {
    const job = jobs[idx];
    const detailsBox = document.getElementById("jobDetailsPreview");
    detailsBox.textContent = `
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Role Type: ${job.roleType}
Duration: ${job.duration}
Work Authorization: ${job.workAuthorizationRequirement}
Salary: ${job.salary}
Posted: ${job.datePosted}
Description:
${job.jobDescription}
    `.trim();
  }

  function getJobByIndex(idx) {
    return new Promise((resolve) => {
      chrome.storage.local.get("jobs", (data) => {
        const jobs = data.jobs || [];
        resolve(jobs[idx]);
      });
    });
  }

  async function generateCoverLetter(cvText, job) {
    const assistantOutput = document.getElementById("assistantOutput");
    assistantOutput.textContent = "Generating tailored cover letter...";
    const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const systemMsg = {
      role: "system",
      content: "You are a career advisor that crafts tailored cover letters for job applications. Use the job details and the user's CV to create a natural, engaging, and professional cover letter. Do not include placeholders."
    };
    const userMsg = {
      role: "user",
      content: `
Job Listing:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Role Type: ${job.roleType}
Duration: ${job.duration}
Work Authorization: ${job.workAuthorizationRequirement}
Salary: ${job.salary}
Date Posted: ${job.datePosted}
Description: ${job.jobDescription}

User CV:
${cvText}

Using today's date (${today}), generate a tailored cover letter that addresses the hiring manager directly. Include a header with user contact information (if present in the CV) or realistic details, followed by a greeting, a body that explains how the user's background fits the job, and a courteous closing.
`
    };
    const resp = await callChatAPI([systemMsg, userMsg]);
    assistantOutput.textContent = resp ? resp : "Error generating cover letter.";
  }

  async function rateCV(cvText, job) {
    const assistantOutput = document.getElementById("assistantOutput");
    assistantOutput.textContent = "Rating CV and providing feedback...";
    const systemMsg = {
      role: "system",
      content: "You are a career advisor that evaluates how well a user's CV fits a specific job listing. Provide a rating out of 10 along with actionable feedback for improvement."
    };
    const userMsg = {
      role: "user",
      content: `
Job Listing:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Role Type: ${job.roleType}
Duration: ${job.duration}
Work Authorization: ${job.workAuthorizationRequirement}
Salary: ${job.salary}
Date Posted: ${job.datePosted}
Description: ${job.jobDescription}

User CV:
${cvText}

Based on the job listing, rate the CV on a scale of 1-10 and provide specific feedback on how to improve the CV for this position.
`
    };
    const resp = await callChatAPI([systemMsg, userMsg]);
    assistantOutput.textContent = resp ? resp : "Error rating CV.";
  }

  async function callChatAPI(messages) {
    const OPENAI_API_KEY = "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";
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.7,
          max_tokens: 700
        })
      });
      const data = await response.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) return null;
      return data.choices[0].message.content.trim();
    } catch (e) {
      return null;
    }
  }

  function loadStatsTab() {
    statsDiv.innerHTML = `
      <div class="stats-container">
        <div id="statsSummary" style="margin-bottom:10px;"></div>
        <canvas id="statsChart" width="700" height="200" style="background:#1e1e1e;"></canvas>
      </div>
    `;
    loadStats();
  }

  function loadStats() {
    chrome.storage.local.get("jobs", (data) => {
      const jobs = data.jobs || [];
      const total = jobs.length;
      const completed = jobs.filter(j => j.applied).length;
      const pending = total - completed;
      const statsSummary = document.getElementById("statsSummary");
      statsSummary.innerHTML = `
        <strong>Total Jobs:</strong> ${total}<br>
        <strong>Completed:</strong> ${completed}<br>
        <strong>Pending:</strong> ${pending}<br>
      `;
      const dateMap = {};
      jobs.forEach(j => {
        const d = new Date(j.dateLogged).toDateString();
        dateMap[d] = (dateMap[d] || 0) + 1;
      });
      const labels = Object.keys(dateMap).sort((a, b) => new Date(a) - new Date(b));
      const values = labels.map(l => dateMap[l]);
      drawMiniChart(labels, values);
    });
  }

  function drawMiniChart(labels, values) {
    const canvas = document.getElementById("statsChart");
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const maxVal = Math.max(...values) || 1;
    const barWidth = (canvas.width - 40) / values.length;
    values.forEach((val, i) => {
      const x = 30 + i * barWidth;
      const y = canvas.height - ((val / maxVal) * (canvas.height - 40));
      const h = (val / maxVal) * (canvas.height - 40);
      ctx.fillStyle = "#4CAF50";
      ctx.fillRect(x, y, barWidth * 0.8, h);
      ctx.fillStyle = "#fff";
      ctx.fillText(labels[i].slice(4, 10), x, canvas.height - 5);
    });
  }

  // Initialize tabs
  loadJobsTab();
  loadAssistantTab();
  loadStatsTab();
});
