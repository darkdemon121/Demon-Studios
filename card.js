const cardStatus = document.querySelector("#card-status");

function announceCardStatus(message) {
  if (cardStatus) cardStatus.textContent = message;
}

function trackCardEvent(name) {
  if (typeof window.va === "function") window.va("event", { name });
}

async function copyCardLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    trackCardEvent("Business card link copied");
    announceCardStatus("Card link copied.");
  } catch {
    announceCardStatus("Copy is unavailable here. You can share the address in your browser.");
  }
}

document.querySelector("#share-card")?.addEventListener("click", async () => {
  trackCardEvent("Business card share clicked");
  if (!navigator.share) {
    await copyCardLink();
    return;
  }
  try {
    await navigator.share({
      title: "Taylor C. — Demon Studios",
      text: "Founder and Developer at Demon Studios.",
      url: window.location.href
    });
    announceCardStatus("Card shared.");
  } catch (error) {
    if (error.name !== "AbortError") announceCardStatus("The card could not be shared right now.");
  }
});

document.querySelector("#copy-card-link")?.addEventListener("click", copyCardLink);

document.querySelector("#save-contact")?.addEventListener("click", () => {
  const vCard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Taylor C.",
    "N:C.;Taylor;;;",
    "ORG:Demon Studios",
    "TITLE:Founder and Developer",
    "EMAIL;TYPE=INTERNET:demonstudios.service@gmail.com",
    "URL:https://www.demon-studios.com/",
    "END:VCARD"
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([vCard], { type: "text/vcard;charset=utf-8" }));
  const download = document.createElement("a");
  download.href = url;
  download.download = "Taylor-C-Demon-Studios.vcf";
  document.body.append(download);
  download.click();
  download.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  trackCardEvent("Business card contact saved");
  announceCardStatus("Contact file downloaded.");
});