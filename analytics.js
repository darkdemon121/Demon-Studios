const analyticsOptOutKey = "demon-studios-analytics-opt-out";

window.va = window.va || function () {
  (window.vaq = window.vaq || []).push(arguments);
};

window.va("beforeSend", event => {
  try {
    if (localStorage.getItem(analyticsOptOutKey) === "true") return null;
    const url = new URL(event.url, location.origin);
    url.search = "";
    return { ...event, url: url.toString() };
  } catch {
    return event;
  }
});

if (["demon-studios.com", "www.demon-studios.com"].includes(location.hostname)) {
  const analyticsScript = document.createElement("script");
  analyticsScript.defer = true;
  analyticsScript.src = "/_vercel/insights/script.js";
  document.head.append(analyticsScript);
}

const analyticsOptOut = document.querySelector("#analytics-opt-out");
if (analyticsOptOut) {
  try {
    analyticsOptOut.checked = localStorage.getItem(analyticsOptOutKey) === "true";
    analyticsOptOut.addEventListener("change", () => {
      localStorage.setItem(analyticsOptOutKey, String(analyticsOptOut.checked));
    });
  } catch {
    analyticsOptOut.disabled = true;
  }
}