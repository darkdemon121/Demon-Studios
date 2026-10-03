const menuToggle = document.querySelector("#menu-toggle");
const siteNav = document.querySelector("#site-nav");

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
  siteNav.classList.toggle("is-open", !isOpen);
});

siteNav.addEventListener("click", event => {
  if (event.target.closest("a")) {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    siteNav.classList.remove("is-open");
  }
});

const demoSource = document.querySelector("#demo-source-text");
const demoOutputList = document.querySelector("#demo-output-list");
const demoModeNote = document.querySelector("#demo-mode-note");
const demoModeStatus = document.querySelector("#demo-mode-status");
const demoEditableStatus = document.querySelector(".demo-editable");
const demoFormats = [...document.querySelectorAll("[data-demo-format]")];
const demoModes = [...document.querySelectorAll("[data-demo-mode]")];
const demoTemplates = {
  lesson: "A useful lesson deserves a clear explanation. Show the challenge, share one practical step, and give readers something they can try today.",
  launch: "We made a new tool. It helps independent creators shape one draft into posts for different platforms. We would love to hear what you think."
};
const demoToneOpeners = {
  balanced: "A thought to share:",
  warm: "A little reminder:",
  confident: "Here is the key idea:",
  conversational: "Quick thought:"
};
const demoGoals = {
  engage: "What has your experience been?",
  educate: "Keep this idea handy for your next draft.",
  promote: "Want to explore this further? Start a conversation."
};
let demoMode = "format";
let demoFormat = "linkedin";

const demoModeNotes = {
  format: "Reshape a draft locally for its next platform.",
  rewrite: "Apply audience, tone, and goal framing locally; VibeShift does not add or verify claims.",
  ai: "AI Rewrite sends text to OpenAI and requires an active plan. This website preview does not submit your text."
};

function demoSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])|\n+/u).map(part => part.trim()).filter(Boolean);
}

function demoGroup(sentences, limit) {
  const groups = [];
  let group = "";
  for (const sentence of sentences) {
    const parts = sentence.match(new RegExp(`.{1,${limit}}(?:\\s|$)|\\S+`, "g")) || [sentence];
    for (const part of parts) {
      const item = part.trim();
      if (!item) continue;
      const next = group ? `${group} ${item}` : item;
      if (next.length > limit && group) {
        groups.push(group);
        group = item;
      } else group = next;
    }
  }
  if (group) groups.push(group);
  return groups;
}

function demoRenderFormat(text, format) {
  const sentences = demoSentences(text);
  if (format === "carousel") return demoGroup(sentences, 150).map((part, i) => `SLIDE ${i + 1}\n${part}`).join("\n\n──────────\n\n");
  if (format === "thread") {
    const posts = demoGroup(sentences, 245);
    return posts.map((part, i) => `${part}\n\n${i + 1}/${posts.length}`).join("\n\n↓\n\n");
  }
  return sentences.join("\n\n");
}

function demoBuildOutputs() {
  if (!demoSource || !demoOutputList) return;
  if (demoModeNote) demoModeNote.textContent = demoModeNotes[demoMode];
  if (demoModeStatus) demoModeStatus.textContent = demoMode === "ai" ? "AI MODE · PLAN REQUIRED" : "LOCAL MODE";
  if (demoEditableStatus) demoEditableStatus.textContent = demoMode === "ai" ? "AI · PLAN REQUIRED" : "EDITABLE · LOCAL";
  let text = demoSource.textContent.trim();
  if (demoMode === "rewrite") {
    const audience = document.querySelector("#demo-audience").value;
    const tone = document.querySelector("#demo-tone").value;
    const goal = document.querySelector("#demo-goal").value;
    text = [demoToneOpeners[tone], `For ${audience}:`, text, demoGoals[goal]].filter(Boolean).join("\n\n");
  }

  const formats = demoFormat === "pack" ? ["linkedin", "carousel", "thread"] : [demoFormat];
  const labels = { linkedin: "LinkedIn post", carousel: "Carousel slides", thread: "X thread" };
  demoOutputList.replaceChildren();
  for (const format of formats) {
    const card = document.createElement("article");
    card.className = "demo-output-card";
    const header = document.createElement("div");
    header.className = "demo-card-header";
    const title = document.createElement("span");
    title.textContent = labels[format];
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "demo-copy";
    copy.textContent = "Copy";
    const output = document.createElement("pre");
    output.className = "demo-output";
    output.textContent = demoMode === "ai"
      ? "AI Rewrite is an online feature in the extension. It sends your draft and voice settings to OpenAI after you choose the AI mode."
      : demoRenderFormat(text, format);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(output.textContent);
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1300);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(output);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copy.textContent = "Select text";
      }
    });
    header.append(title, copy);
    card.append(header, output);
    demoOutputList.append(card);
  }
}

document.querySelector(".demo-tabs")?.addEventListener("click", event => {
  const tab = event.target.closest("[data-demo-format]");
  if (!tab) return;
  demoFormat = tab.dataset.demoFormat;
  demoFormats.forEach(button => button.setAttribute("aria-selected", String(button === tab)));
  demoBuildOutputs();
});

document.querySelector(".demo-mode")?.addEventListener("click", event => {
  const button = event.target.closest("[data-demo-mode]");
  if (!button) return;
  demoMode = button.dataset.demoMode;
  demoModes.forEach(option => option.setAttribute("aria-pressed", String(option === button)));
  demoBuildOutputs();
});

document.querySelectorAll("#demo-audience, #demo-tone, #demo-goal").forEach(control => {
  control.addEventListener("change", demoBuildOutputs);
});

document.querySelector(".demo-template-buttons")?.addEventListener("click", event => {
  const button = event.target.closest("[data-demo-template]");
  if (!button) return;
  demoSource.textContent = demoTemplates[button.dataset.demoTemplate];
  demoBuildOutputs();
});

demoBuildOutputs();

const signalforgeResponse = document.querySelector("#signalforge-response-code");
const signalforgeTabs = [...document.querySelectorAll("[data-signalforge-view]")];
const signalforgeCopy = document.querySelector("#signalforge-copy");
const signalforgeExamples = {
  html: `<h1>A good idea deserves to travel</h1>\n<p>Write once in Markdown. Turn your draft into <strong>clean HTML</strong> for a newsletter, CMS, or publishing workflow.</p>\n<ul>\n  <li>Keep the structure</li>\n  <li>Keep the links useful</li>\n</ul>`,
  request: `POST /v1/markdown/render\nContent-Type: application/json\nX-API-Key: YOUR_API_KEY\n\n{"markdown":"# A good idea deserves to travel\\n\\nWrite once in Markdown."}`
};

document.querySelector(".signalforge-tabs")?.addEventListener("click", async event => {
  const tab = event.target.closest("[data-signalforge-view]");
  if (tab) {
    signalforgeTabs.forEach(button => button.setAttribute("aria-selected", String(button === tab)));
    signalforgeResponse.textContent = signalforgeExamples[tab.dataset.signalforgeView];
    if (signalforgeCopy) signalforgeCopy.textContent = "Copy";
    return;
  }
  if (event.target.closest("#signalforge-copy") && signalforgeResponse) {
    try {
      await navigator.clipboard.writeText(signalforgeResponse.textContent);
      signalforgeCopy.textContent = "Copied";
      setTimeout(() => { signalforgeCopy.textContent = "Copy"; }, 1300);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(signalforgeResponse);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      signalforgeCopy.textContent = "Select text";
    }
  }
});
