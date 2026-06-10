import type { PromptCategory } from "../../core/categories";
import { el } from "./createElement";
import { enhanceDropdown } from "./dropdown";

export interface CategoryDropdownOptions {
  readonly categories: readonly PromptCategory[];
  readonly selectedIds: readonly string[];
  readonly signal: AbortSignal;
  readonly onChange?: (categoryIds: readonly string[]) => void;
}

export interface CategoryDropdown {
  readonly element: HTMLElement;
  readonly selectedIds: () => string[];
}

function summarizeSelection(categories: readonly PromptCategory[], selectedIds: readonly string[]): string {
  if (selectedIds.length === categories.length) return "All categories";
  if (selectedIds.length === 1) return categories.find((category) => category.id === selectedIds[0])?.label ?? "1 category";
  return `${selectedIds.length} categories`;
}

export function createCategoryDropdown(options: CategoryDropdownOptions): CategoryDropdown {
  const selected = new Set(options.selectedIds.length > 0 ? options.selectedIds : [options.categories[0]?.id].filter((id): id is string => id !== undefined));
  const selectedText = el("span", { className: "category-dropdown-selected" });

  const categoryOptions = options.categories.map((category) => {
    const checkbox = el("input", { attrs: { type: "checkbox", value: category.id } });
    checkbox.checked = selected.has(category.id);
    const label = el("label", {
      className: "category-option",
      attrs: { title: category.description },
      children: [checkbox, el("span", { text: category.label })],
    });
    return { id: category.id, checkbox, label };
  });

  function getSelectedIds(): string[] {
    return categoryOptions.filter((option) => option.checkbox.checked).map((option) => option.id);
  }

  function updateSummary(): void {
    selectedText.textContent = summarizeSelection(options.categories, getSelectedIds());
  }

  for (const option of categoryOptions) {
    option.checkbox.addEventListener(
      "change",
      () => {
        const ids = getSelectedIds();
        if (ids.length === 0) {
          option.checkbox.checked = true;
          updateSummary();
          return;
        }
        updateSummary();
        options.onChange?.(ids);
      },
      { signal: options.signal },
    );
  }

  const element = el("details", {
    className: "category-dropdown",
    children: [
      el("summary", {
        className: "category-dropdown-summary",
        children: [el("span", { className: "category-row-label", text: "Categories" }), selectedText],
      }),
      el("div", { className: "category-dropdown-menu", attrs: { role: "group", "aria-label": "Categories" }, children: categoryOptions.map((option) => option.label) }),
    ],
  });
  updateSummary();
  enhanceDropdown(element, { signal: options.signal, closeOnSelect: true });

  return { element, selectedIds: getSelectedIds };
}
