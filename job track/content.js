(function() {
  let lastProcessedUrl = "";
  let lastProcessedTimestamp = 0;

  function isLikelyJobApplicationPage() {
    const content = document.body.innerText.toLowerCase();
    const keywords = [
      "apply now", "job description", "responsibilities", "qualifications", "experience",
      "salary", "benefits", "career opportunity", "position", "apply", "job type", "full-time",
      "part-time", "intern", "internship", "opening", "candidate", "we are hiring",
      "brand", "starbucks coffee company", "job category", "retail stores", "job function",
      "barista", "job level", "individual contributor", "posting date", "expiration date",
      "starting hourly pay range", "pay rate", "compensation", "shift", "requirements",
      "paying", "contract", "schedule", "work experience", "benefit"
    ];
    let count = 0;
    keywords.forEach(kw => {
      if (content.indexOf(kw.toLowerCase()) !== -1) count++;
    });
    return count >= 2;
  }

  const OPENAI_API_KEY = "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";

  async function analyzePageContent(content) {
    const messages = [
      { role: "system", content: "You are an assistant that extracts job listing details from a web page." },
      { role: "user", content:
          'Given the following page content, determine if it shows exactly one job posting. ' +
          'If yes, return a JSON object with keys: "title", "company", "salary", "datePosted", "location", ' +
          '"roleType", "duration", "workAuthorizationRequirement", "jobDescription". If not, return null. ' +
          "Page content: " + content }
    ];
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
          temperature: 0.2,
          max_tokens: 300,
          top_p: 1.0
        })
      });
      const data = await response.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        return null;
      }
      let textOutput = data.choices[0].message.content.trim();
      textOutput = textOutput.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
      return JSON.parse(textOutput);
    } catch(e) {
      return null;
    }
  }

  function getPageVisibleText() {
    return document.body.innerText;
  }

  function isDuplicateJob(newJob, existingJob) {
    const norm = str => str.toLowerCase().trim();
    if (norm(newJob.company) !== norm(existingJob.company)) return false;
    const titleMatch = norm(existingJob.title).includes(norm(newJob.title)) ||
                       norm(newJob.title).includes(norm(existingJob.title));
    const locationMatch = norm(existingJob.location).includes(norm(newJob.location)) ||
                          norm(newJob.location).includes(norm(existingJob.location));
    const roleMatch = norm(existingJob.roleType).includes(norm(newJob.roleType)) ||
                      norm(newJob.roleType).includes(norm(existingJob.roleType));
    return titleMatch && locationMatch && roleMatch;
  }

  function updateMissingFields(existingJob, newDetails) {
    let updated = false;
    const fields = ["salary", "datePosted", "roleType", "duration", "workAuthorizationRequirement", "jobDescription"];
    fields.forEach(field => {
      if ((!existingJob[field] || existingJob[field] === "N/A") && newDetails[field] && newDetails[field] !== "N/A") {
        existingJob[field] = newDetails[field];
        updated = true;
      }
    });
    return updated;
  }

  async function recheckJobIfNeeded(job) {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const lastCheckedTime = job.lastChecked ? new Date(job.lastChecked).getTime() : 0;
    if ((now - lastCheckedTime) < ONE_DAY_MS) return job;
    try {
      const resp = await fetch(job.url, { method: "HEAD" });
      job.active = resp.ok;
    } catch(e) {
      job.active = false;
    }
    job.lastChecked = new Date().toISOString();
    return job;
  }

  async function processJobPageWithAI() {
    try {
      const currentUrl = window.location.href;
      const now = Date.now();
      // Prevent re-processing the same URL within 3 seconds
      if (currentUrl === lastProcessedUrl && (now - lastProcessedTimestamp) < 3000) {
        return;
      }
      lastProcessedUrl = currentUrl;
      lastProcessedTimestamp = now;

      if (!isLikelyJobApplicationPage()) return;
      const content = getPageVisibleText();
      const jobDetails = await analyzePageContent(content);
      if (!jobDetails) return;
      chrome.storage.local.get("jobs", async (data) => {
        const jobs = data.jobs || [];
        const newJob = {
          url: currentUrl,
          website: window.location.hostname,
          title: jobDetails.title || "N/A",
          company: jobDetails.company || "N/A",
          salary: jobDetails.salary || "N/A",
          datePosted: jobDetails.datePosted || "N/A",
          location: jobDetails.location || "N/A",
          roleType: jobDetails.roleType || "N/A",
          duration: jobDetails.duration || "N/A",
          workAuthorizationRequirement: jobDetails.workAuthorizationRequirement || "N/A",
          jobDescription: jobDetails.jobDescription || "",
          dateLogged: new Date().toISOString(),
          applied: false,
          dateCompleted: null,
          cv: "",
          coverLetter: "",
          note: "",
          attachment: null,
          active: true,
          lastChecked: new Date().toISOString()
        };
        const duplicateIndex = jobs.findIndex(existing => isDuplicateJob(newJob, existing));
        if (duplicateIndex !== -1) {
          let existingJob = jobs[duplicateIndex];
          const changed = updateMissingFields(existingJob, newJob);
          existingJob = await recheckJobIfNeeded(existingJob);
          jobs[duplicateIndex] = existingJob;
          if (changed) chrome.storage.local.set({ jobs });
          return;
        }
        jobs.push(newJob);
        chrome.storage.local.set({ jobs });
      });
    } catch(err) {
      console.error("Error in processJobPageWithAI:", err);
    }
  }

  // Listen for URL changes and dynamic DOM updates.
  window.addEventListener("popstate", processJobPageWithAI);
  window.addEventListener("hashchange", processJobPageWithAI);
  const observer = new MutationObserver(() => {
    processJobPageWithAI();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  processJobPageWithAI();
})();
