chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("dailyCheck", { periodInMinutes: 1440 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyCheck") {
    recheckJobStatuses();
  }
});
function recheckJobStatuses() {
  chrome.storage.sync.get("jobs", (data) => {
    const jobs = data.jobs || [];
    jobs.forEach((job, index) => {
      fetch(job.url, { method: "HEAD" })
        .then((response) => {
          jobs[index].active = response.ok;
          jobs[index].lastChecked = new Date().toISOString();
        })
        .catch(() => {
          jobs[index].active = false;
          jobs[index].lastChecked = new Date().toISOString();
        })
        .finally(() => {
          chrome.storage.sync.set({ jobs });
        });
    });
  });
}
