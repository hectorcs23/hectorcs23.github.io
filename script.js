const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
const projects = Array.from(document.querySelectorAll(".project[data-category]"));

function applyFilter(filter) {
  for (const project of projects) {
    const categories = project.dataset.category.split(" ");
    const visible = filter === "all" || categories.includes(filter);
    project.hidden = !visible;
  }

  for (const button of filterButtons) {
    const active = button.dataset.filter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

}

for (const button of filterButtons) {
  button.addEventListener("click", () => applyFilter(button.dataset.filter));
}
