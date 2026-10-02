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

const demoOutput = document.querySelector("#demo-output");
const demoFormats = {
  linkedin: "A good idea can get lost when it has to travel between platforms. Start with the clearest version of what you mean.\n\nThen give it a shape that feels native to the place people will find it.",
  carousel: "SLIDE 1\nA good idea can get lost when it has to travel between platforms. Start with the clearest version of what you mean.\n\n──────────\n\nSLIDE 2\nThen give it a shape that feels native to the place people will find it.",
  thread: "A good idea can get lost when it has to travel between platforms. Start with the clearest version of what you mean. Then give it a shape that feels native to the place people will find it.\n\n1/1"
};

document.querySelector(".demo-tabs")?.addEventListener("click", event => {
  const tab = event.target.closest("[data-demo-format]");
  if (!tab || !demoOutput) return;

  for (const formatTab of document.querySelectorAll("[data-demo-format]")) {
    formatTab.setAttribute("aria-selected", String(formatTab === tab));
  }
  demoOutput.textContent = demoFormats[tab.dataset.demoFormat];
});
